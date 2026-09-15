import { readFileSync } from "node:fs";
import { E2BSandboxInstance } from "../src/v3/sandbox-e2b.ts";
import { analyzeChanges } from "../src/v3/intelligence.ts";
import { runDetectors } from "../src/v3/detectors.ts";
import type { ReviewRequest } from "../src/v3/types.ts";
import { installationToken } from "../../.tmp/v3-gh.ts";

const input = JSON.parse(readFileSync("/home/runner/workspace/cortardobot/.tmp-e2e/pr6-input.json", "utf8"));
const request: ReviewRequest = {
  runId: "sandbox-validate",
  repo: { fullName: "haroak26/Artificial-Gateway", defaultBranch: "main", installationId: 161125043, cloneUrl: "https://github.com/haroak26/Artificial-Gateway.git", token: "" },
  pr: { number: 6, title: input.title, body: input.body ?? "", baseSha: "", headSha: "0b19da07", baseBranch: "main", headBranch: "new-pricing-page" },
  files: input.files,
};
const context = analyzeChanges(request);
const candidates = runDetectors(context).filter((candidate) => candidate.check);
console.log(`[validate] ${candidates.length} browser-check candidates`);

const token = await installationToken();
const sandbox = await E2BSandboxInstance.create({
  template: process.env.CORTADO_E2B_TEMPLATE ?? "cortardo-review-v1",
  apiKey: process.env.E2B_API_KEY ?? "",
  timeoutMs: 900_000,
  repoDir: "/home/user/repo",
});

try {
  const t0 = Date.now();
  await sandbox.prepare({ cloneUrl: request.repo.cloneUrl, token, ref: "refs/pull/6/head", headBranch: "new-pricing-page" });
  console.log(`[validate] cloned in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const t1 = Date.now();
  await sandbox.install();
  console.log(`[validate] installed in ${((Date.now() - t1) / 1000).toFixed(0)}s`);
  const profile = await sandbox.profile();
  console.log(`[validate] profile: manager=${profile.packageManager} dev=${profile.devCommand} typecheck=${profile.typecheckCommand} tests=${profile.testCommand ?? "none"}`);

  const runChecks = async (label: string) => {
    const app = await sandbox.startApp({ port: 4173, readyPath: candidates[0].check!.path });
    const started = Date.now();
    const results = await sandbox.browserChecks(candidates.map((candidate) => ({ id: candidate.id, check: candidate.check! })), app.url);
    await app.stop();
    console.log(`[validate] ${label} browser batch in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    for (const result of results) {
      const candidate = candidates.find((entry) => entry.id === result.id);
      console.log(`  ${result.passed ? "PASS" : "FAIL"} ${candidate?.file}:${candidate?.line} — ${result.detail}${result.pageErrors[0] ? ` | ${result.pageErrors[0].split("\n")[0]}` : ""}`);
    }
    return results;
  };

  await runChecks("baseline");

  const edits = candidates.flatMap((candidate) => candidate.autoFix ?? []);
  const applied = await sandbox.applyEdits(edits);
  console.log(`[validate] applied ${applied.applied.length}/${edits.length} deterministic edits; failed=${JSON.stringify(applied.failed.map((f) => f.reason))}`);
  await sandbox.write("/home/user/repo/.cortado-marker", "patched");

  await runChecks("post-fix");
  const diff = await sandbox.gitDiff();
  console.log(`[validate] diff bytes=${diff.length}`);
  console.log(diff.slice(0, 1200));
} catch (error) {
  console.log(`[validate] FATAL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await sandbox.cleanup();
}
