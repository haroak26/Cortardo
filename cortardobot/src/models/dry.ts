import type {
  ChangedFile,
  JudgeDecision,
  MergedCandidate,
  Severity,
} from "../types";
import { severityRank } from "../config";
import { detectForFiles, detectorById, detectorFix, type DetectorFinding } from "../agents/detectors";
import { isExecutionProvable } from "../judge-policy";
import { makeUnifiedDiff } from "../util/diff";
import { estimateTokens } from "../util/text";
import type { ModelClient, ModelResponse, ModelTask } from "./types";

export type RepairBehavior = "fix" | "wrong-layer" | "always-fail" | "unsafe" | "timeout";

export interface DryModelOptions {
  repairBehavior?: RepairBehavior;
  maxHypotheses?: number;
  modelName?: string;
  onCall?: (task: ModelTask) => void;
  findingCache?: Map<string, DetectorFinding>;
}

interface SwarmContext {
  agentKind: string;
  files: ChangedFile[];
}

interface JudgeContext {
  candidates: MergedCandidate[];
  maxToProve: number;
  minConfidence: number;
  minSeverity: Severity;
}

interface PatchContext {
  candidate: MergedCandidate;
  attempt: number;
  strategy: string;
  fileContents: Record<string, string>;
}

interface ReviewContext {
  items: Array<{
    candidateId: string;
    severity: Severity;
    proofStatus: string;
    repairExit?: string;
    verificationPassed?: boolean;
    repairAttempts: number;
  }>;
}

export class DryModel implements ModelClient {
  readonly id: string;
  readonly dryRun = true;
  private readonly options: DryModelOptions;
  private readonly findingCache: Map<string, DetectorFinding>;

  constructor(options: DryModelOptions = {}) {
    this.options = options;
    this.id = `dry:${options.modelName ?? "cortado-sim"}`;
    this.findingCache = options.findingCache ?? new Map();
  }

  async complete(task: ModelTask): Promise<ModelResponse> {
    const text = this.respond(task);
    this.options.onCall?.(task);
    return {
      text,
      model: this.id,
      tokensIn: estimateTokens(task.system + task.user),
      tokensOut: estimateTokens(text),
      durationMs: 1,
    };
  }

  private respond(task: ModelTask): string {
    switch (task.kind) {
      case "swarm_agent":
        return JSON.stringify({ hypotheses: this.swarm(task.context as unknown as SwarmContext) });
      case "judge":
        return JSON.stringify({ decisions: this.judge(task.context as unknown as JudgeContext) });
      case "repair_plan":
        return JSON.stringify(this.repairPlan(task.context as Record<string, unknown>));
      case "repair_patch":
        return JSON.stringify(this.repairPatch(task.context as unknown as PatchContext));
      case "repair_diagnosis":
        return JSON.stringify(this.diagnosis(task.context as Record<string, unknown>));
      case "final_review":
        return JSON.stringify({ reviews: this.finalReview(task.context as unknown as ReviewContext) });
      default:
        return "{}";
    }
  }

  private swarm(context: SwarmContext): Array<Record<string, unknown>> {
    const max = this.options.maxHypotheses ?? 2;
    const findings = detectForFiles(context.files ?? [], [context.agentKind as never], max);
    return findings.map((finding) => {
      this.findingCache.set(`${finding.file}::${finding.ruleId}`, finding);
      return {
        claim: finding.claim,
        evidence: [`${finding.file}:${finding.line}`],
        severity: finding.severity,
        confidence: finding.confidence,
        suggestedExperiment: finding.experiment,
        rule: finding.ruleId,
      };
    });
  }

