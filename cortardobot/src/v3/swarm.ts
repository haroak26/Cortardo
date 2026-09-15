import type { AgentKind, Candidate, PRContext, ReviewRequest, BrowserCheck } from "./types";
import type { ModelRouter } from "./models";
import { mapLimit, stableId, extractJson, truncate, type Logger } from "./util";
import { renderCompactDiff } from "./patch";
import { routeForPage } from "./intelligence";
import { z } from "zod";

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

const hypothesisListSchema = z.object({
  hypotheses: z.array(hypothesisSchema).max(4),
});

interface AgentSpec {
  id: string;
  kind: AgentKind;
  title: string;
  focus: string;
}

const AGENTS: Record<string, AgentSpec> = {
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

export function selectAgents(context: PRContext): AgentSpec[] {
  const selected: AgentSpec[] = [AGENTS.bug, AGENTS.regression];
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

function systemPrompt(agent: AgentSpec): string {
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
    "Return JSON only: {\"hypotheses\":[{\"claim\":\"...\",\"evidence\":[\"path:line\"],\"severity\":\"high\",\"confidence\":0.8,\"suggestedExperiment\":\"...\"}]}",
  ].join("\n");
}

function userPrompt(agent: AgentSpec, context: PRContext, request: ReviewRequest, detectorClaims: string, diff: string): string {
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

export function inferCheck(candidate: { claim: string; file?: string; evidence: string[] }, context: PRContext): BrowserCheck | undefined {
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

export async function runSwarm(
  context: PRContext,
  request: ReviewRequest,
  detectors: Candidate[],
  models: ModelRouter,
  logger: Logger,
  budgetMs = 150_000,
): Promise<Candidate[]> {
  const agents = selectAgents(context);
  const deadline = Date.now() + budgetMs;
  const diff = renderCompactDiff(context.files, { maxChars: 18_000, contextLines: 8 });
  const detectorClaims = detectors
    .slice(0, 6)
    .map((candidate) => `- ${candidate.evidence[0] ?? candidate.file ?? "?"}: ${candidate.claim.slice(0, 140)}`)
    .join("\n");

  const results = await mapLimit(agents, 4, async (agent) => {
    const started = Date.now();
    const remaining = deadline - Date.now();
    if (remaining < 5_000) {
      logger.warn(`swarm budget exhausted before ${agent.id} could run`);
      return [] as Candidate[];
    }
    try {
      const response = await models.complete({
        role: "luna",
        kind: "swarm_agent",
        system: systemPrompt(agent),
        user: userPrompt(agent, context, request, detectorClaims, diff),
        expectJson: true,
        timeoutMs: Math.max(8_000, Math.min(remaining - 2_000, 40_000)),
        retries: 0,
        label: agent.id,
      });
      const parsed = hypothesisListSchema.safeParse(extractJson(response.text));
      if (!parsed.success) {
        logger.warn(`swarm agent produced invalid JSON: ${agent.id}`, { error: parsed.error.message.slice(0, 200) });
        return [] as Candidate[];
      }
      logger.info(`swarm ${agent.id}: ${parsed.data.hypotheses.length} hypotheses in ${Date.now() - started}ms`);
      return parsed.data.hypotheses.flatMap((hypothesis) => {
        const evidence = hypothesis.evidence
          .map(parseEvidence)
          .filter((entry): entry is { file: string; line: number } => entry !== undefined && context.files.some((file) => file.path === entry.file));
        if (evidence.length === 0) return [];
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
          tags: [agent.kind],
          occurrences: 1,
          score: 0,
          mergedFrom: [],
        };
        candidate.check = inferCheck(candidate, context);
        candidate.suggestedProof = candidate.check ? "browser" : context.tests.some((test) => /auth|docs|pricing/i.test(test)) ? "targeted_test" : "none";
        return [candidate];
      });
    } catch (error) {
      logger.warn(`swarm agent failed: ${agent.id}`, { error: error instanceof Error ? error.message : String(error) });
      return [] as Candidate[];
    }
  });

  return results.flat();
}
