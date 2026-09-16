import type { Candidate, ContextPack, PRContext, ReviewRequest, SwarmAgentReport, SwarmMode, SwarmReport } from "./types";
import type { ModelRouter } from "./models";
import type { RepoProfile, Sandbox } from "./sandbox";
import { mapLimit, extractJson, truncate, type Logger } from "./util";
import { renderCompactDiff } from "./patch";
import {
  candidateFromHypothesis,
  hypothesisListSchema,
  runSwarmAgent,
  type SwarmAgentSpec,
  type SwarmHypothesis,
} from "./swarm-agent";

export { inferCheck, candidateFromHypothesis, hypothesisListSchema, READ_ONLY_TOOLS } from "./swarm-agent";
export type { SwarmAgentSpec, SwarmHypothesis } from "./swarm-agent";

const AGENTS: Record<string, SwarmAgentSpec> = {
  bug: {
    id: "luna-bug",
    kind: "bug",
    title: "Bug investigator",
    focus: "logic errors, inverted conditions, wrong values, off-by-one, null/undefined handling, removed behavior",
  },
  ui: {
    id: "luna-ui",
    kind: "ui",
    title: "UI/runtime investigator",
    focus: "React render crashes, hooks, event handlers, navigation targets, conditional rendering, missing elements",
  },
  regression: {
    id: "luna-regression",
    kind: "regression",
    title: "Regression investigator",
    focus: "behavior the diff changed or deleted: routes, redirects, filters, feature flags, list items, APIs",
  },
  security: {
    id: "luna-security",
    kind: "security",
    title: "Security investigator",
    focus: "auth bypass, open redirect, injection, XSS, secrets, unsafe deserialization, missing validation",
  },
};