  private judge(context: JudgeContext): JudgeDecision[] {
    const candidates = [...(context.candidates ?? [])].sort((a, b) => b.score - a.score);
    let proved = 0;
    return candidates.map((candidate) => {
      const meetsBar =
        severityRank(candidate.severity) >= severityRank(context.minSeverity ?? "medium") &&
        candidate.confidence >= (context.minConfidence ?? 0.5);
      if (meetsBar && !isExecutionProvable(candidate)) {
        return {
          hypothesisId: candidate.id,
          verdict: "STATIC_ONLY" as const,
          reason: "Real but not provable by execution; reported as static evidence",
          priority: proved + 1,
        };
      }
      if (meetsBar && proved < context.maxToProve) {
        proved++;
        return {
          hypothesisId: candidate.id,
          verdict: "PROVE" as const,
          reason: `High-value ${candidate.severity} claim with ${Math.round(candidate.confidence * 100)}% confidence`,
          priority: proved,
        };
      }
      if (severityRank(candidate.severity) >= severityRank("low") && candidate.confidence >= 0.4) {
        return {
          hypothesisId: candidate.id,
          verdict: "STATIC_ONLY" as const,
          reason: "Real signal but not worth an execution slot",
          priority: proved + 1,
        };
      }
      return {
        hypothesisId: candidate.id,
        verdict: "DISCARD" as const,
        reason: "Low confidence or low value after merge",
        priority: 99,
      };
    });
  }

  private repairPlan(context: Record<string, unknown>): Record<string, unknown> {
    const attempt = Number(context.attempt ?? 1);
    const candidate = context.candidate as MergedCandidate;
    return {
      strategy:
        attempt === 1
          ? `Fix the root cause of "${candidate.claim.slice(0, 80)}" at its source`
          : "Change layer: address the diagnosed failure instead of repeating the first patch",
      files: candidate.file ? [candidate.file] : [],
      rationale: `Preserve behavior, keep the change minimal, and do not weaken tests (attempt ${attempt})`,
    };
  }

  private repairPatch(context: PatchContext): Record<string, unknown> {
    const behavior = this.options.repairBehavior ?? "fix";
    const attempt = context.attempt ?? 1;
    const candidate = context.candidate;
    const fileContents = context.fileContents ?? {};

    if (behavior === "unsafe") {
      const unsafe = buildUnsafePatch(fileContents);
      if (unsafe) return { patch: unsafe.patch, description: unsafe.description };
    }

    const shouldFix =
      behavior === "fix" ||
      behavior === "timeout" ||
      (behavior === "wrong-layer" && attempt >= 2);

    if (!shouldFix) {
      const noop = buildNoopPatch(fileContents);
      if (noop) return { patch: noop.patch, description: "Add a guard comment (first strategy attempt)" };
    }

    const ruleId = candidate.tags.find((tag) => tag.startsWith("rule:"))?.slice("rule:".length);
    if (ruleId && candidate.file && fileContents[candidate.file] !== undefined) {
      const content = fileContents[candidate.file];
      const finding =
        detectorFindingFor(ruleId, candidate.file, content) ??
        this.findingCache.get(`${candidate.file}::${ruleId}`);
      const fix = finding ? detectorFix(ruleId, content, finding) : null;
      if (fix && fix.content !== content) {
        return {
          patch: makeUnifiedDiff(candidate.file, content, fix.content),
          description: fix.description,
        };
      }
    }

    const noop = buildNoopPatch(fileContents);
    if (noop) return { patch: noop.patch, description: "No mechanical fix available; add defensive guard" };
    return { patch: "", description: "no patch available" };
  }

  private diagnosis(context: Record<string, unknown>): Record<string, unknown> {
    const attempt = Number(context.attempt ?? 1);
    return {
      reason:
        "The patch did not change the failing behavior: the reproduction still fails, so the fix likely addressed the wrong layer or missed the actual mutation point.",
      nextStrategy:
        attempt === 1
          ? "Move the fix to the layer where the failing value is produced and re-run the reproduction"
          : "Re-derive the root cause from the failing assertion and patch the minimal statement it exercises",
    };
  }

