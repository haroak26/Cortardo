import { z } from "zod";
import type {
  AuthoredProbe,
  Candidate,
  ContextPack,
  JudgeDecision,
  LoopCandidateCoverage,
  LoopCoverage,
  ModelMessage,
  PRContext,
  ProofArtifact,
  ProofResult,
  ProofState,
  ToolCall,
  ToolObservation,
} from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import type { ModelRouter } from "./models";
import { buildContextPack, renderContextPack } from "./agent/context-pack";
import { executeTool, type ToolContext } from "./agent/tools";
import { proverContinuePrompt, proverInitialPrompt, proverSystemPrompt } from "./agent/prompts";
import { extractJson, hashContent, truncate, type Logger } from "./util";
import { relatedTestsFor } from "./test-index";

/**
 * 3.4 prover: turns a judge-approved claim into an executable reproduction.
 * Candidates that already have a deterministic plan (browser check or related
 * repository test) are left to the proof stage; everything else is authored
 * here. Tier 1 is Luna, tier 2 escalates a near-miss on a high/critical
 * finding to the codegen role. Every handled candidate ends in PROVEN or a
 * recorded UNPROVABLE/BUDGET state.
 */
export interface ProverDeps {
  sandbox: Sandbox;
  profile: RepoProfile;
  context: PRContext;
  models: ModelRouter;
  logger: Logger;
  instructions?: string;
  maxCandidates: number;
  /** Luna attempts per candidate before recording UNPROVABLE or escalating. */
  attempts?: number;
  maxTurns: number;
  maxToolsPerTurn: number;
  escalations: number;
  /** Absolute epoch ms after which the prover may not start new work. */
  deadline: number;
  now?: () => number;
  signal?: AbortSignal;
}

export interface ProverOutcome {
  /** Confirmed reproductions authored by the prover, artifact attached. */
  proofs: ProofResult[];
  /** Recorded UNPROVABLE/BUDGET coverage for candidates without a proof. */
  coverage: LoopCandidateCoverage[];
}

const PROVER_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "list_dir",
  "find_files",
  "search_code",
  "get_symbols",
  "get_tests_for",
  "read_test",
  "run_test_file",
  "write_probe",
  "run_probe",
  "finish",
]);

const actionSchema = z.object({
  thought: z.string().max(1_200).optional().default(""),
  actions: z
    .array(
      z.object({
        tool: z.string().min(1),
        args: z.record(z.unknown()).optional().default({}),
      }),
    )
    .optional()
    .default([]),
  done: z.boolean().optional().default(false),
  summary: z.string().max(700).optional(),
});

function mentionsTarget(candidate: Candidate, output: string): boolean {
  const targetName = (candidate.file ?? "").split("/").pop()?.split(".")[0] ?? "";
  return targetName.length > 0 && output.toLowerCase().includes(targetName.toLowerCase());
}

const HARNESS_ERROR_RE = /startup error|no test files|missing script|no such file|Cannot find module|MODULE_NOT_FOUND|ENOENT|command not found/i;

function artifactFromProbe(probe: AuthoredProbe): ProofArtifact {
  return {
    kind: "probe",
    path: probe.name,
    content: probe.content,
    command: probe.command,
    preFixFailures: 2,
    artifactHash: hashContent(`${probe.name}\n${probe.content}\n${probe.command}`),
    reason: "model-authored probe failed twice on the pull request head",
  };
}

interface ProverAttempt {
  /** Fully-formed confirmed proof (artifact included) when the prover succeeded. */
  proof?: ProofResult;
  nearMiss: boolean;
  summary?: string;
  probes: number;
}

const BY_SEVERITY: Record<Candidate["severity"], number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

/**
 * Confirms a failed probe by running it a second time and requiring the same
 * failure with output that references the candidate. A single failure can be a
 * flake; a failure without the target in its output can be an unrelated error.
 */
