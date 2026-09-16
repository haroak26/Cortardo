import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

const owner = "haroak26";
const repo = "Artificial-Gateway";
const pull_number = 7;

const appId = process.env.GITHUB_APP_ID!.trim();
const rawKey = process.env.GITHUB_APP_PRIVATE_KEY!.trim().replace(/^"|"$/g, "");
const privateKey = rawKey.includes("\\n")
  ? rawKey.replace(/\\n/g, "\n")
  : rawKey.replace(/\r/g, "").replace(/^(-----BEGIN [^-]+-----)\s*([\s\S]*?)\s*(-----END [^-]+-----)$/, (_m, a, b, c) => `${a}\n${(b.replace(/\s+/g, "").match(/.{1,64}/g) ?? []).join("\n")}\n${c}\n`);

const octokit = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey, installationId: 161125043 } });

const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
console.log(`PR #${pr.number} "${pr.title}" state=${pr.state} merged=${pr.merged} draft=${pr.draft}`);
console.log(`head=${pr.head.sha} base=${pr.base.sha} files=${pr.changed_files} +${pr.additions}/-${pr.deletions}`);
console.log(`branch=${pr.head.ref} -> ${pr.base.ref} url=${pr.html_url}`);

const files = await octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number, per_page: 100 });
console.log(`listFiles: ${files.length} files`);
for (const f of files) console.log(`  ${f.status.padEnd(9)} ${f.filename} (+${f.additions}/-${f.deletions}) patch=${f.patch ? "yes" : "no"}`);

const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, { owner, repo, pull_number, per_page: 100 });
console.log(`existing reviews: ${reviews.length}`);
for (const r of reviews) console.log(`  review ${r.id} @${r.user?.login} state=${r.state} at=${r.submitted_at} body=${JSON.stringify((r.body ?? "").slice(0, 60))}`);
process.exit(0);
