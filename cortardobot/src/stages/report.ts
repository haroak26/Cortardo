/**
 * Report stage: deterministic coverage first, then one reviewer call for the
 * verdict. The verdict can never claim more than the reproduction evidence.
 */
import type { PRContext } from "../context/pack";
import { reporterSystem, reporterUser } from "../agent/prompts";
import type { ModelRouter } from "../models";
import type { CandidateRecord, Finding, RunReport, Severity } from "../types";
import { truncate, type Logger } from "../util";

export interface ReportDeps {
  transport: ModelRouter;
  context: PRContext;
  logger: Logger;
  deadline: number;
  signal?: AbortSignal;
  runtime?: RunReport["runtime"];
}

export interface ReportResult {
  report: RunReport;
  degraded: boolean;
  degradedReason?: string;
}

function severityRank(severity: string): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[severity] ?? 1;
}

const COVERAGE_PRIORITY: Record<string, number> = {
  error: 6,
  deferred: 5,
  verified_fix: 4,
  fix_failed: 3,
  reproduced: 2,
  not_reproduced: 1,
};

export function coverageOf(findings: Finding[], candidates: CandidateRecord[]): CandidateRecord[] {
  const byId = new Map<string, CandidateRecord>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.candidateId);
    if (!existing || (COVERAGE_PRIORITY[candidate.state] ?? 0) >= (COVERAGE_PRIORITY[existing.state] ?? 0)) {
      byId.set(candidate.candidateId, candidate);
    }
  }
  for (const finding of findings) {
    const derived: CandidateRecord = {
      candidateId: finding.id,
      claim: finding.claim,
      severity: finding.severity,
      file: finding.file,
      state: finding.state,
      reason: finding.fix?.reason ?? finding.repro.explanation,
    };
    const existing = byId.get(finding.id);
    if (!existing || (COVERAGE_PRIORITY[derived.state] ?? 0) > (COVERAGE_PRIORITY[existing.state] ?? 0)) {
      byId.set(finding.id, derived);
    } else if (existing.state === derived.state) {
      byId.set(finding.id, derived);
    }
  }
  return [...byId.values()];
}

export async function reportStage(findings: Finding[], candidates: CandidateRecord[], deps: ReportDeps): Promise<ReportResult> {
  const coverage = coverageOf(findings, candidates);
  const reproduced = findings.filter((finding) => finding.state !== "verified_fix" || true);
  const verified = findings.filter((finding) => finding.state === "verified_fix");
  const unresolved = findings.filter((finding) => finding.state !== "verified_fix");
  const errors = coverage.filter((entry) => entry.state === "error");
  const deferred = coverage.filter((entry) => entry.state === "deferred");
  const degraded = errors.length > 0 || deferred.length > 0;
  const degradedReason = degraded
    ? [
        errors.length > 0 ? `${errors.length} candidate(s) errored` : "",
        deferred.length > 0 ? `${deferred.length} candidate(s) deferred by budget` : "",
      ]
        .filter(Boolean)
        .join("; ")
    : undefined;

  const blocking = unresolved.some((finding) => severityRank(finding.severity) >= severityRank("high") && !finding.runtime?.preExisting);
  const fallbackDecision: RunReport["verdict"]["decision"] = blocking
    ? "request_changes"
    : findings.length > 0 || coverage.some((entry) => entry.state === "not_reproduced" && severityRank(entry.severity) >= 3)
      ? "approve_with_comments"
      : "approve";

  let verdict: RunReport["verdict"] = {
    decision: fallbackDecision,
    confidence: 0.6,
    rationale: blocking
      ? "Reproduced defects are unresolved or unverified; the patch is not ready to merge."
      : findings.length > 0
        ? "Reproduced defects are verified or pre-existing; see the coverage for details."
        : "No defect was reproduced by an executable reproduction.",
  };
  let summary = findings.length > 0 ? `${findings.length} defect(s) were reproduced by executable scripts.` : "No defect was reproduced by an executable script.";

  try {
    const response = await deps.transport.complete({
      role: "reviewer",
      kind: "report",
      system: reporterSystem(),
      user: reporterUser({
        title: deps.context.pr.title || `Pull request #${deps.context.pr.number}`,
        classification: deps.context.classification,
        size: deps.context.size,
        reproduced: findings.map((finding) => ({ claim: finding.claim, severity: finding.severity, file: finding.file, state: finding.state })),
        verified: verified.map((finding) => `${finding.claim} (${finding.file})`),
        unresolved: unresolved.map((finding) => ({ claim: finding.claim, state: finding.state, reason: finding.fix?.reason ?? finding.repro.explanation })),
        deferred: deferred.length,
      }),
      expectJson: true,
      retries: 1,
      signal: deps.signal,
      label: "report",
    });
    const parsed = JSON.parse(response.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as {
      decision?: string;
      confidence?: number;
      summary?: string;
      rationale?: string;
    };
    const decision =
      parsed.decision === "approve" || parsed.decision === "approve_with_comments" || parsed.decision === "request_changes"
        ? parsed.decision
        : fallbackDecision;
    verdict = {
      decision,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : verdict.confidence,
      rationale: typeof parsed.rationale === "string" && parsed.rationale.trim() ? truncate(parsed.rationale.trim(), 1_200) : verdict.rationale,
    };
    if (typeof parsed.summary === "string" && parsed.summary.trim()) summary = truncate(parsed.summary.trim(), 1_500);
  } catch (error) {
    deps.logger.warn("report model call failed; using the deterministic verdict", { error: error instanceof Error ? error.message : String(error) });
  }

  // A degraded run never approves, whatever the reporter model says.
  if (degraded && verdict.decision === "approve") {
    verdict = {
      ...verdict,
      decision: "approve_with_comments",
      rationale: `${verdict.rationale} (degraded run: ${degradedReason ?? "partial coverage"})`,
    };
  }

  return {
    report: {
      verdict,
      summary,
      runtime: deps.runtime,
      reproduced: findings.map((finding) => ({ id: finding.id, claim: finding.claim, severity: finding.severity, file: finding.file, line: finding.line })),
      verified: verified.map((finding) => ({ id: finding.id, claim: finding.claim, severity: finding.severity as Severity, file: finding.file, line: finding.line })),
      unresolved: unresolved.map((finding) => ({
        id: finding.id,
        claim: finding.claim,
        severity: finding.severity,
        file: finding.file,
        state: finding.state,
        reason: finding.fix?.reason ?? finding.repro.explanation,
      })),
      coverage: coverage.map((entry) => ({ id: entry.candidateId, claim: entry.claim, severity: entry.severity, state: entry.state, reason: entry.reason })),
    },
    degraded,
    degradedReason,
  };
}
