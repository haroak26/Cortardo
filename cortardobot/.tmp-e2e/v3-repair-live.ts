import { readFileSync } from "node:fs";
import { E2BSandboxInstance } from "../src/v3/sandbox-e2b.ts";
import { analyzeChanges } from "../src/v3/intelligence.ts";
import { runDetectors } from "../src/v3/detectors.ts";
import { proveCandidates, proveOne } from "../src/v3/proof.ts";
import { repairFindings } from "../src/v3/repair.ts";
import { verifyRepairs } from "../src/v3/verify.ts";
import { ModelRouter } from "../src/v3/models.ts";
import { resolveV3Config } from "../src/v3/config.ts";
import { createLogger } from "../src/v3/util.ts";
import type { Candidate, ModelClient, ModelTask, ReviewRequest } from "../src/v3/types.ts";
import { installationToken } from "../../.tmp/v3-gh.ts";

const input = JSON.parse(readFileSync("/home/runner/workspace/cortardobot/.tmp-e2e/pr6-input.json", "utf8"));
const request: ReviewRequest = {
  runId: "repair-live",
  repo: { fullName: "haroak26/Artificial-Gateway", defaultBranch: "main", installationId: 161125043, cloneUrl: "https://github.com/haroak26/Artificial-Gateway.git", token: "" },
  pr: { number: 6, title: input.title, body: input.body ?? "", baseSha: "", headSha: "0b19da07", baseBranch: "main", headBranch: "new-pricing-page" },
  files: input.files,
};
const context = analyzeChanges(request);
const candidates = runDetectors(context);
const logger = createLogger("info", "repair-live");

const token = await installationToken();
const sandbox = await E2BSandboxInstance.create({
  template: process.env.CORTADO_E2B_TEMPLATE ?? "cortardo-review-v1",
  apiKey: process.env.E2B_API_KEY ?? "",
  timeoutMs: 900_000,
  repoDir: "/home/user/repo",
});

const scriptedTerra: ModelClient = {
  id: "scripted-terra",
  async complete(task: ModelTask) {
    const base = { model: "scripted-terra", tokensIn: 5, tokensOut: 5, durationMs: 1 };
    if (task.kind === "repair") {
      const path = /## Source file (.+?) \(/.exec(task.user)?.[1] ?? "";
      const attempt = Number(/Attempt (\d+)\./.exec(task.user)?.[1] ?? "1");
      const candidate = candidates.find((entry) => entry.file === path);
      if (!candidate?.autoFix) return { ...base, text: JSON.stringify({ strategy: "none", edits: [] }) };
      if (path.endsWith("Docs.tsx") && attempt === 1) {
        console.log("  [scripted-terra] attempt 1 returns a deliberately wrong edit for Docs.tsx");
        return { ...base, text: JSON.stringify({ strategy: "guess", edits: [{ path, find: "THIS CONTEXT DOES NOT EXIST", replace: "x" }] }) };
      }
      console.log(`  [scripted-terra] attempt ${attempt} returns the exact edit for ${path}`);
      return { ...base, text: JSON.stringify({ strategy: `fix ${path}`, edits: candidate.autoFix }) };
    }
    if (task.kind === "repair_diagnosis") {
      return { ...base, text: JSON.stringify({ reason: "the edit did not apply", nextStrategy: "use the exact source edit" }) };
    }
    return { ...base, text: '{"decisions":[]}' };
  },
};

const empty: ModelClient = { id: "empty", async complete() { return { text: "{}", model: "empty", tokensIn: 0, tokensOut: 0, durationMs: 0 }; } };
const models = new ModelRouter({ clients: { luna: empty, terra: scriptedTerra, astra: empty }, config: resolveV3Config({ mode: "live" }).models, maxCalls: 30 });

try {
  const t0 = Date.now();
  await sandbox.prepare({ cloneUrl: request.repo.cloneUrl, token, ref: "refs/pull/6/head", headBranch: "new-pricing-page" });
  await sandbox.install();
  const profile = await sandbox.profile();
  console.log(`[repair-live] sandbox ready in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const proofDeps = { sandbox, profile, logger };
  const toProve = candidates.filter((candidate) => Boolean(candidate.check));
  const proofRun = await proveCandidates(toProve, context, proofDeps);
  const confirmed = proofRun.results.filter((proof) => proof.status === "confirmed");
  console.log(`[repair-live] confirmed ${confirmed.length}/${toProve.length} by real browser proof`);

  const repairs = await repairFindings(confirmed, candidates, context, {
    sandbox,
    models,
    profile,
    logger,
    maxAttempts: 3,
    maxRepairs: 3,
    proveCandidate: (candidate: Candidate) => proveOne(candidate, proofDeps),
  });

  let ok = true;
  for (const repair of repairs) {
    const candidate = candidates.find((entry) => entry.id === repair.candidateId);
    console.log(`[repair-live] ${candidate?.file} exit=${repair.exit} attempts=${repair.attempts.length} reasons=${repair.attempts.map((a) => (a.applied ? "applied" : `not-applied:${a.applyReason}`)).join(" -> ")}`);
    if (repair.exit !== "VERIFIED") ok = false;
  }
  const docsRepair = repairs.find((repair) => candidates.find((entry) => entry.id === repair.candidateId)?.file?.endsWith("Docs.tsx"));
  if (docsRepair && docsRepair.attempts.length < 2) {
    console.log("[repair-live] expected the Docs fix to need a retry");
    ok = false;
  }

  const verifications = await verifyRepairs(repairs, candidates, context, {
    sandbox,
    profile,
    proveOne: (candidate: Candidate) => proveOne(candidate, proofDeps),
    baselineTypecheckPassed: true,
  });
  for (const [candidateId, report] of Object.entries(verifications)) {
    const candidate = candidates.find((entry) => entry.id === candidateId);
    console.log(`[repair-live] verification ${candidate?.file} passed=${report.passed} steps=${report.steps.filter((s) => !s.skipped).map((s) => `${s.kind}:${s.passed}`).join(",")}`);
    if (!report.passed) ok = false;
  }

  const diff = await sandbox.gitDiff();
  console.log(`[repair-live] diff bytes=${diff.length}`);
  console.log(ok ? "REPAIR LIVE PASS" : "REPAIR LIVE FAIL");
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.log(`[repair-live] FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sandbox.cleanup();
}
