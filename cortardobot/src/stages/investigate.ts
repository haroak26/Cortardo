/**
 * Investigate stage: specialized investigators run in parallel, read the real
 * code, and every claim must ship a reproduction script that fails twice.
 * Deterministic runtime scenarios (seeded from the diff) go through the same
 * gate, plus a base comparison to separate regressions from pre-existing bugs.
 */
import type { PRContext } from "../context/pack";
import { renderSwarmContext } from "../context/pack";
import type { RuntimeCapability, RuntimeScenarioSeed } from "../context/runtime";
import { runAgent } from "../agent/loop";
import { investigatorInitial, investigatorSystem, type InvestigatorSpec } from "../agent/prompts";
import { INVESTIGATOR_TOOLS, probeCommand, type RecordedProbe, type ToolContext } from "../agent/tools";
import { hashContent, truncate, type Logger } from "../util";
import { runArtifact } from "../artifact";
import type { ModelRouter } from "../models";
import type { CandidateRecord, Finding, ReproArtifact, RuntimeSurface, Sandbox, Severity } from "../types";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export function selectInvestigators(context: PRContext, max: number, runtime?: RuntimeCapability): InvestigatorSpec[] {
  const specs: InvestigatorSpec[] = [
    { id: "bug", title: "bug investigator", focus: "logic errors, wrong data, broken state, incorrect conditions, regressions in behavior" },
    { id: "regression", title: "regression investigator", focus: "existing behavior this change breaks: callers, shared state, deleted or altered contracts" },
  ];
  const hasUi = context.changedFiles.some((path) => /\.(tsx|jsx|vue|svelte)$/.test(path) || /\/(pages|components|app)\//.test(path));
  const hasSecurity = context.riskSignals.some((signal) => /auth|secret|crypto|billing/i.test(signal));
  const hasApi = context.changedFiles.some((path) => /\/(server|api|routes)\//.test(path) || /controller|handler|route/.test(path));
  if (hasUi) specs.push({ id: "ui", title: "UI investigator", focus: "user-visible behavior, storage, navigation, rendering and state bugs" });
  if (hasSecurity) specs.push({ id: "security", title: "security investigator", focus: "authorization, credential handling, injection, unsafe persistence" });
  if (hasApi || context.size === "complex") specs.push({ id: "api", title: "API investigator", focus: "request/response contracts, validation, error handling, breaking changes" });
  if (runtime?.enabled) {
    specs.push({
      id: "runtime",
      title: "runtime investigator",
      focus: "defects that only appear when the application actually runs: crashes, unhandled errors, broken flows, server errors",
    });
  }
  return specs.slice(0, Math.max(2, max));
}

export function mentionsTarget(finding: { file: string }, output: string): boolean {
  const stem = finding.file.split("/").pop()?.split(".")[0] ?? "";
  return stem.length >= 3 && output.toLowerCase().includes(stem.toLowerCase());
}

export interface ReproConfirmation {
  ok: boolean;
  category: "reproduced" | "not_reproduced" | "error";
  failures: number;
  output: string;
  reason: string;
}

/**
 * Runs the artifact twice on the pristine head. Confirmed only when both runs
 * fail and the output references the claim (file name or route).
 */
export async function confirmRepro(
  claim: { file: string; target?: string },
  artifact: ReproArtifact,
  sandbox: Sandbox,
  probeDir: string,
): Promise<ReproConfirmation> {
  const result = await runArtifact(sandbox, artifact, probeDir, {
    runs: 2,
    expect: "fail",
    target: claim.target ?? claim.file.split("/").pop()?.split(".")[0],
  });
  const output = truncate(result.outputs.join("\n---\n"), 2_400);
  if (result.passed) {
    return { ok: true, category: "reproduced", failures: result.failures, output, reason: "the reproduction fails twice and names the claim" };
  }
  if (result.harnessError) return { ok: false, category: "error", failures: result.failures, output, reason: result.reason };
  const target = claim.target ?? claim.file.split("/").pop()?.split(".")[0] ?? "";
  const mentions = result.failures > 0 && output.toLowerCase().includes(target.toLowerCase());
  return {
    ok: false,
    category: "not_reproduced",
    failures: result.failures,
    output,
    reason: result.failures === 0 ? result.reason : mentions ? result.reason : "the script fails but its output does not reference the claim; rejected as an unrelated failure",
  };
}

export interface BaseComparison {
  status: "pass" | "fail" | "error";
  output: string;
}

interface Hypothesis {
  claim: string;
  severity: Severity;
  confidence: number;
  file: string;
  line?: number;
  evidence: string[];
  probe: string;
  suggestedExperiment?: string;
}

function parseHypotheses(final: Record<string, unknown> | undefined): Hypothesis[] {
  const raw = final?.hypotheses;
  if (!Array.isArray(raw)) return [];
  const out: Hypothesis[] = [];
  for (const entry of raw.slice(0, 4)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const claim = typeof record.claim === "string" ? record.claim.trim() : "";
    const file = typeof record.file === "string" ? record.file.trim() : "";
    const probe = typeof record.probe === "string" ? record.probe.trim() : "";
    if (!claim || !file || !probe) continue;
    const severity = SEVERITIES.includes(record.severity as Severity) ? (record.severity as Severity) : "medium";
    const confidence = typeof record.confidence === "number" && record.confidence >= 0 && record.confidence <= 1 ? record.confidence : 0.5;
    out.push({
      claim,
      severity,
      confidence,
      file,
      line: typeof record.line === "number" ? record.line : undefined,
      evidence: Array.isArray(record.evidence) ? record.evidence.filter((item): item is string => typeof item === "string").slice(0, 6) : [],
      probe,
      suggestedExperiment: typeof record.suggestedExperiment === "string" ? record.suggestedExperiment : undefined,
    });
  }
  return out;
}

function artifactSurface(probe: { name: string; content: string }): ReproArtifact["surface"] {
  if (/playwright/.test(probe.content)) return "ui";
  return "logic";
}

function seedArtifact(seed: RuntimeScenarioSeed): ReproArtifact {
  const name = seed.scriptName;
  return {
    path: name,
    command: probeCommand(`.cortado-probes/${name}`, seed.script),
    content: seed.script,
    hash: hashContent(`${name}\n${seed.script}`),
    failures: 0,
    surface: seed.surface,
    setup: seed.setup,
    teardown: seed.teardown,
  };
}

function seedTarget(seed: RuntimeScenarioSeed): string {
  if (seed.surface === "ui") {
    const match = /page\s+([^\s]+)/.exec(seed.claim);
    return match?.[1] ?? seed.file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  }
  if (seed.surface === "api") {
    const match = /route\s+(?:[A-Z]+\s+)?([^\s]+)/.exec(seed.claim);
    return match?.[1] ?? seed.file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  }
  return seed.file.split("/").pop()?.split(".")[0] ?? "";
}

export interface InvestigateDeps {
  sandbox: Sandbox;
  transport: ModelRouter;
  context: PRContext;
  logger: Logger;
  maxAgents: number;
  maxHypotheses: number;
  maxTurns: number;
  maxToolsPerTurn: number;
  deadline: number;
  signal?: AbortSignal;
  /** Deterministic runtime scenarios generated from the diff. */
  seeds?: RuntimeScenarioSeed[];
  runtime?: RuntimeCapability;
  /** Replays an artifact at the PR base revision; provided by the engine. */
  baseCompare?: (artifact: ReproArtifact) => Promise<BaseComparison>;
  /** Injectable for tests: replaces the model transport entirely. */
  runAgentImpl?: typeof runAgent;
}

export interface InvestigateResult {
  findings: Finding[];
  candidates: CandidateRecord[];
}

function runtimeBrief(runtime: RuntimeCapability): string {
  return [
    "## Runtime surface",
    `The application can run here. Dev command: \`${runtime.devCommand ?? "n/a"}\` on port ${runtime.port}.`,
    `Surfaces in scope: ${runtime.surfaces.join(", ")}.`,
    "Use start_app to boot it, read_app_log to see its output, then write a Playwright or HTTP reproduction with write_probe and run it with run_probe.",
    "A runtime finding is accepted only when the script fails twice on this code. Prefer driving the exact flow changed by this pull request.",
  ].join("\n");
}

export async function investigateStage(deps: InvestigateDeps): Promise<InvestigateResult> {
  const { context, logger } = deps;
  const specs = selectInvestigators(context, deps.maxAgents, deps.runtime);
  const findings: Finding[] = [];
  const candidates: CandidateRecord[] = [];
  const probeDir = `${deps.sandbox.root}/.cortado-probes`;
  const agent = deps.runAgentImpl ?? runAgent;
  const seenClaims = new Set<string>();

  const recordCandidate = (input: {
    id: string;
    claim: string;
    severity: Severity;
    file: string;
    state: CandidateRecord["state"];
    reason: string;
    runtime?: CandidateRecord["runtime"];
  }) => {
    candidates.push({
      candidateId: input.id,
      claim: input.claim,
      severity: input.severity,
      file: input.file,
      state: input.state,
      reason: input.reason,
      runtime: input.runtime,
    });
  };

  // Deterministic runtime seeds from the diff, confirmed with the same gate.
  const seededSummaries: string[] = [];
  for (const seed of (deps.seeds ?? []).slice(0, 4)) {
    const dedupeKey = `${seed.file}::${seed.claim.toLowerCase().slice(0, 80)}`;
    if (seenClaims.has(dedupeKey)) continue;
    seenClaims.add(dedupeKey);
    const artifact = seedArtifact(seed);
    const confirmation = await confirmRepro({ file: seed.file, target: seedTarget(seed) }, artifact, deps.sandbox, probeDir);
    if (!confirmation.ok) {
      recordCandidate({
        id: stableCandidateId(seed),
        claim: seed.claim,
        severity: seed.severity,
        file: seed.file,
        state: confirmation.category === "error" ? "error" : "not_reproduced",
        reason: confirmation.reason,
        runtime: { surface: seed.surface, preExisting: false },
      });
      logger.info(`runtime smoke: ${seed.id} not reproduced — ${truncate(confirmation.reason, 160)}`);
      continue;
    }
    artifact.failures = confirmation.failures;
    const base = deps.baseCompare ? await deps.baseCompare(artifact).catch((error) => ({ status: "error" as const, output: error instanceof Error ? error.message : String(error) })) : undefined;
    const preExisting = base?.status === "fail";
    const baseReason = base ? (preExisting ? "the same scenario also fails on the base revision" : base.status === "pass" ? "the scenario passes on the base revision" : `base comparison unavailable: ${truncate(base.output, 160)}`) : "base comparison was not available";
    findings.push({
      id: stableCandidateId(seed),
      claim: seed.claim,
      severity: seed.severity,
      confidence: 0.9,
      file: seed.file,
      line: seed.line,
      evidence: [`runtime:${seed.id}`],
      state: "reproduced",
      repro: { artifact, explanation: confirmation.reason, output: confirmation.output },
      runtime: { surface: seed.surface, preExisting, baseReason },
    });
    recordCandidate({
      id: stableCandidateId(seed),
      claim: seed.claim,
      severity: seed.severity,
      file: seed.file,
      state: "reproduced",
      reason: preExisting ? `reproduced (pre-existing): ${baseReason}` : `reproduced: ${confirmation.reason}`,
      runtime: { surface: seed.surface, preExisting },
    });
    seededSummaries.push(`- ${seed.surface} ${seed.id}: ${seed.claim} (${preExisting ? "also fails on base" : "passes on base"})`);
    logger.info(`runtime smoke: reproduced ${seed.id}${preExisting ? " (pre-existing)" : ""}`);
  }

  const runs = await Promise.all(
    specs.map(async (spec) => {
      const probes: RecordedProbe[] = [];
      const readFiles = new Set<string>();
      const toolContext: ToolContext = {
        sandbox: deps.sandbox,
        graph: context.graph,
        context,
        profile: context.profile,
        probeDir,
        phase: `investigate:${spec.id}`,
        logger,
        signal: deps.signal,
        recordProbe: (probe) => {
          probes.push(probe);
        },
      };
      const baseUser = renderSwarmContext(context, { investigator: spec.title, focus: spec.focus });
      const runtimeUser = spec.id === "runtime" && deps.runtime?.enabled ? `${baseUser}\n\n${runtimeBrief(deps.runtime)}` : baseUser;
      const seedUser = spec.id === "runtime" && seededSummaries.length > 0 ? `${runtimeUser}\n\n## Runtime smoke results from the diff\n${seededSummaries.join("\n")}` : runtimeUser;
      const result = await agent({
        role: "investigator",
        kind: "investigate",
        system: investigatorSystem(spec),
        user: investigatorInitial(seedUser, spec),
        allowedTools: INVESTIGATOR_TOOLS,
        toolContext,
        transport: deps.transport,
        logger,
        maxTurns: deps.maxTurns,
        maxToolsPerTurn: deps.maxToolsPerTurn,
        deadline: deps.deadline,
        signal: deps.signal,
        label: `investigate-${spec.id}`,
        isFinal: (parsed) => Array.isArray(parsed.hypotheses),
      });
      for (const observation of result.observations) {
        const match = /^read (.+?) \(/.exec(observation.summary);
        if (observation.tool === "read_file" && match) readFiles.add(match[1]);
      }
      logger.info(`investigate ${spec.id}: ${result.stoppedReason} (${result.turns} turn(s), ${result.toolCalls} tool call(s))`);
      return { spec, hypothesised: parseHypotheses(result.final), probes, readFiles };
    }),
  );

  for (const run of runs) {
    for (const hypothesis of run.hypothesised.slice(0, deps.maxHypotheses)) {
      const dedupeKey = `${hypothesis.file}::${hypothesis.claim.toLowerCase().slice(0, 80)}`;
      if (seenClaims.has(dedupeKey)) continue;
      seenClaims.add(dedupeKey);
      const id = stableCandidateId(hypothesis);

      if (!context.changedFiles.includes(hypothesis.file)) {
        recordCandidate({ id, claim: hypothesis.claim, severity: hypothesis.severity, file: hypothesis.file, state: "not_reproduced", reason: "the claimed file is not part of this pull request" });
        continue;
      }
      if (!run.readFiles.has(hypothesis.file)) {
        recordCandidate({ id, claim: hypothesis.claim, severity: hypothesis.severity, file: hypothesis.file, state: "not_reproduced", reason: "the claim was made without reading the file" });
        continue;
      }

      const recorded = [...run.probes].reverse().find((probe) => probe.name === hypothesis.probe);
      if (!recorded) {
        recordCandidate({ id, claim: hypothesis.claim, severity: hypothesis.severity, file: hypothesis.file, state: "not_reproduced", reason: `no recorded probe named ${hypothesis.probe}` });
        continue;
      }

      const artifact: ReproArtifact = {
        path: recorded.name,
        command: recorded.command || probeCommand(`.cortado-probes/${recorded.name}`, recorded.content),
        content: recorded.content,
        hash: hashContent(`${recorded.name}\n${recorded.content}`),
        failures: 0,
        surface: run.spec.id === "runtime" ? artifactSurface(recorded) : "logic",
      };
      const confirmation = await confirmRepro(hypothesis, artifact, deps.sandbox, probeDir);
      if (!confirmation.ok) {
        recordCandidate({
          id,
          claim: hypothesis.claim,
          severity: hypothesis.severity,
          file: hypothesis.file,
          state: confirmation.category === "error" ? "error" : "not_reproduced",
          reason: confirmation.reason,
          runtime: run.spec.id === "runtime" ? { surface: artifact.surface as RuntimeSurface, preExisting: false } : undefined,
        });
        logger.info(`investigate ${run.spec.id}: dropped ${hypothesis.file} — ${confirmation.reason}`);
        continue;
      }

      artifact.failures = confirmation.failures;
      const runtimeFinding = run.spec.id === "runtime";
      let preExisting = false;
      let baseReason: string | undefined;
      if (runtimeFinding && deps.baseCompare) {
        const base = await deps.baseCompare(artifact).catch((error) => ({ status: "error" as const, output: error instanceof Error ? error.message : String(error) }));
        preExisting = base.status === "fail";
        baseReason = preExisting ? "the same scenario also fails on the base revision" : base.status === "pass" ? "the scenario passes on the base revision" : `base comparison unavailable: ${truncate(base.output, 160)}`;
      }
      findings.push({
        id,
        claim: hypothesis.claim,
        severity: hypothesis.severity,
        confidence: hypothesis.confidence,
        file: hypothesis.file,
        line: hypothesis.line,
        evidence: hypothesis.evidence,
        state: "reproduced",
        suggestedExperiment: hypothesis.suggestedExperiment,
        repro: { artifact, explanation: confirmation.reason, output: confirmation.output },
        runtime: runtimeFinding ? { surface: artifact.surface as RuntimeSurface, preExisting, baseReason } : undefined,
      });
      recordCandidate({
        id,
        claim: hypothesis.claim,
        severity: hypothesis.severity,
        file: hypothesis.file,
        state: "reproduced",
        reason: confirmation.reason,
        runtime: runtimeFinding ? { surface: artifact.surface as RuntimeSurface, preExisting } : undefined,
      });
      logger.info(`investigate ${run.spec.id}: reproduced ${hypothesis.file} — ${truncate(hypothesis.claim, 120)}`);
    }
  }

  return { findings, candidates };
}

export function stableCandidateId(input: { file: string; line?: number; claim: string }): string {
  return `c_${hashContent(`${input.file}:${input.line ?? ""}:${input.claim}`).slice(0, 10)}`;
}
