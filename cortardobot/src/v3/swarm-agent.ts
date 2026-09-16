import { z } from "zod";
import type {
  AgentKind,
  Candidate,
  ContextPack,
  ModelMessage,
  PRContext,
  ReviewRequest,
  SwarmAgentReport,
  ToolCall,
  ToolName,
  ToolObservation,
} from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import type { ModelRouter } from "./models";
import { extractJson, stableId, truncate, type Logger } from "./util";
import { routeForPage } from "./intelligence";
import { executeTool, type ToolContext } from "./agent/tools";
import { TranscriptRecorder, renderObservations } from "./agent/transcript";
import { renderSwarmContext } from "./agent/context-pack";
import { AGENT_PROTOCOL_VERSION } from "./version";

export interface SwarmAgentSpec {
  id: string;
  kind: AgentKind;
  title: string;
  focus: string;
}

/**
 * Investigators are read-only by construction. Anything that mutates the repo,
 * writes probes or runs untrusted code is rejected before reaching the tool
 * executor so the swarm can never change the code under review.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "list_dir",
  "find_files",
  "search_code",
  "get_symbols",
  "find_references",
  "get_tests_for",
  "read_test",
  "git_diff",
]);

const hypothesisSchema = z.object({
  claim: z
    .string()
    .min(8)
    .transform((value) => (value.length > 499 ? `${value.slice(0, 496)}...` : value)),
  evidence: z
    .array(z.string().min(3))
    .min(1)
    .transform((entries) => entries.slice(0, 6)),
  severity: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(["critical", "high", "medium", "low", "info"]).catch("medium")),
  confidence: z
    .union([z.number(), z.string()])
    .transform((value) => {
      const numeric = typeof value === "number" ? value : Number(String(value).replace("%", ""));
      if (!Number.isFinite(numeric)) return 0.5;
      return numeric > 1 ? numeric / 100 : numeric;
    })
    .pipe(z.number().min(0).max(1).catch(0.5)),
  suggestedExperiment: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.slice(0, 300)),
});

export type SwarmHypothesis = z.infer<typeof hypothesisSchema>;

export const hypothesisListSchema = z.object({
  // Arrays are clamped, never rejected: one over-long response must not kill
  // the whole investigator and lose its hypotheses (3.4).
  hypotheses: z.array(hypothesisSchema),
});

const actionSchema = z.object({
  thought: z.string().max(800).optional().default(""),
  actions: z
    .array(
      z.object({
        tool: z.string().min(1),
        args: z.record(z.unknown()).optional().default({}),
      }),
    )
    .optional()
    .default([]),
  hypotheses: z.array(hypothesisSchema).optional(),
  done: z.boolean().optional().default(false),
  summary: z.string().max(600).optional(),
});

function parseEvidence(entry: string): { file: string; line: number } | undefined {
  const cleaned = entry.trim().replace(/^`+|`+$/g, "").replace(/^\.\//, "");
  const match = /^(.+?):(\d+)/.exec(cleaned);
  if (!match) return undefined;
  const file = match[1].trim();
  if (!file || file.includes(" ")) return undefined;
  return { file, line: Number(match[2]) };
}

function quoted(value: string): string | undefined {
  const match = /["'`]([^"'`\n]{3,48})["'`]/.exec(value);
  return match?.[1];
}

export function inferCheck(candidate: { claim: string; file?: string; evidence: string[] }, context: PRContext): Candidate["check"] {
  const file = candidate.file;
  if (!file) return undefined;
  const route = routeForPage(file);
  const isClientPage = Boolean(route) && context.files.some((entry) => entry.path === file);
  if (!isClientPage || !route) return undefined;
  const claim = candidate.claim.toLowerCase();
  if (/(crash|throw|typeerror|referenceerror|undefined|blank|render|pageerror|500|uncaught)/.test(claim)) {
    return { path: route, assert: { type: "noPageError" }, expected: "pass", label: "page must render without a runtime error" };
  }
  if (/(missing|removed|disappear|not rendered|hidden|absent)/.test(claim)) {
    const text = quoted(candidate.claim);
    if (text && text.length >= 3) {
      return { path: route, assert: { type: "textContains", value: text }, expected: "pass", label: `page must contain "${text}"` };
    }
  }
  if (/(redirect|navigat|send(s)? users|wrong page|goes to)/.test(claim)) {
    const target = quoted(candidate.claim);
    if (target && target.startsWith("/")) {
      return { path: route, assert: { type: "pathEquals", value: target }, expected: "pass", label: `page must stay on or reach ${target}` };
    }
  }
  return undefined;
}

/** Maps a parsed hypothesis to a candidate, dropping unresolvable evidence. */
export function candidateFromHypothesis(hypothesis: SwarmHypothesis, agent: SwarmAgentSpec, context: PRContext): Candidate | undefined {
  const evidence = hypothesis.evidence
    .map(parseEvidence)
    .filter((entry): entry is { file: string; line: number } => entry !== undefined && context.files.some((file) => file.path === entry.file));
  if (evidence.length === 0) return undefined;
  const first = evidence[0];
  const candidate: Candidate = {
    id: stableId("c", agent.id, hypothesis.claim.slice(0, 120), first.file, String(first.line)),
    claim: hypothesis.claim.trim(),
    severity: hypothesis.severity,
    confidence: hypothesis.confidence,
    file: first.file,
    line: first.line,
    evidence: evidence.map((entry) => `${entry.file}:${entry.line}`),
    source: "luna",
    agentKind: agent.kind,
    suggestedProof: "none",
    suggestedExperiment: hypothesis.suggestedExperiment || undefined,
    proofPlan: hypothesis.suggestedExperiment || undefined,
    tags: [agent.kind],
    occurrences: 1,
    mergedFrom: [],
    score: 0,
  };
  candidate.check = inferCheck(candidate, context);
  // The proof strategy is decided by the prover (repo-wide tests, probes),
  // never by a filename heuristic. A browser check is the only strategy that
  // is already known here, so it is the only one set (3.4).
  candidate.suggestedProof = candidate.check ? "browser" : "none";
  return candidate;
}

