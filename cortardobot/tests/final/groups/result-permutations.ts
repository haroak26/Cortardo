import assert from "node:assert/strict";
import { assembleResult } from "../../../src/result";
import { deterministicFinalReview } from "../../../src/stages/final-review";
import { makeCandidate, makeContext, makeFinding, makeProof, makeRepair, makeVerification } from "../../helpers/factories";
import { defineCases } from "../../exhaustive/types";
import type { ProofStatus, RepairExitState, FinalReview } from "../../../src/types";

const PROOF_STATUSES: ProofStatus[] = ["confirmed", "likely", "disproven", "error"];
const REPAIR_EXITS: Array<RepairExitState | undefined> = [
  undefined,
  "VERIFIED",
  "UNRESOLVED",
  "UNSAFE",
  "BUDGET_EXHAUSTED",
];

export function buildResultPermutationGroup() {
  const cases: Array<{ name: string; run: () => void }> = [];

  for (const status of PROOF_STATUSES) {
    for (const exit of REPAIR_EXITS) {
      cases.push({
        name: `result mapping proof=${status} repair=${exit ?? "none"}`,
        run: () => {
          const candidate = makeCandidate({ id: "c1", severity: "high" });
          const proof = makeProof({ candidateId: "c1", status });
          const repair = exit ? makeRepair({ candidateId: "c1", exit }) : undefined;
          const verification = repair ? makeVerification({ passed: true }) : undefined;
          const result = assembleResult({
            runId: "run",
            input: { id: "pr", title: "t" },
            context: makeContext(),
            candidates: [candidate],
            decisions: [{ hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1 }],
            proofs: [proof],
            repairs: repair ? [repair] : [],
            verifications: verification ? { c1: verification } : {},
            reviews: [],
            events: [],
            timings: {},
            usage: { calls: 1, callsByRole: {}, tokensIn: 1, tokensOut: 1, credits: 0.1, modelMs: 1 },
            dryRun: true,
            startedAt: 0,
            endedAt: 10,
            status: "completed",
          });

          const hasFinding = status === "confirmed" || status === "likely";
          assert.equal(result.findings.length, hasFinding ? 1 : 0, "finding presence");
          assert.equal(result.summary.issuesConfirmed, status === "confirmed" ? 1 : 0);
          assert.equal(result.summary.issuesFixed, exit === "VERIFIED" ? 1 : 0);

          if (!hasFinding) {
            assert.match(result.markdown, /No confirmed issues/);
            return;
          }

          const expectedTag =
            exit === "VERIFIED"
              ? "[FIXED]"
              : exit === "UNSAFE"
                ? "[UNSAFE]"
                : status === "confirmed"
                  ? "[CONFIRMED]"
                  : "[UNPROVEN]";
          assert.ok(result.markdown.includes(expectedTag), `expected ${expectedTag} in markdown`);

          const finding = makeFinding({
            candidateId: "c1",
            severity: "high",
            proof,
            repair,
            verification,
          });
          const review: FinalReview = deterministicFinalReview(finding);
          const verified = exit === "VERIFIED" && verification?.passed === true;
          const expectedApproval = verified
            ? "approve"
            : status === "confirmed" && repair !== undefined
              ? "request_changes"
              : "approve_with_comments";
          assert.equal(review.approval, expectedApproval);
          if (exit === "VERIFIED") assert.equal(review.fixCorrectness, "correct");
          if (exit === "UNSAFE") assert.equal(review.risk, "high");
        },
      });
    }
  }

  assert.equal(cases.length, 20);
  return defineCases("result-permutations", cases);
}