  private finalReview(context: ReviewContext): Array<Record<string, unknown>> {
    return (context.items ?? []).map((item) => {
      const confirmed = item.proofStatus === "confirmed";
      const verified = item.repairExit === "VERIFIED" && item.verificationPassed !== false;
      const unresolved = item.repairExit === "UNRESOLVED" || item.repairExit === "BUDGET_EXHAUSTED";
      const unsafe = item.repairExit === "UNSAFE";
      const repairAttempted = item.repairExit !== undefined;
      const confidence = verified ? 0.92 : confirmed ? 0.78 : item.proofStatus === "likely" ? 0.6 : 0.35;
      return {
        candidateId: item.candidateId,
        validity: confirmed ? "valid" : item.proofStatus === "likely" ? "uncertain" : "invalid",
        fixCorrectness: verified ? "correct" : unsafe ? "incorrect" : unresolved ? "none" : "none",
        risk: unsafe || item.severity === "critical" ? "high" : item.severity === "high" ? "medium" : "low",
        approval: verified ? "approve" : confirmed && repairAttempted ? "request_changes" : "approve_with_comments",
        confidence,
        summary: verified
          ? `Confirmed ${item.severity} finding and verified the fix against the reproduction.`
          : unsafe
            ? "Repair attempt was unsafe (it weakened tests or touched restricted paths) and was rejected."
            : unresolved
              ? `Confirmed finding remains unrepaired after ${item.repairAttempts} attempt(s).`
              : `Finding could not be confirmed by execution (${item.proofStatus}).`,
      };
    });
  }
}

function detectorFindingFor(
  ruleId: string,
  path: string,
  content: string,
): Parameters<typeof detectorFix>[2] | null {
  const detector = detectorById(ruleId);
  if (!detector) return null;
  const lines = content.split("\n").map((text, index) => ({ line: index + 1, text }));
  const synthetic: ChangedFile = {
    path,
    status: "modified",
    language: "typescript",
    additions: lines.length,
    deletions: 0,
    addedLines: lines,
    removedLines: [],
  };
  const matches = [] as Parameters<typeof detectorFix>[2][];
  if (detector.matchFile) matches.push(...detector.matchFile(synthetic));
  if (detector.matchLine) {
    for (const line of lines) {
      const match = detector.matchLine(line.text, synthetic, line.line, "added");
      if (match) matches.push(match);
    }
  }
  return matches[0] ?? null;
}

function buildNoopPatch(fileContents: Record<string, string>): { patch: string; description: string } | null {
  for (const [path, content] of Object.entries(fileContents)) {
    if (/\.(test|spec)\./.test(path)) continue;
    const lines = content.split("\n");
    const insertAt = lines.findIndex((line) => line.trim().length > 0);
    const next = [...lines];
    next.splice(insertAt === -1 ? 0 : insertAt, 0, "// reviewed: no behavioral change (guard only)");
    const patch = makeUnifiedDiff(path, content, next.join("\n"));
    if (patch) return { patch, description: "Add a documented guard without changing behavior" };
  }
  return null;
}

function buildUnsafePatch(fileContents: Record<string, string>): { patch: string; description: string } | null {
  const entries = Object.entries(fileContents);
  const testEntry = entries.find(([path]) => /\.(test|spec)\./.test(path));
  if (testEntry) {
    const [path, content] = testEntry;
    const stripped = content
      .split("\n")
      .filter((line) => !/expect\s*\(|assert[.(]/.test(line))
      .join("\n");
    if (stripped !== content) {
      const patch = makeUnifiedDiff(path, content, stripped);
      if (patch) return { patch, description: "Disable the failing assertions to force the suite green" };
    }
  }
  const workflow = [
    "name: ci",
    "on: [push]",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo tests disabled",
  ].join("\n");
  const patch = makeUnifiedDiff(
    ".github/workflows/ci.yml",
    workflow,
    `${workflow}\n      - run: echo skipped`,
  );
  return patch
    ? { patch, description: "Disable CI instead of fixing the defect" }
    : null;
}

export function createDryModel(options: DryModelOptions = {}): ModelClient {
  return new DryModel(options);
}