export function investigatorSystemPrompt(agent: SwarmAgentSpec): string {
  return [
    `You are the ${agent.title} in an autonomous code review swarm (protocol ${AGENT_PROTOCOL_VERSION}).`,
    `Focus: ${agent.focus}.`,
    "You investigate a real repository clone through read-only tools. You cannot edit files, write probes or execute repository code.",
    "Report only defects introduced or exposed by the current diff, and verify each claim against the real code before reporting it.",
    "Rules:",
    "- At most 2 hypotheses. One strong, well-evidenced hypothesis is better than two weak ones.",
    "- Investigate before answering: use the tools to read the real code and confirm the behaviour. Do not answer from the diff summary alone.",
    "- Every hypothesis must cite evidence as path:line where the path is one of the changed files and the line is part of the diff or its immediate context.",
    "- severity is one of critical, high, medium, low, info. confidence is a number between 0 and 1.",
    "- Do not report style, formatting, naming, or generic advice.",
    "- The deterministic detectors already reported the issues listed in the user message. Do not restate them unless you can materially strengthen the evidence or severity; prefer distinct issues.",
    "Tools: read_file {path,start?,end?}, list_dir {path?}, find_files {glob}, search_code {pattern,path?}, get_symbols {path}, find_references {symbol,path?}, get_tests_for {path}, read_test {path,start?,end?}, git_diff {}.",
    "JSON only, one object per turn:",
    '{"thought":"...","actions":[{"tool":"read_file","args":{"path":"src/app.ts"}}]}',
    'When you have enough evidence (or nothing to add), answer with {"hypotheses":[{"claim":"...","evidence":["path:line"],"severity":"high","confidence":0.8,"suggestedExperiment":"..."}]}.',
    "An empty hypotheses list is a valid, honest answer when the deterministic findings already cover this diff.",
  ].join("\n");
}

