/**
 * Live 3.4 E2E on haroak26/Artificial-Gateway PR7 via the real server path.
 *
 * Real Merge gateway models, real E2B sandbox, cache off, real GitHub publish.
 * This is not the scripted/zero-spend path: every model call goes to the
 * gateway and every proof/repair runs in a real sandbox.
 *
 * Instrumentation: ModelRouter.complete is wrapped so prover turns are dumped
 * to /tmp/opencode/pr7-prover.log (diagnostics only; no behaviour change).
 */
process.env.CORTADO_CACHE_ENABLED = "0";
process.env.CORTADO_LOG_LEVEL ??= "info";

import { appendFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";

const PROVER_LOG = "/tmp/opencode/pr7-prover.log";

const { ENGINE_VERSION } = await import("../src/v3/version.ts");
const { DEFAULT_MODELS, DEFAULT_REASONING } = await import("../../shared/models.ts");
const { ModelRouter } = await import("../src/v3/models.ts");

const originalComplete = ModelRouter.prototype.complete;
ModelRouter.prototype.complete = async function patchedComplete(task: any) {
  const response = await originalComplete.call(this, task);
  if (task?.kind === "prover" || task?.kind === "repair_agent") {
    appendFileSync(
      PROVER_LOG,
      [
        `\n===== ${new Date().toISOString()} kind=${task.kind} role=${task.role} label=${task.label ?? "-"} =====`,
        `--- user (first 1500) ---\n${String(task.user ?? "").slice(0, 1500)}`,
        `--- response (first 4000) ---\n${String(response.text ?? "").slice(0, 4000)}`,
      ].join("\n"),
    );
  }
  return response;
};

const { enqueueReview } = await import("../../server/lib/review/runner.ts");
const { db } = await import("../../server/db.ts");
const { reviewRuns, reviewFindings } = await import("../../shared/schema.ts");
const { storage } = await import("../../server/storage.ts");

const REPOSITORY_ID = "87c15a68-051d-43f0-a894-56e0f0435cc6";
const PR_NUMBER = 7;

const repository = await storage.getRepositoryById(REPOSITORY_ID);
if (!repository) {
  console.error("[pr7-live] repository not found");
  process.exit(1);
}

writeFileSync(PROVER_LOG, `[pr7-live] prover diagnostics start ${new Date().toISOString()}\n`);
console.log(`[pr7-live] repo ${repository.fullName} installation=${repository.installationId} workspace=${repository.workspaceId}`);
console.log(`[pr7-live] engine version at import: ${ENGINE_VERSION}`);
console.log(`[pr7-live] cache enabled: ${process.env.CORTADO_CACHE_ENABLED !== "0"}`);
console.log(
  `[pr7-live] models: luna=${DEFAULT_MODELS.luna} terra=${DEFAULT_MODELS.terra} codegen=${DEFAULT_MODELS.codegen} astra=${DEFAULT_MODELS.astra}`,
);
console.log(`[pr7-live] reasoning: ${JSON.stringify(DEFAULT_REASONING)}`);

const enqueued = await enqueueReview({
  repositoryId: REPOSITORY_ID,
  pullRequestNumber: PR_NUMBER,
  trigger: "manual",
  workspaceId: repository.workspaceId,
});
if (!enqueued.runId) {
  console.error(`[pr7-live] enqueue failed: duplicate=${enqueued.duplicate} error=${enqueued.error ?? "none"}`);
  process.exit(1);
}
const runId = enqueued.runId;
console.log(`[pr7-live] enqueued run ${runId}`);

const started = Date.now();
const deadline = started + 25 * 60_000;
let lastStatus = "";
let row: typeof reviewRuns.$inferSelect | undefined;

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const [current] = await db.select().from(reviewRuns).where(eq(reviewRuns.id, runId)).limit(1);
  row = current;
  if (!row) continue;
  const stateKey = `${row.status}/${row.publishState}`;
  if (stateKey !== lastStatus) {
    lastStatus = stateKey;
    console.log(`[pr7-live] status=${row.status} publish=${row.publishState} engine=${row.engineVersion}`);
  }
  const settled = (row.status === "done" || row.status === "error") && row.publishState !== "pending";
  if (settled) break;
}

if (!row || row.status === "queued" || row.status === "running") {
  console.error(`[pr7-live] timed out waiting for run ${runId} (status=${row?.status ?? "missing"})`);
  process.exit(1);
}

const stats = (row.stats ?? {}) as Record<string, any>;
const summary = stats.summary ?? {};
const models = stats.models ?? {};
console.log(`\n[pr7-live] run ${runId} status=${row.status} error=${row.error ?? "none"}`);
console.log(
  `[pr7-live] engine_version=${row.engineVersion} head=${row.headSha} publish_state=${row.publishState} published_review_id=${row.publishedReviewId ?? "none"} publish_error=${row.publishError ?? "none"}`,
);
console.log(
  `[pr7-live] summary: confirmed=${summary.issuesConfirmed} fixed=${summary.issuesFixed} verified=${summary.issuesVerified} staticOnly=${summary.staticOnly} durationMs=${summary.durationMs} costUsd=${summary.costUsd} calls=${summary.modelCalls}`,
);
console.log(`[pr7-live] models: ${JSON.stringify(models)}`);
console.log(`[pr7-live] cache: hits=${stats.cache?.hits ?? "n/a"} misses=${stats.cache?.misses ?? "n/a"}`);
console.log(`[pr7-live] degraded=${stats.degraded ?? false} reason=${stats.degradedReason ?? "none"}`);
console.log(`[pr7-live] report: source=${stats.report?.source ?? "none"} verdict=${stats.report?.verdict?.decision ?? "n/a"}`);
const findings = await db.select().from(reviewFindings).where(eq(reviewFindings.runId, runId));
for (const finding of findings) {
  const proof = (finding.models as any)?.proof;
  console.log(
    `[pr7-live] finding ${finding.findingKey} ${finding.path} verdict=${finding.verdict} proof=${proof?.status ?? "none"}/${proof?.strategy ?? "-"} fix=${(finding.fix as any)?.status ?? "-"} verified=${(finding.fix as any)?.verified ?? false}`,
  );
}
const secretLeak = /"apiKey"|"baseUrl"|mg_/.test(JSON.stringify(stats));
console.log(`[pr7-live] secret scan in stats: ${secretLeak ? "LEAK DETECTED" : "clean"}`);

const ok = row.status === "done" && row.engineVersion === "3.4.0" && row.publishState === "published" && !secretLeak;
console.log(ok ? "[pr7-live] PASS" : "[pr7-live] FAIL");
process.exit(ok ? 0 : 1);