export function selectAgents(context: PRContext): SwarmAgentSpec[] {
  const selected: SwarmAgentSpec[] = [AGENTS.bug, AGENTS.regression];
  const hasClient = context.files.some((file) => /\.(tsx|jsx)$/.test(file.path));
  const hasAuth = context.classification.includes("AUTH") || context.files.some((file) => /auth|session|login/i.test(file.path));
  if (hasClient) selected.push(AGENTS.ui);
  if (hasAuth || context.riskSignals.length > 0) selected.push(AGENTS.security);
  const hasServer = context.files.some((file) => /^(server|api)\//.test(file.path));
  if (hasServer && !selected.some((agent) => agent.kind === "api")) {
    selected.push({ id: "luna-api", kind: "api", title: "API investigator", focus: "request validation, response contracts, error handling, breaking changes" });
  }
  return selected.slice(0, 4);
}

function singleShotSystemPrompt(agent: SwarmAgentSpec): string {
  return [
    `You are the ${agent.title} in an autonomous code review swarm. Focus: ${agent.focus}.`,
    "You are given the real changed code with line numbers. Report only defects introduced or exposed by this diff.",
    "Rules:",
    "- At most 2 hypotheses. One strong hypothesis is better than two weak ones.",
    "- Every hypothesis must cite evidence as file:line where the line is part of the diff or its immediate context.",
    "- severity must be one of critical, high, medium, low, info.",
    "- confidence is a number between 0 and 1.",
    "- Do not report style, formatting, naming, or generic advice.",
    "- Do not repeat the deterministic findings list; only add distinct issues.",
    'Return JSON only: {"hypotheses":[{"claim":"...","evidence":["path:line"],"severity":"high","confidence":0.8,"suggestedExperiment":"..."}]}',
  ].join("\n");
}

function singleShotUserPrompt(agent: SwarmAgentSpec, context: PRContext, request: ReviewRequest, detectorClaims: string, diff: string): string {
  return [
    `PR #${request.pr.number}: ${request.pr.title}`,
    request.pr.body ? `Description: ${truncate(request.pr.body, 600)}` : "",
    `Classification: ${context.classification.join(", ")} | Size: ${context.size}`,
    request.rules && request.rules.length > 0 ? `Repo rules:\n- ${request.rules.slice(0, 6).join("\n- ")}` : "",
    detectorClaims ? `Already detected deterministically (do not repeat):\n${detectorClaims}` : "",
    `Changed code with real line numbers (">" marks changed lines):\n\n${diff}`,
    `Return the JSON for agent ${agent.id} now.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface SwarmOptions {
  sandbox?: Sandbox;
  profile?: RepoProfile;
  pack?: ContextPack;
  maxTurns?: number;
  maxToolsPerTurn?: number;
  /** "single-shot" forces the 3.1 diff-only path; "agentic" requires a pack. */
  mode?: SwarmMode;
  /** Cancellation signal from the owning stage (3.3). */
  signal?: AbortSignal;
}

export interface SwarmOutcome {
  candidates: Candidate[];
  report: SwarmReport;
}

const EMPTY_PROFILE: RepoProfile = {
  packageManager: "npm",
  installCommand: "npm ci",
  hasNodeModules: false,
  hasTests: false,
  scripts: {},
};

interface AgentOutcome {
  candidates: Candidate[];
  report: SwarmAgentReport;
}

function summarize(mode: SwarmReport["mode"], agents: AgentOutcome[], durationMs: number): SwarmOutcome {
  const candidates = agents.flatMap((agent) => agent.candidates);
  const report: SwarmReport = {
    mode,
    agents: agents.map((agent) => agent.report),
    hypotheses: agents.reduce((total, agent) => total + agent.report.hypotheses, 0),
    candidates: candidates.length,
    durationMs,
  };
  return { candidates, report };
}

/**
 * Runs the investigation swarm. With a prepared sandbox and a repo context pack
 * the investigators are agentic and read-only: each one explores the real
 * repository with tools before answering. Without a sandbox (dry mode, tests or
 * a failed setup) it falls back to one diff-only call per agent.
 */
export async function runSwarm(
  context: PRContext,
  request: ReviewRequest,
  detectors: Candidate[],
  models: ModelRouter,
  logger: Logger,
  budgetMs = 150_000,
  options: SwarmOptions = {},
): Promise<SwarmOutcome> {
  const started = Date.now();
  const agents = selectAgents(context);
  const deadline = started + budgetMs;
  const detectorClaims = detectors
    .slice(0, 6)
    .map((candidate) => `- ${candidate.evidence[0] ?? candidate.file ?? "?"}: ${candidate.claim.slice(0, 140)}`)
    .join("\n");

  const canRunAgentic = Boolean(options.sandbox && options.pack);
  const agentic = options.mode === "single-shot" ? false : canRunAgentic;
  if (options.mode === "agentic" && !canRunAgentic) {
    logger.warn("CORTADO_SWARM_MODE=agentic but no sandbox context pack is available; falling back to single-shot");
  }

  if (agentic && options.sandbox && options.pack) {
    const sandbox = options.sandbox;
    const pack = options.pack;
    const profile = options.profile ?? EMPTY_PROFILE;
    const outcomes = await mapLimit(agents, 4, (agent) =>
      runSwarmAgent({
        agent,
        context,
        request,
        detectorClaims,
        models,
        logger,
        sandbox,
        profile,
        pack,
        deadline,
        maxTurns: Math.max(1, options.maxTurns ?? 3),
        maxToolsPerTurn: Math.max(1, options.maxToolsPerTurn ?? 3),
        signal: options.signal,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`swarm agent crashed: ${agent.id}`, { error: message.slice(0, 200) });
        const report: SwarmAgentReport = {
          id: agent.id,
          kind: agent.kind,
          title: agent.title,
          status: "error",
          turns: 0,
          toolCalls: 0,
          hypotheses: 0,
          candidates: 0,
          durationMs: Date.now() - started,
          error: message,
        };
        return { candidates: [] as Candidate[], hypotheses: 0, report };
      }),
    );
    return summarize("agentic", outcomes, Date.now() - started);
  }

  const diff = renderCompactDiff(context.files, { maxChars: 18_000, contextLines: 8 });
  const outcomes = await mapLimit(agents, 4, async (agent): Promise<AgentOutcome> => {
    const agentStarted = Date.now();
    const remaining = deadline - Date.now();
    if (remaining < 5_000) {
      logger.warn(`swarm budget exhausted before ${agent.id} could run`);
      return {
        candidates: [],
        report: {
          id: agent.id,
          kind: agent.kind,
          title: agent.title,
          status: "budget",
          turns: 0,
          toolCalls: 0,
          hypotheses: 0,
          candidates: 0,
          durationMs: Date.now() - agentStarted,
        },
      };
    }
    try {
      const response = await models.complete({
        role: "luna",
        kind: "swarm_agent",
        system: singleShotSystemPrompt(agent),
        user: singleShotUserPrompt(agent, context, request, detectorClaims, diff),
        expectJson: true,
        timeoutMs: Math.max(8_000, Math.min(remaining - 2_000, 40_000)),
        retries: 0,
        signal: options.signal,
        label: agent.id,
      });
      const parsed = hypothesisListSchema.safeParse(extractJson(response.text));
      if (!parsed.success) {
        logger.warn(`swarm agent produced invalid JSON: ${agent.id}`, { error: parsed.error.message.slice(0, 200) });
        return {
          candidates: [],
          report: {
            id: agent.id,
            kind: agent.kind,
            title: agent.title,
            status: "error",
            turns: 1,
            toolCalls: 0,
            hypotheses: 0,
            candidates: 0,
            durationMs: Date.now() - agentStarted,
            error: `invalid JSON: ${parsed.error.message.slice(0, 160)}`,
          },
        };
      }
      const candidates = parsed.data.hypotheses.flatMap((hypothesis) => {
        const candidate = candidateFromHypothesis(hypothesis as SwarmHypothesis, agent, context);
        return candidate ? [candidate] : [];
      });
      logger.info(`swarm ${agent.id}: ${parsed.data.hypotheses.length} hypotheses in ${Date.now() - agentStarted}ms (single-shot)`);
      return {
        candidates,
        report: {
          id: agent.id,
          kind: agent.kind,
          title: agent.title,
          status: "completed",
          turns: 1,
          toolCalls: 0,
          hypotheses: parsed.data.hypotheses.length,
          candidates: candidates.length,
          durationMs: Date.now() - agentStarted,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`swarm agent failed: ${agent.id}`, { error: message.slice(0, 200) });
      return {
        candidates: [],
        report: {
          id: agent.id,
          kind: agent.kind,
          title: agent.title,
          status: "error",
          turns: 1,
          toolCalls: 0,
          hypotheses: 0,
          candidates: 0,
          durationMs: Date.now() - agentStarted,
          error: message,
        },
      };
    }
  });
  return summarize("single-shot", outcomes, Date.now() - started);
}
