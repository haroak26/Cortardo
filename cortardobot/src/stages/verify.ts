/**
 * Verify stage: a fix is only real when a clean tree replays it. The patch is
 * applied to the untouched head, the reproduction must pass twice, the gates
 * must pass, and the reviewer agent must accept the patch against the claim.
 */
import { runAgent } from "../agent/loop";
import { reviewerSystem, reviewerUser } from "../agent/prompts";
import { REVIEWER_TOOLS, type ToolContext } from "../agent/tools";
import type { PRContext } from "../context/pack";
import type { ModelRouter } from "../models";
import type { CandidateRecord, Finding, Sandbox, VerificationStep } from "../types";
import { runArtifact } from "../artifact";
import { truncate, type Logger } from "../util";
import { applyEditsToSandbox } from "./fix";

export interface VerifyDeps {
  sandbox: Sandbox;
  /** Optional fresh sandbox; when absent the current tree is reset instead. */
  freshSandbox?: () => Promise<Sandbox | undefined>;
  transport: ModelRouter;
  context: PRContext;
  logger: Logger;
  maxTurns: number;
  maxToolsPerTurn: number;
  deadline: number;
  signal?: AbortSignal;
  runAgentImpl?: typeof runAgent;
}

export interface VerifyResult {
  findings: Finding[];
  candidates: CandidateRecord[];
}

async function resetToHead(sandbox: Sandbox): Promise<void> {
  await sandbox.exec("git checkout -- . && git clean -fd -e node_modules -e .cortado-probes", { cwd: sandbox.root, timeoutMs: 120_000, allowFailure: true });
}

async function replay(finding: Finding, sandbox: Sandbox, probeDir: string, kind: "repro_1" | "repro_2"): Promise<VerificationStep> {
  const result = await runArtifact(sandbox, finding.repro.artifact, probeDir, {
    runs: 1,
    expect: "pass",
    target: finding.file.split("/").pop()?.split(".")[0],
  });
  const output = result.outputs.join("\n---\n").trim();
  if (result.passed) return { kind, passed: true, reason: "the reproduction passes on the clean replay", output: truncate(output, 400) };
  if (result.harnessError) return { kind, passed: false, reason: `the reproduction could not run on the clean replay: ${truncate(result.reason, 200)}`, output: truncate(output, 600) };
  return { kind, passed: false, reason: "the reproduction still fails on the clean replay", output: truncate(output, 900) };
}

async function gate(sandbox: Sandbox, command: string | undefined, kind: "typecheck" | "tests", timeoutMs: number): Promise<VerificationStep> {
  if (!command) return { kind, passed: true, skipped: true, reason: "no command configured for this gate" };
  const result = await sandbox.exec(command, { cwd: sandbox.root, timeoutMs, allowFailure: true });
  if (result.exitCode !== 0) {
    return { kind, passed: false, reason: `${kind} failed (exit ${result.exitCode})`, output: truncate(`${result.stdout}\n${result.stderr}`, 900) };
  }
  return { kind, passed: true, reason: `${kind} passed` };
}