async function confirmProbe(candidate: Candidate, probe: AuthoredProbe, deps: ProverDeps): Promise<{ proof?: ProofResult; reason?: string }> {
  const run = await deps.sandbox.exec(probe.command, {
    cwd: deps.sandbox.root,
    timeoutMs: 120_000,
    allowFailure: true,
    signal: deps.signal,
  });
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.timedOut) return { reason: `the probe timed out on the confirmation run: ${truncate(output, 240)}` };
  if (HARNESS_ERROR_RE.test(output)) return { reason: `the probe could not run: ${truncate(output, 240)}` };
  if (run.exitCode === 0) return { reason: "the probe passed on the confirmation run (flake guard); not a reproduction" };
  if (!mentionsTarget(candidate, output)) {
    return { reason: `the probe fails but its output does not reference ${candidate.file ?? "the candidate"}; rejected as an unrelated failure` };
  }
  const artifact = artifactFromProbe(probe);
  const proof: ProofResult = {
    candidateId: candidate.id,
    status: "confirmed",
    strategy: "probe",
    attempts: [
      {
        strategy: "probe",
        command: probe.command,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        output: truncate(output, 2_400),
        matched: true,
        durationMs: run.durationMs,
      },
    ],
    reproduction: `${probe.command}\n${truncate(output, 700)}`,
    explanation: `Reproduced by the model-authored probe ${probe.name}; it fails twice on the pull request head`,
    durationMs: run.durationMs,
    artifact,
  };
  return { proof };
}