function initialInvestigatorPrompt(
  agent: SwarmAgentSpec,
  request: ReviewRequest,
  context: PRContext,
  detectorClaims: string,
  pack: ContextPack,
): string {
  return [
    `PR #${request.pr.number}: ${request.pr.title}`,
    request.pr.body ? `Description: ${truncate(request.pr.body, 600)}` : "",
    `Classification: ${context.classification.join(", ")} | Size: ${context.size}`,
    request.rules && request.rules.length > 0 ? `Repo rules:\n- ${request.rules.slice(0, 6).join("\n- ")}` : "",
    detectorClaims ? `Deterministic detectors already reported:\n${detectorClaims}` : "",
    renderSwarmContext(pack),
    `Investigate now as ${agent.id}. Return the first JSON action object.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function continueInvestigatorPrompt(observationsText: string): string {
  return [
    "## Observations from your last actions",
    observationsText || "(no observations)",
    'Return the next JSON action object, or answer with {"hypotheses":[...]} when you have enough evidence.',
  ].join("\n\n");
}

function finalInvestigatorPrompt(): string {
  return [
    "Investigation turns are over.",
    'Return the final answer now: {"hypotheses":[{"claim":"...","evidence":["path:line"],"severity":"high","confidence":0.8,"suggestedExperiment":"..."}]}.',
    "Use an empty list if there is nothing beyond the deterministic findings.",
  ].join("\n");
}

function syntheticCandidate(agent: SwarmAgentSpec): Candidate {
  return {
    id: agent.id,
    claim: agent.title,
    severity: "info",
    confidence: 0.5,
    evidence: [],
    source: "luna",
    agentKind: agent.kind,
    suggestedProof: "none",
    tags: [agent.kind],
    occurrences: 1,
    mergedFrom: [],
    score: 0,
  };
}

export interface SwarmAgentDeps {
  agent: SwarmAgentSpec;
  context: PRContext;
  request: ReviewRequest;
  detectorClaims: string;
  models: ModelRouter;
  logger: Logger;
  sandbox: Sandbox;
  profile: RepoProfile;
  pack: ContextPack;
  /** Absolute epoch ms after which no new model call may start. */
  deadline: number;
  maxTurns: number;
  maxToolsPerTurn: number;
  /** Cancellation signal from the owning stage (3.3). */
  signal?: AbortSignal;
}

export interface SwarmAgentOutcome {
  candidates: Candidate[];
  hypotheses: number;
  report: SwarmAgentReport;
}

export async function runSwarmAgent(deps: SwarmAgentDeps): Promise<SwarmAgentOutcome> {
  const started = Date.now();
  const agent = deps.agent;
  const recorder = new TranscriptRecorder(agent.id);
  const messages: ModelMessage[] = [];
  const system = investigatorSystemPrompt(agent);
  let turns = 0;
  let hypothesesCount = 0;
  let candidates: Candidate[] = [];
  let status: SwarmAgentReport["status"] = "completed";
  let error: string | undefined;
  let answered = false;

  const toolContext: ToolContext = {
    sandbox: deps.sandbox,
    profile: deps.profile,
    candidate: syntheticCandidate(agent),
    context: deps.context,
    pack: deps.pack,
    logger: deps.logger,
    probeDir: `${deps.sandbox.root}/.cortado-probes`,
    signal: deps.signal,
    runReproduction: async () => {
      throw new Error("investigators cannot run reproductions");
    },
    recordAppliedEdits: () => undefined,
  };

  const acceptHypotheses = (hypotheses: SwarmHypothesis[]): void => {
    const accepted = hypotheses.slice(0, 2);
    hypothesesCount = accepted.length;
    candidates = accepted.flatMap((hypothesis) => {
      const candidate = candidateFromHypothesis(hypothesis, agent, deps.context);
      if (!candidate) {
        deps.logger.warn(`swarm ${agent.id}: dropped hypothesis with unresolvable evidence`, { claim: hypothesis.claim.slice(0, 120) });
        return [];
      }
      return [candidate];
    });
    answered = true;
  };

  let nextUser = initialInvestigatorPrompt(agent, deps.request, deps.context, deps.detectorClaims, deps.pack);
  for (let turn = 1; turn <= Math.max(1, deps.maxTurns); turn++) {
    const remaining = deps.deadline - Date.now();
    if (remaining < 8_000) {
      status = "budget";
      break;
    }
    let raw: string;
    try {
      const response = await deps.models.complete({
        role: "luna",
        kind: "swarm_agent",
        system,
        user: nextUser,
        history: messages,
        expectJson: true,
        timeoutMs: Math.max(8_000, Math.min(remaining - 2_000, 45_000)),
        retries: 0,
        signal: deps.signal,
        label: agent.id,
      });
      raw = response.text;
    } catch (caught) {
      status = "error";
      error = caught instanceof Error ? caught.message : String(caught);
      deps.logger.warn(`swarm agent failed: ${agent.id}`, { error: error.slice(0, 200) });
      break;
    }
    turns += 1;

    const parsed = actionSchema.safeParse(extractJson(raw));
    if (!parsed.success) {
      status = "error";
      error = `invalid JSON: ${parsed.error.message.slice(0, 200)}`;
      deps.logger.warn(`swarm agent produced invalid JSON: ${agent.id}`, { error: error.slice(0, 200) });
      break;
    }
    const action = parsed.data;

    if (action.hypotheses !== undefined) {
      acceptHypotheses(action.hypotheses);
      break;
    }

    const requested: ToolCall[] = (action.actions ?? []).slice(0, Math.max(1, deps.maxToolsPerTurn)).map((entry) => ({
      tool: entry.tool as ToolName,
      args: (entry.args ?? {}) as Record<string, unknown>,
    }));
    if (action.done || requested.some((call) => call.tool === "finish")) {
      answered = true;
      break;
    }
    if (requested.length === 0) {
      status = "error";
      error = "agent returned no actions and no hypotheses";
      deps.logger.warn(`swarm agent returned no actions: ${agent.id}`);
      break;
    }

    const observations: ToolObservation[] = [];
    for (const call of requested) {
      if (!READ_ONLY_TOOLS.has(call.tool)) {
        observations.push({
          tool: call.tool,
          ok: false,
          summary: `${call.tool} is not available to investigators`,
          detail: `Investigators are read-only. Allowed tools: ${[...READ_ONLY_TOOLS].join(", ")}.`,
          durationMs: 0,
        });
        continue;
      }
      observations.push(await executeTool(call, toolContext));
    }

    recorder.addTurn({
      turn,
      thought: action.thought,
      actions: requested,
      observations,
      modelId: deps.models.idFor("luna"),
      durationMs: 0,
    });
    messages.push({ role: "user", content: nextUser });
    messages.push({ role: "assistant", content: raw.slice(0, 1_200) });
    nextUser = continueInvestigatorPrompt(renderObservations(observations));
  }

  if (!answered && status === "completed") {
    const remaining = deps.deadline - Date.now();
    if (remaining < 8_000) {
      status = "budget";
    } else {
      try {
        const response = await deps.models.complete({
          role: "luna",
          kind: "swarm_agent_final",
          system,
          user: finalInvestigatorPrompt(),
          history: messages,
          expectJson: true,
          timeoutMs: Math.max(8_000, Math.min(remaining - 2_000, 45_000)),
          retries: 0,
          signal: deps.signal,
          label: `${agent.id}-final`,
        });
        turns += 1;
        const parsed = hypothesisListSchema.safeParse(extractJson(response.text));
        if (parsed.success) acceptHypotheses(parsed.data.hypotheses);
        else {
          status = "error";
          error = `final answer was not valid JSON: ${parsed.error.message.slice(0, 160)}`;
          deps.logger.warn(`swarm agent final answer invalid: ${agent.id}`, { error: error.slice(0, 200) });
        }
      } catch (caught) {
        status = "error";
        error = caught instanceof Error ? caught.message : String(caught);
        deps.logger.warn(`swarm agent final call failed: ${agent.id}`, { error: error.slice(0, 200) });
      }
    }
  }

  if (answered && candidates.length === 0) {
    deps.logger.info(`swarm ${agent.id}: 0 hypotheses in ${Date.now() - started}ms`);
  } else if (answered) {
    deps.logger.info(`swarm ${agent.id}: ${hypothesesCount} hypotheses, ${candidates.length} candidate(s) in ${Date.now() - started}ms`);
  }

  return {
    candidates,
    hypotheses: hypothesesCount,
    report: {
      id: agent.id,
      kind: agent.kind,
      title: agent.title,
      status,
      turns,
      toolCalls: recorder.count,
      hypotheses: hypothesesCount,
      candidates: candidates.length,
      durationMs: Date.now() - started,
      error,
      transcript: recorder.snapshot(),
    },
  };
}