export async function verifyStage(findings: Finding[], deps: VerifyDeps): Promise<VerifyResult> {
  const agent = deps.runAgentImpl ?? runAgent;
  const candidates: CandidateRecord[] = [];
  const pending = findings.filter((finding) => finding.fix?.state === "pending_verify");

  let target = deps.sandbox;
  let fresh: Sandbox | undefined;
  if (pending.length > 0 && deps.freshSandbox) {
    fresh = await deps.freshSandbox();
    if (fresh) target = fresh;
    else await resetToHead(target);
  } else if (pending.length > 0) {
    await resetToHead(target);
  }

  for (const finding of pending) {
    const probeDir = `${target.root}/.cortado-probes`;
    const steps: VerificationStep[] = [];
    const edits = finding.fix?.edits ?? [];

    const applied = await applyEditsToSandbox(target, edits);
    if (!applied.ok) {
      finding.state = "fix_failed";
      finding.fix = {
        ...finding.fix!,
        state: "failed",
        reason: `the patch does not apply cleanly on the untouched head: ${applied.reason}`,
        verification: { passed: false, steps: [{ kind: "review", passed: false, reason: `patch application failed: ${applied.reason}` }] },
      };
      candidates.push({ candidateId: finding.id, claim: finding.claim, severity: finding.severity, file: finding.file, state: "fix_failed", reason: finding.fix.reason });
      continue;
    }

    steps.push(await replay(finding, target, probeDir, "repro_1"));
    if (steps[0].passed) steps.push(await replay(finding, target, probeDir, "repro_2"));
    if (steps.some((step) => !step.passed)) {
      finding.state = "fix_failed";
      finding.fix = {
        ...finding.fix!,
        state: "failed",
        reason: "the reproduction did not pass twice on the clean replay",
        verification: { passed: false, steps },
      };
      candidates.push({ candidateId: finding.id, claim: finding.claim, severity: finding.severity, file: finding.file, state: "fix_failed", reason: finding.fix.reason });
      continue;
    }

    const typecheck = await gate(target, deps.context.profile.typecheckCommand, "typecheck", 300_000);
    steps.push(typecheck);
    const tests = typecheck.passed
      ? await gate(target, deps.context.profile.testCommand, "tests", 420_000)
      : { kind: "tests" as const, passed: false, skipped: true, reason: "skipped because typecheck failed" };
    steps.push(tests);
    if (!typecheck.passed || !tests.passed) {
      finding.state = "fix_failed";
      finding.fix = {
        ...finding.fix!,
        state: "failed",
        reason: "the patch fails the repository gates on the clean replay",
        verification: { passed: false, steps },
      };
      candidates.push({ candidateId: finding.id, claim: finding.claim, severity: finding.severity, file: finding.file, state: "fix_failed", reason: finding.fix.reason });
      continue;
    }

    const toolContext: ToolContext = {
      sandbox: target,
      graph: deps.context.graph,
      context: deps.context,
      profile: deps.context.profile,
      probeDir,
      phase: "verify",
      logger: deps.logger,
      signal: deps.signal,
    };
    const patch = finding.fix?.patch ?? (await target.gitDiff());
    const review = await agent({
      role: "reviewer",
      kind: "verify",
      system: reviewerSystem(),
      user: reviewerUser({ finding, patch, gates: steps.map((step) => `${step.kind}: ${step.passed ? "pass" : "fail"}`) }),
      allowedTools: REVIEWER_TOOLS,
      toolContext,
      transport: deps.transport,
      logger: deps.logger,
      maxTurns: deps.maxTurns,
      maxToolsPerTurn: deps.maxToolsPerTurn,
      deadline: deps.deadline,
      signal: deps.signal,
      label: `verify-${finding.id}`,
      isFinal: (parsed) => typeof parsed.approved === "boolean",
    });

    const approved = review.final?.approved === true;
    const verdict = {
      approved,
      risk: (typeof review.final?.risk === "string" ? review.final.risk : "medium") as Finding["severity"],
      confidence: typeof review.final?.confidence === "number" ? review.final.confidence : 0.5,
      summary: typeof review.final?.summary === "string" ? review.final.summary : review.stoppedReason,
    };
    steps.push({ kind: "review", passed: approved, reason: verdict.summary, output: undefined });

    if (approved) {
      finding.state = "verified_fix";
      finding.fix = { ...finding.fix!, state: "verified", reason: "verified on a clean replay by an independent reviewer", verification: { passed: true, steps }, reviewer: verdict };
      deps.logger.info(`verify ${finding.id}: verified fix`);
    } else {
      finding.state = "fix_failed";
      finding.fix = {
        ...finding.fix!,
        state: "failed",
        reason: `the independent reviewer rejected the patch: ${truncate(verdict.summary, 200)}`,
        verification: { passed: false, steps },
        reviewer: verdict,
      };
      candidates.push({ candidateId: finding.id, claim: finding.claim, severity: finding.severity, file: finding.file, state: "fix_failed", reason: finding.fix.reason });
      deps.logger.info(`verify ${finding.id}: reviewer rejected the patch`);
    }
  }

  return { findings, candidates };
}