/** A single prover agent run (tier 1 = luna, tier 2 = codegen escalation). */
async function runProverAgent(candidate: Candidate, role: "luna" | "codegen", deps: ProverDeps): Promise<ProverAttempt> {
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger;
  const system = proverSystemPrompt();
  const messages: ModelMessage[] = [];
  const probes: AuthoredProbe[] = [];
  let nearMiss = false;
  let summary: string | undefined;

  let pack: ContextPack;
  try {
    pack = await buildContextPack({
      candidate,
      context: deps.context,
      sandbox: deps.sandbox,
      profile: deps.profile,
      proof: {
        candidateId: candidate.id,
        status: "error",
        strategy: "none",
        attempts: [],
        reproduction: candidate.suggestedExperiment ?? "no reproduction yet",
        explanation: "the prover has not produced a reproduction yet",
        durationMs: 0,
      },
      instructions: deps.instructions,
    });
  } catch (error) {
    logger.warn(`prover could not build a context pack for ${candidate.id}`, { error: error instanceof Error ? error.message : String(error) });
    return { nearMiss: false, summary: `context pack unavailable: ${error instanceof Error ? error.message : String(error)}`, probes: 0 };
  }

  const toolContext: ToolContext = {
    sandbox: deps.sandbox,
    profile: deps.profile,
    candidate,
    context: deps.context,
    pack,
    logger,
    probeDir: `${deps.sandbox.root}/.cortado-probes`,
    signal: deps.signal,
    runReproduction: async () => {
      throw new Error("the prover cannot run an authoritative reproduction it has not authored");
    },
    recordAppliedEdits: () => undefined,
    recordProbe: (probe) => probes.push(probe),
  };

  let nextUser = proverInitialPrompt(renderContextPack(pack), candidate.claim, candidate.suggestedExperiment, candidate.evidence);
  for (let turn = 1; turn <= Math.max(1, deps.maxTurns); turn++) {
    const remaining = deps.deadline - now();
    if (remaining < 8_000) {
      summary = "prover budget exhausted before a reproduction was produced";
      break;
    }
    let raw: string;
    try {
      const response = await deps.models.complete({
        role,
        kind: "prover",
        system,
        user: nextUser,
        history: messages,
        expectJson: true,
        maxTokens: role === "codegen" ? 5_000 : 3_000,
        timeoutMs: Math.max(8_000, Math.min(remaining - 2_000, 45_000)),
        retries: 0,
        signal: deps.signal,
        label: `prover-${candidate.id}-${role}-t${turn}`,
      });
      raw = response.text;
    } catch (error) {
      summary = `prover model call failed: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }

    const parsed = actionSchema.safeParse(extractJson(raw));
    if (!parsed.success) {
      summary = `prover returned invalid JSON: ${parsed.error.message.slice(0, 200)}`;
      break;
    }
    const action = parsed.data;
    const calls: ToolCall[] = (action.actions ?? []).slice(0, Math.max(1, deps.maxToolsPerTurn)).map((entry) => ({
      tool: entry.tool as ToolCall["tool"],
      args: (entry.args ?? {}) as Record<string, unknown>,
    }));

    const observations: ToolObservation[] = [];
    for (const call of calls) {
      if (!PROVER_TOOLS.has(call.tool)) {
        observations.push({
          tool: call.tool,
          ok: false,
          summary: `${call.tool} is not available to the prover`,
          detail: `The prover may only inspect the repository and run probes. Allowed: ${[...PROVER_TOOLS].join(", ")}.`,
          durationMs: 0,
        });
        continue;
      }
      const result = await executeTool(call, toolContext);
      observations.push(result);
      if (call.tool === "finish") summary = result.detail || action.summary;
    }

    const failedProbe = [...probes].reverse().find((probe) => !probe.passed);
    if (failedProbe) {
      const confirmation = await confirmProbe(candidate, failedProbe, deps);
      if (confirmation.proof) {
        logger.info(`prover (${role}) reproduced ${candidate.id} with probe ${failedProbe.name}`);
        return { proof: confirmation.proof, nearMiss: false, probes: probes.length, summary: `probe ${failedProbe.name} fails on the head` };
      }
      nearMiss = true;
      logger.info(`prover (${role}) probe for ${candidate.id} did not confirm: ${confirmation.reason}`);
    }

    if (action.done || calls.some((call) => call.tool === "finish")) {
      summary = summary ?? action.summary ?? "the prover finished without a confirmed reproduction";
      break;
    }

    messages.push({ role: "user", content: nextUser });
    messages.push({ role: "assistant", content: raw.slice(0, 1_200) });
    nextUser = proverContinuePrompt(
      observations.map((observation) => `${observation.ok ? "ok" : "fail"} ${observation.tool}: ${observation.detail.slice(0, 1_800)}`).join("\n\n"),
    );
  }

  return { nearMiss, summary: summary ?? "the prover did not produce a reproduceable probe", probes: probes.length };
}

/**
 * Runs the prover over the judge-approved candidates that have no existing
 * deterministic plan (browser check or related repository test). Candidates
 * with a plan are left to the proof stage and are not covered here.
 */
export async function proveCandidatesWithProver(toProve: Candidate[], deps: ProverDeps): Promise<ProverOutcome> {
  const now = deps.now ?? (() => Date.now());
  const proofs: ProofResult[] = [];
  const coverage: LoopCandidateCoverage[] = [];
  let budget = deps.maxCandidates;
  let escalations = deps.escalations;

  const ordered = [...toProve].sort((a, b) => BY_SEVERITY[b.severity] - BY_SEVERITY[a.severity] || b.confidence - a.confidence);

  for (const candidate of ordered) {
    if (candidate.check) continue;
    const hasRelatedTest = relatedTestsFor(candidate, deps.context).length > 0 && Boolean(deps.profile.testSingle);
    const hasExistingTestPlan = (candidate.suggestedProof === "existing_test" || candidate.suggestedProof === "targeted_test") && Boolean(deps.profile.testCommand);
    if (hasRelatedTest || hasExistingTestPlan) continue;
    if (budget <= 0) {
      coverage.push({ candidateId: candidate.id, severity: candidate.severity, proofState: "BUDGET", reason: "prover candidate budget exhausted" });
      continue;
    }
    if (deps.deadline - now() < 12_000) {
      coverage.push({ candidateId: candidate.id, severity: candidate.severity, proofState: "BUDGET", reason: "prover deadline reached before this candidate" });
      continue;
    }
    if (!candidate.file) {
      coverage.push({ candidateId: candidate.id, severity: candidate.severity, proofState: "UNPROVABLE", reason: "candidate has no file anchor to reproduce" });
      continue;
    }
    budget -= 1;

    // Tier 1 (luna) runs up to `attempts` times; a lazy turn that authors no
    // probe and no near-miss gets another chance before the candidate is
    // recorded UNPROVABLE (3.4 live PR7 finding).
    const attempts = Math.max(1, deps.attempts ?? 1);
    let attempt: ProverAttempt = { nearMiss: false, probes: 0 };
    for (let index = 0; index < attempts; index++) {
      attempt = await runProverAgent(candidate, "luna", deps);
      if (attempt.proof || attempt.nearMiss || attempt.probes > 0) break;
      if (deps.deadline - now() < 12_000) break;
    }
    if (!attempt.proof && attempt.nearMiss && (candidate.severity === "high" || candidate.severity === "critical") && escalations > 0) {
      escalations -= 1;
      deps.logger.info(`prover escalating ${candidate.id} to codegen`);
      const escalated = await runProverAgent(candidate, "codegen", deps);
      attempt = escalated.proof ? escalated : { ...escalated, summary: escalated.summary ?? attempt.summary };
    }

    if (attempt.proof) {
      // The artifact must travel with the candidate: repair's context and
      // verification's replay both read it (3.4).
      candidate.artifact = attempt.proof.artifact;
      candidate.proofPlan = attempt.proof.artifact?.reason;
      proofs.push(attempt.proof);
      continue;
    }

    coverage.push({
      candidateId: candidate.id,
      severity: candidate.severity,
      proofState: "UNPROVABLE",
      reason: attempt.summary ?? "no executable reproduction was produced",
    });
  }

  return { proofs, coverage };
}

/**
 * Builds the run's loop coverage from the judge decisions, the proof results
 * and the prover's recorded failures. Every PROVE decision gets exactly one
 * terminal state; nothing is dropped (3.4).
 */
export function buildLoopCoverage(
  decisions: JudgeDecision[],
  candidates: Candidate[],
  proofs: ProofResult[],
  proverCoverage: LoopCandidateCoverage[],
): LoopCoverage {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const coverageById = new Map(proverCoverage.map((entry) => [entry.candidateId, entry]));
  const proofById = new Map(proofs.map((proof) => [proof.candidateId, proof]));
  const judged = decisions.filter((decision) => decision.verdict === "PROVE");

  const coverage: LoopCoverage = { judgeProve: judged.length, proven: 0, proofUnavailable: 0, proofErrors: 0, candidates: [] };
  for (const decision of judged) {
    const candidate = byId.get(decision.candidateId);
    if (!candidate) continue;
    const proof = proofById.get(decision.candidateId);
    const recorded = coverageById.get(decision.candidateId);
    let proofState: ProofState;
    let reason: string;
    if (proof?.status === "confirmed") {
      proofState = "PROVEN";
      reason = proof.explanation;
    } else if (recorded) {
      // The prover's recorded state is more precise than a downstream "no
      // executable proof" error: it says why no reproduction exists.
      proofState = recorded.proofState;
      reason = recorded.reason;
    } else if (proof?.status === "error") {
      proofState = "ERROR";
      reason = proof.explanation;
    } else if (proof) {
      proofState = "UNPROVABLE";
      reason = proof.explanation;
    } else {
      proofState = "UNPROVABLE";
      reason = "no proof result was recorded for this candidate";
    }
    coverage.candidates.push({ candidateId: candidate.id, severity: candidate.severity, proofState, reason });
    if (proofState === "PROVEN") coverage.proven += 1;
    else if (proofState === "ERROR") coverage.proofErrors += 1;
    else coverage.proofUnavailable += 1;
  }
  return coverage;
}
