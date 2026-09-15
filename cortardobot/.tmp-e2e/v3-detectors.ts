import { readFileSync } from "node:fs";
import { analyzeChanges } from "../src/v3/intelligence.ts";
import { runDetectors } from "../src/v3/detectors.ts";
import type { ReviewRequest } from "../src/v3/types.ts";

const input = JSON.parse(readFileSync("/home/runner/workspace/cortardobot/.tmp-e2e/pr6-input.json", "utf8"));
const request: ReviewRequest = {
  runId: "local-detector-check",
  repo: { fullName: "haroak26/Artificial-Gateway", defaultBranch: "main", installationId: 161125043, cloneUrl: "https://github.com/haroak26/Artificial-Gateway.git", token: "x" },
  pr: { number: 6, title: input.title, body: input.body ?? "", baseSha: "", headSha: "0b19da07", baseBranch: "main", headBranch: "new-pricing-page" },
  files: input.files,
};

const context = analyzeChanges(request);
console.log("files:", context.files.map((f) => `${f.path} +${f.additions}/-${f.deletions} hunks=${f.hunks.length}`).join(", "));
console.log("classification:", context.classification.join("/"), "size:", context.size);
console.log("pages:", JSON.stringify(context.pages));
const candidates = runDetectors(context);
for (const candidate of candidates) {
  console.log(`\n[${candidate.severity}] ${candidate.file}:${candidate.line} (${candidate.tags.join(",")})`);
  console.log("  check:", candidate.check ? JSON.stringify(candidate.check) : "none");
  console.log("  claim:", candidate.claim.slice(0, 220));
}
