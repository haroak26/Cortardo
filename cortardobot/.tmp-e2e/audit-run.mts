import { eq } from "drizzle-orm";
import { db } from "../../server/db.ts";
import { reviewRuns } from "../../shared/schema.ts";
import { getInstallationOctokit } from "../../server/lib/github/app.ts";

const RUN_ID = "644bee50-8c98-4a4c-a3ca-5cacd038a699";

const [run] = await db.select().from(reviewRuns).where(eq(reviewRuns.id, RUN_ID)).limit(1);
if (!run) throw new Error("run not found");
const stats = (run.stats ?? {}) as Record<string, any>;
console.log(`run ${run.id} status=${run.status} publish=${run.publishState} publishedReview=${run.publishedReviewId}`);
console.log(`stats keys: ${Object.keys(stats).join(", ")}`);
console.log(`has stats.loop: ${"loop" in stats}`);
console.log(`stats.summary keys: ${Object.keys(stats.summary ?? {}).join(", ")}`);
console.log(`events: ${(stats.events ?? []).length}`);
for (const event of stats.events ?? []) {
  const detail = String(event.detail ?? "");
  if (/prover|proof|degrade|escalat|authored|unprovable|error/i.test(`${event.stage} ${detail}`)) {
    console.log(`  ${event.stage} ${event.status} — ${detail.slice(0, 240)}`);
  }
}

const octokit = getInstallationOctokit(161125043);
const { data: checks } = await octokit.rest.checks.listForRef({
  owner: "haroak26",
  repo: "Artificial-Gateway",
  ref: "74c5449da5b38431ae1638b682a5ba2f8bbf1bda",
  per_page: 100,
});
console.log(`\ncheck runs: ${checks.total_count}`);
for (const check of checks.check_runs) {
  console.log(
    `  ${check.name} status=${check.status} conclusion=${check.conclusion} external=${check.external_id ?? "-"} title=${JSON.stringify(check.output?.title ?? "")} started=${check.started_at}`,
  );
}

const files = ["client/src/pages/Billing.tsx", "client/src/pages/Usage.tsx", "client/src/pages/Auth.tsx", "client/src/pages/ApiKeys.tsx", "client/src/pages/Playground.tsx"];
for (const path of files) {
  const { data } = await octokit.rest.repos.getContent({ owner: "haroak26", repo: "Artificial-Gateway", path, ref: "74c5449da5b38431ae1638b682a5ba2f8bbf1bda" });
  const content = Buffer.from((data as any).content, "base64").toString("utf8");
  const lines = content.split("\n");
  console.log(`\n===== ${path} (${lines.length} lines) =====`);
  if (path.endsWith("Billing.tsx")) {
    lines.forEach((line, index) => {
      if (/localStorage|plan|useEffect|activeWorkspace/i.test(line)) console.log(`${index + 1}: ${line}`);
    });
  } else if (path.endsWith("Usage.tsx")) {
    lines.slice(22, 36).forEach((line, index) => console.log(`${index + 23}: ${line}`));
  } else if (path.endsWith("Auth.tsx")) {
    lines.slice(30, 42).forEach((line, index) => console.log(`${index + 31}: ${line}`));
  } else if (path.endsWith("ApiKeys.tsx")) {
    lines.forEach((line, index) => {
      if (/sessionStorage|rawKey/i.test(line)) console.log(`${index + 1}: ${line}`);
    });
  } else if (path.endsWith("Playground.tsx")) {
    lines.forEach((line, index) => {
      if (/model.*gpt|gpt-4o-mini/i.test(line)) console.log(`${index + 1}: ${line}`);
    });
  }
}
process.exit(0);
