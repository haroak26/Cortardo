import { maxSeverity, type CortadoConfig } from "../config";
import type { AgentSpec, ChangedFile, Hypothesis, PRContext, PullRequestInput, Severity } from "../types";
import { clamp } from "../util/text";
import { mapLimit } from "../util/async";
import { stableId } from "../util/hash";
import { extractJson } from "../util/json";
import { hypothesisListSchema } from "../agents/contracts";
import { selectAgents } from "../agents/roster";
import { swarmSystemPrompt, swarmUserPrompt } from "../agents/prompts";
import type { Logger } from "../util/logger";
import type { ModelRouter } from "../models/router";

export interface SwarmAgentReport {
  agent: AgentSpec;
  status: "ok" | "error";
  hypotheses: number;
  durationMs: number;
  error?: string;
}

export interface SwarmReport {
  hypotheses: Hypothesis[];
  agents: SwarmAgentReport[];
}

const AUTH_PATH_RE = /(auth|session|login|security|permission|role|admin)/i;
const DB_PATH_RE = /(migration|model|schema|repo|database|db|sql)/i;
const PERF_PATH_RE = /(cache|perf|benchmark|query|loop)/i;

export function filesForAgent(agent: AgentSpec, context: PRContext): ChangedFile[] {
  const files = context.files.filter((file) => file.status !== "removed");
  const pick = (predicate: (file: ChangedFile) => boolean) => {
    const matched = files.filter(predicate);
    return matched.length > 0 ? matched : files;
  };
  switch (agent.kind) {
    case "auth":
    case "security":
      return pick(
        (file) => AUTH_PATH_RE.test(file.path) || file.addedLines.some((line) => AUTH_PATH_RE.test(line.text)),
      );
    case "database":
      return pick((file) => DB_PATH_RE.test(file.path) || file.language === "SQL");
    case "api":
      return pick(
        (file) =>
          context.routes.length > 0 &&
          file.addedLines.some((line) => /\.(get|post|put|patch|delete)\s*\(/.test(line.text)),
      );
    case "ui":
      return pick((file) => /\.(tsx|jsx|css|scss|html)$/.test(file.path) || /component|view|page/i.test(file.path));
    case "performance":
      return pick(
        (file) => PERF_PATH_RE.test(file.path) || file.addedLines.some((line) => /for\s*\(|\.map\s*\(|await\s/.test(line.text)),
      );
    case "config":
      return pick((file) => /\.(json|ya?ml|toml|env)$/.test(file.path) || /config|docker|workflow/i.test(file.path));
    case "regression":
      return pick((file) => context.tests.includes(file.path) || context.callers.includes(file.path));
    default:
      return files;
  }
}

export async function runSwarm(
  context: PRContext,
  input: PullRequestInput,
  models: ModelRouter,
  config: CortadoConfig,
  logger: Logger,
): Promise<SwarmReport> {
  const agents = selectAgents(context, config);
  const reports: SwarmAgentReport[] = [];
  const hypotheses: Hypothesis[] = [];

  await mapLimit(agents, config.swarm.concurrency, async (agent) => {
    const started = Date.now();
    const files = filesForAgent(agent, context);
    const excerpts = files.slice(0, 6).map((file) => ({ path: file.path, patch: file.patch ?? "" }));
    try {
      const payloads = await invokeAgent(agent, context, input, excerpts, models, config, logger);
      for (const payload of payloads) {
        const file = payload.evidence[0]?.split(":")[0];
        hypotheses.push({
          id: stableId("h", context.id, agent.id, payload.claim, payload.evidence.join(",")),
          claim: payload.claim,
          evidence: payload.evidence,
          severity: payload.severity,
          confidence: clamp(payload.confidence, 0, 1),
          suggestedExperiment: payload.suggestedExperiment,
          agent: agent.id,
          agentKind: agent.kind,
          file,
          tags: payload.rule ? [agent.kind, `rule:${payload.rule}`] : [agent.kind],
        });
      }
      reports.push({ agent, status: "ok", hypotheses: payloads.length, durationMs: Date.now() - started });
    } catch (error) {
      reports.push({
        agent,
        status: "error",
        hypotheses: 0,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.warn(`agent failed: ${agent.id}`, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return { hypotheses, agents: reports };
}

export function normalizeEvidence(entry: string): string | null {
  const cleaned = entry.trim().replace(/^`+|`+$/g, "").replace(/^\.\//, "");
  const match = /^(.+?):(\d+)(?:[-:]\d+)*$/.exec(cleaned);
  if (!match) return null;
  const path = match[1].trim();
  if (!path || path.includes(" ") || path.includes("..")) return null;
  return `${path}:${match[2]}`;
}

interface AgentPayload {
  claim: string;
  evidence: string[];
  severity: Severity;
  confidence: number;
  suggestedExperiment: string;
  rule?: string;
}

async function invokeAgent(
  agent: AgentSpec,
  context: PRContext,
  input: PullRequestInput,
  excerpts: Array<{ path: string; patch: string }>,
  models: ModelRouter,
  config: CortadoConfig,
  logger: Logger,
): Promise<AgentPayload[]> {
  const system = swarmSystemPrompt(agent);
  const user = swarmUserPrompt(agent, context, excerpts, input);
  let lastError: unknown;
  let lastErrorKind: "model" | "parse" = "parse";
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await models.complete({
        role: "luna",
        kind: "swarm_agent",
        system,
        user: attempt === 0 ? user : `${user}\n\nYour previous response was invalid. Return valid JSON only.`,
        expectJson: true,
        context: { agentKind: agent.kind, files: filesForAgent(agent, context) },
        label: agent.id,
      });
    } catch (error) {
      lastError = error;
      lastErrorKind = "model";
      continue;
    }
    try {
      const parsed = hypothesisListSchema.parse(extractJson(response.text));
      return parsed.hypotheses
        .map((hypothesis) => ({
          ...hypothesis,
          severity: hypothesis.severity,
          evidence: hypothesis.evidence
            .map(normalizeEvidence)
            .filter((entry): entry is string => entry !== null && entry.length > 0),
          rule: (hypothesis as { rule?: string }).rule,
        }))
        .filter((hypothesis) => hypothesis.evidence.length > 0)
        .slice(0, config.swarm.maxHypothesesPerAgent);
    } catch (error) {
      lastError = error;
      lastErrorKind = "parse";
    }
  }
  logger.warn(`agent returned unusable output: ${agent.id}`, {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  if (lastErrorKind === "model") {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  return [];
}

export function combineSeverity(values: Severity[]): Severity {
  return values.reduce((acc, value) => maxSeverity(acc, value), "info" as Severity);
}
