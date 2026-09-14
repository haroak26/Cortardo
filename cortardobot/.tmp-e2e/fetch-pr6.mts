import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { writeFileSync, mkdirSync } from "node:fs";
import { Buffer } from "node:buffer";

const owner = "haroak26";
const repo = "Artificial-Gateway";
const pull_number = 6;

const appId = process.env.GITHUB_APP_ID!.trim();
const rawKey = process.env.GITHUB_APP_PRIVATE_KEY!.trim().replace(/^"|"$/g, "");
const privateKey = rawKey.includes("\\n")
  ? rawKey.replace(/\\n/g, "\n")
  : rawKey.replace(/\r/g, "").replace(/^(-----BEGIN [^-]+-----)\s*([\s\S]*?)\s*(-----END [^-]+-----)$/, (_m, a, b, c) => `${a}\n${(b.replace(/\s+/g, "").match(/.{1,64}/g) ?? []).join("\n")}\n${c}\n`);

const octokit = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey, installationId: 161125043 } });

const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
console.log(`PR #${pr.number} "${pr.title}" state=${pr.state} merged=${pr.merged} draft=${pr.draft}`);
console.log(`head=${pr.head.sha} base=${pr.base.sha} files=${pr.changed_files} +${pr.additions}/-${pr.deletions}`);

const files = await octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number, per_page: 100 });
console.log(`listFiles: ${files.length} files`);
for (const f of files) console.log(`  ${f.status.padEnd(9)} ${f.filename} (+${f.additions}/-${f.deletions}) patch=${f.patch ? "yes" : "no"}`);

const MAX_CONTENT = 200_000;
const inputs = [];
for (const f of files) {
  let content: string | undefined;
  if (f.status !== "removed" && f.status !== "renamed") {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: f.filename, ref: pr.head.sha });
      if (!Array.isArray(data) && data.type === "file" && data.size <= MAX_CONTENT && data.content) {
        content = Buffer.from(data.content, data.encoding as BufferEncoding).toString("utf8");
      }
    } catch (error) {
      console.log(`  ! content fetch failed for ${f.filename}: ${(error as Error).message.slice(0, 80)}`);
    }
  }
  inputs.push({
    path: f.filename,
    status: f.status === "added" ? "added" : f.status === "removed" ? "removed" : f.status === "renamed" ? "renamed" : "modified",
    patch: f.patch,
    content,
  });
}

const input = {
  id: `gh-${owner}-${repo}-${pull_number}-${pr.head.sha.slice(0, 8)}`,
  title: pr.title,
  body: pr.body ?? "",
  author: pr.user?.login ?? undefined,
  baseBranch: pr.base.ref,
  headBranch: pr.head.ref,
  repoRules: [],
  files: inputs,
};
mkdirSync("/home/runner/workspace/cortardobot/.tmp-e2e", { recursive: true });
writeFileSync("/home/runner/workspace/cortardobot/.tmp-e2e/pr6-input.json", JSON.stringify(input, null, 2));
console.log(`wrote pr6-input.json with ${inputs.length} files, total content bytes=${inputs.reduce((n, f) => n + (f.content?.length ?? 0), 0)}`);

const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, { owner, repo, pull_number, per_page: 100 });
const reviewComments = await octokit.paginate(octokit.rest.pulls.listReviewComments, { owner, repo, pull_number, per_page: 100 });
const issueComments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: pull_number, per_page: 100 });
writeFileSync(
  "/home/runner/workspace/cortardobot/.tmp-e2e/pr6-existing.json",
  JSON.stringify(
    {
      reviews: reviews.map((r) => ({ id: r.id, user: r.user?.login, state: r.state, submitted_at: r.submitted_at, body: r.body ?? "" })),
      reviewComments: reviewComments.map((c) => ({ id: c.id, user: c.user?.login, path: c.path, line: c.line ?? c.original_line, body: c.body ?? "" })),
      issueComments: issueComments.map((c) => ({ id: c.id, user: c.user?.login, created_at: c.created_at, body: c.body ?? "" })),
    },
    null,
    2,
  ),
);
console.log(`existing comments snapshot: reviews=${reviews.length} reviewComments=${reviewComments.length} issueComments=${issueComments.length}`);
for (const r of reviews) console.log(`  review ${r.id} @${r.user?.login} state=${r.state} body=${JSON.stringify((r.body ?? "").slice(0, 80))}`);
for (const c of reviewComments) console.log(`  inline ${c.id} @${c.user?.login} ${c.path}:${c.line ?? c.original_line} body=${JSON.stringify((c.body ?? "").slice(0, 80))}`);
process.exit(0);
