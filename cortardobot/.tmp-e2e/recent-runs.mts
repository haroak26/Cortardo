import { desc, eq } from "drizzle-orm";
import { db } from "../../server/db.ts";
import { reviewRuns, reviewFindings } from "../../shared/schema.ts";

const REPOSITORY_ID = "87c15a68-051d-43f0-a894-56e0f0435cc6";

const runs = await db
  .select()
  .from(reviewRuns)
  .where(eq(reviewRuns.repositoryId, REPOSITORY_ID))
  .orderBy(desc(reviewRuns.createdAt))
  .limit(12);

console.log(`recent runs for repository ${REPOSITORY_ID}: ${runs.length}`);
for (const run of runs) {
  const stats = (run.stats ?? {}) as Record<string, any>;
  const summary = stats.summary ?? {};
  const loop = stats.loop ?? {};
  console.log(
    [
      run.id,
      `created=${run.createdAt?.toISOString?.() ?? run.createdAt}`,
      `status=${run.status}`,
      `engine=${run.engineVersion}`,
      `head=${(run.headSha ?? "").slice(0, 8)}`,
      `publish=${run.publishState}`,
      `publishErr=${run.publishError ?? "-"}`,
      `publishedReview=${run.publishedReviewId ?? "-"}`,
      `confirmed=${summary.issuesConfirmed}`,
      `verified=${summary.issuesVerified}`,
      `staticOnly=${summary.staticOnly}`,
      `degraded=${stats.degraded ?? false}`,
      `judgeProve=${loop.judgeProve ?? "-"}/proven=${loop.proven ?? "-"}/unprovable=${loop.proofUnavailable ?? "-"}/errors=${loop.proofErrors ?? "-"}`,
      `publishSkip=${stats.publishSkip ?? stats.publishError ?? "-"}`,
    ].join(" "),
  );
  if (run.error) console.log(`   error: ${String(run.error).slice(0, 300)}`);
  if (stats.degradedReason) console.log(`   degradedReason: ${String(stats.degradedReason).slice(0, 300)}`);
}

const latest = runs[0];
if (latest) {
  const findings = await db.select().from(reviewFindings).where(eq(reviewFindings.runId, latest.id));
  console.log(`\nfindings for latest run ${latest.id}: ${findings.length}`);
  for (const finding of findings) {
    const models = (finding.models ?? {}) as Record<string, any>;
    const fix = (finding.fix ?? {}) as Record<string, any>;
    console.log(
      `  ${finding.findingKey} ${finding.path}:${finding.line ?? "?"} severity=${finding.severity} verdict=${finding.verdict} proof=${models.proof?.status ?? "-"} strategy=${models.proof?.strategy ?? "-"} fix=${fix.status ?? "-"} verified=${fix.verified ?? false}`,
    );
  }
}
process.exit(0);
