/**
 * CortardoBot 3.5 — live E2E on any pull request.
 *
 * Real gateway models, real E2B sandbox, real GitHub publish. This is the gate
 * that proves the loop works end to end:
 *
 *   plan → investigate (reproduce-or-drop) → fix (3 attempts) → verify (clean
 *   replay + independent reviewer) → report → publish
 *
 * Nothing is hardcoded to a specific pull request. Point it at a repository
 * (uuid or owner/name) and, optionally, a PR number; without `--pr` it picks
 * the most recently updated open PR.
 *
 * Usage (from the workspace root):
 *   node --import tsx scripts/e2e/live-3.5.mts --repo owner/name --pr 42
 *   node --import tsx scripts/e2e/live-3.5.mts --repo <uuid> --strict \
 *        --expect client/src/pages/Billing.tsx --expect client/src/pages/Usage.tsx
 *   node --import tsx scripts/e2e/live-3.5.mts --list
 *
 * Flags:
 *   --repo <uuid|owner/name>  required for a run; repository to review
 *   --pr <number>             pull request number (defaults to the newest open PR)
 *   --wait <minutes>          how long to wait for the run (default 30)
 *   --keep-comments           do not delete previous CortadoBot inline comments first
 *   --strict                  treat advisory checks as failures (use on the ship gate)
 *   --expect <path>           advisory expectation: a candidate should exist for
 *                             this file (repeatable, fixture-specific checks)
 *   --list                    list connected repositories and exit
 *   --help                    print this help
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";

const DEFAULT_LOG = process.env.E2E_LOG ?? "/tmp/opencode/cortardo-e2e.log";
const TERMINAL_STATES = new Set(["reproduced", "verified_fix", "fix_failed", "not_reproduced", "deferred", "error"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Options {
  repo?: string;
  prNumber?: number;
  waitMs: number;
  keepComments: boolean;
  strict: boolean;
  expectFiles: string[];
  list: boolean;
}

function parseArgs(argv: string[]): Options | undefined {
  const options: Options = { waitMs: 30 * 60_000, keepComments: false, strict: false, expectFiles: [], list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return undefined;
    if (arg === "--repo") options.repo = String(argv[++index] ?? "");
    else if (arg === "--pr") options.prNumber = Number(argv[++index] ?? 0);
    else if (arg === "--wait") options.waitMs = Number(argv[++index] ?? 30) * 60_000;
    else if (arg === "--keep-comments") options.keepComments = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--expect") options.expectFiles.push(String(argv[++index] ?? ""));
    else if (arg === "--list") options.list = true;
  }
  return options;
}

const HELP = [
  "CortardoBot 3.5 live E2E",
  "",
  "Usage: node --import tsx scripts/e2e/live-3.5.mts --repo <uuid|owner/name> [--pr <n>] [options]",
  "",
  "  --repo <uuid|owner/name>  repository to review (required unless --list)",
  "  --pr <number>             pull request number (defaults to the newest open PR)",
  "  --wait <minutes>          how long to wait for the run (default 30)",
  "  --keep-comments           keep previous CortadoBot inline comments",
  "  --strict                  advisory checks count as failures",
  "  --expect <path>           advisory expectation that a candidate exists for a file (repeatable)",
  "  --list                    list connected repositories and exit",
  "  --help                    print this help",
].join("\n");

const options = parseArgs(process.argv.slice(2));
if (!options) {
  console.log(HELP);
  process.exit(0);
}
if (!options.repo && !options.list) {
  console.error("error: --repo <uuid|owner/name> is required (or use --list)\n");
  console.log(HELP);
  process.exit(2);
}

const results: Array<{ name: string; ok: boolean; advisory: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string, advisory = false) => {
  results.push({ name, ok, advisory, detail });
  console.log(`[e2e] ${ok ? "PASS" : advisory ? "WARN" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const { ENGINE_VERSION } = await import("../../cortardobot/src/version.ts");
const { enqueueReview } = await import("../../server/lib/review/runner.ts");
const { db } = await import("../../server/db.ts");
const { repositories, reviewRuns, reviewFindings } = await import("../../shared/schema.ts");
const { storage } = await import("../../server/storage.ts");
const { getInstallationOctokit } = await import("../../server/lib/github/app.ts");

if (options.list) {
  const rows = await db.select().from(repositories).where(eq(repositories.reviewEnabled, true)).limit(50);
  console.log("connected repositories (reviewEnabled):");
  for (const row of rows) {
    console.log(`  ${row.id}  ${row.fullName.padEnd(40)} lastReviewed=${row.lastReviewedAt?.toISOString() ?? "never"}`);
  }
  process.exit(0);
}

const logPath = DEFAULT_LOG;
const log = (message: string) => {
  appendFileSync(logPath, `${message}\n`);
  console.log(message);
};

writeFileSync(logPath, `[e2e] cortardo 3.5 live E2E — ${new Date().toISOString()}\n`);
log(`[e2e] engine version at import: ${ENGINE_VERSION}`);

// ---------------------------------------------------------------------------
// 0. Environment sanity
// ---------------------------------------------------------------------------
const missing: string[] = [];
if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
if (!process.env.E2B_API_KEY) missing.push("E2B_API_KEY");
if (!process.env.CORTADO_AI_API_KEY && !process.env.CORTARDO_BOT_MERGE_API_KEY && !process.env.MERGE_GATEWAY_API_KEY) {
  missing.push("CORTADO_AI_API_KEY (or CORTARDO_BOT_MERGE_API_KEY / MERGE_GATEWAY_API_KEY)");
}
if (!process.env.GITHUB_APP_ID) missing.push("GITHUB_APP_ID");
if (!process.env.GITHUB_APP_PRIVATE_KEY) missing.push("GITHUB_APP_PRIVATE_KEY");
check("environment has the required keys", missing.length === 0, missing.join(", "));
if (missing.length > 0) process.exit(1);

// ---------------------------------------------------------------------------
// 1. Resolve the repository and pull request
// ---------------------------------------------------------------------------
const repository = UUID_RE.test(options.repo!)
  ? await storage.getRepositoryById(options.repo!)
  : (await db.select().from(repositories).where(eq(repositories.fullName, options.repo!)).limit(1))[0];
if (!repository) {
  check("repository exists", false, `no connected repository matches "${options.repo}" — run with --list`);
  process.exit(1);
}
if (!repository.installationId) {
  check("repository has a GitHub installation", false, repository.fullName);
  process.exit(1);
}
const octokit = getInstallationOctokit(repository.installationId);
const [owner, repoName] = repository.fullName.split("/");

let prNumber = options.prNumber && options.prNumber > 0 ? options.prNumber : undefined;
if (!prNumber) {
  const { data: open } = await octokit.rest.pulls.list({ owner, repo: repoName, state: "open", sort: "updated", direction: "desc", per_page: 1 });
  if (open.length === 0) {
    check("an open pull request is available", false, `${repository.fullName} has no open pull requests — pass --pr`);
    process.exit(1);
  }
  prNumber = open[0].number;
  log(`[e2e] no --pr given; using the most recently updated open PR #${prNumber} (${open[0].title})`);
}

const { data: pull } = await octokit.rest.pulls.get({ owner, repo: repoName, pull_number: prNumber });
log(`[e2e] repo=${repository.fullName} pr=#${pull.number} "${pull.title}" head=${pull.head.sha.slice(0, 8)} files=${pull.changed_files}`);
check("pull request is open and not a draft", pull.state === "open" && !pull.draft, `state=${pull.state}`);

// ---------------------------------------------------------------------------
// 2. Clean the PR of previous bot comments so the new run is unambiguous
// ---------------------------------------------------------------------------
if (!options.keepComments) {
  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo: repoName,
    pull_number: prNumber,
    per_page: 100,
  });
  let deleted = 0;
  for (const comment of comments) {
    const login = comment.user?.login ?? "";
    if (login !== "cortardobot[bot]" && !login.toLowerCase().includes("cortado")) continue;
    await octokit.rest.pulls.deleteReviewComment({ owner, repo: repoName, comment_id: comment.id }).then(
      () => {
        deleted += 1;
      },
      () => undefined,
    );
  }
  log(`[e2e] removed ${deleted} previous CortadoBot inline comment(s)`);
}

// ---------------------------------------------------------------------------
// 3. Enqueue the review through the real server path
// ---------------------------------------------------------------------------
const enqueued = await enqueueReview({
  repositoryId: repository.id,
  pullRequestNumber: prNumber,
  trigger: "manual",
  workspaceId: repository.workspaceId,
});
if (!enqueued.runId) {
  check("run was enqueued", false, `duplicate=${enqueued.duplicate} error=${enqueued.error ?? "none"}`);
  process.exit(1);
}
const runId = enqueued.runId;
log(`[e2e] enqueued run ${runId}`);

const started = Date.now();
let row: typeof reviewRuns.$inferSelect | undefined;
let lastState = "";
while (Date.now() - started < options.waitMs) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const [current] = await db.select().from(reviewRuns).where(eq(reviewRuns.id, runId)).limit(1);
  row = current;
  if (!row) continue;
  const state = `${row.status}/${row.publishState}`;
  if (state !== lastState) {
    lastState = state;
    log(`[e2e] status=${row.status} publish=${row.publishState} engine=${row.engineVersion ?? "-"}`);
  }
  const settled = (row.status === "done" || row.status === "error") && row.publishState !== "pending";
  if (settled) break;
}
if (!row || row.status === "queued" || row.status === "running") {
  check("run settled before the timeout", false, `status=${row?.status ?? "missing"}`);
  process.exit(1);
}

const stats = (row.stats ?? {}) as Record<string, any>;
const summary = stats.summary ?? {};
const coverage: Array<{ candidateId: string; claim: string; severity: string; file?: string; state: string; reason: string }> = stats.coverage ?? [];
const findings = await db.select().from(reviewFindings).where(eq(reviewFindings.runId, runId));

log(`\n[e2e] run ${runId} status=${row.status} error=${row.error ?? "none"}`);
log(
  `[e2e] head=${row.headSha?.slice(0, 8)} publish=${row.publishState} review=${row.publishedReviewId ?? "none"} publish_error=${row.publishError ?? "none"}`,
);
log(
  `[e2e] summary: found=${summary.issuesFound} reproduced=${summary.issuesReproduced} verified=${summary.issuesVerified} ` +
    `notReproduced=${summary.staticOnly} deferred=${summary.deferred} errors=${summary.errors} ` +
    `duration=${(Number(summary.durationMs ?? 0) / 1000).toFixed(1)}s cost=$${Number(summary.costUsd ?? 0).toFixed(4)} calls=${summary.modelCalls}`,
);
log(`[e2e] models: ${JSON.stringify(stats.models ?? {})}`);
log(`[e2e] degraded=${stats.degraded ?? false} reason=${stats.degradedReason ?? "none"}`);
log(`[e2e] verdict=${stats.report?.verdict?.decision ?? "n/a"} runtime=${stats.report?.runtime?.status ?? "n/a"}${stats.report?.runtime?.reason ? ` (${stats.report.runtime.reason})` : ""}`);

for (const entry of coverage) {
  log(`[e2e] coverage ${entry.state.padEnd(14)} [${entry.severity}] ${entry.file ?? "n/a"} — ${String(entry.claim).slice(0, 110)}`);
}
for (const finding of findings) {
  const repro = (finding.models as any)?.repro;
  log(
    `[e2e] finding ${finding.findingKey} ${finding.path} state=${finding.verdict} repro=${repro?.path ?? "none"} ` +
      `fix=${(finding.fix as any)?.status ?? "-"} verified=${(finding.fix as any)?.verified ?? false}`,
  );
}

// ---------------------------------------------------------------------------
// 4. Hard checks on the engine result
// ---------------------------------------------------------------------------
check("engine version is 3.5.0", row.engineVersion === "3.5.0", row.engineVersion ?? "missing");
check("run status is done", row.status === "done", row.error ?? undefined);
const serializedStats = JSON.stringify(stats);
check("no gateway key or base URL in stats", !/"apiKey"|"baseUrl"|mg_/.test(serializedStats));
const eventsText = JSON.stringify(stats.events ?? []);
check("no repository test-framework fallback in the run", !/vitest|jest|npm test/.test(eventsText), "the 3.4 failure mode must be gone");
check("coverage is recorded for every candidate", coverage.length > 0, `candidates=${coverage.length}`);
check(
  "every candidate has a terminal state",
  coverage.every((entry) => TERMINAL_STATES.has(entry.state)),
  coverage
    .filter((entry) => !TERMINAL_STATES.has(entry.state))
    .map((entry) => `${entry.candidateId}:${entry.state}`)
    .join(", ") || undefined,
);
check(
  "every candidate carries a reason",
  coverage.every((entry) => typeof entry.reason === "string" && entry.reason.length > 0),
);
const runtimeStatus = stats.report?.runtime?.status;
check(
  "runtime exercise is either exercised or skipped with a reason",
  runtimeStatus === "exercised" || (runtimeStatus === "skipped" && Boolean(stats.report?.runtime?.reason)),
  `runtime=${runtimeStatus ?? "missing"}`,
);

// ---------------------------------------------------------------------------
// 5. GitHub-side verification of the published review and check run
// ---------------------------------------------------------------------------
if (row.publishedReviewId) {
  const reviewId = Number(row.publishedReviewId);
  const { data: review } = await octokit.rest.pulls.getReview({ owner, repo: repoName, pull_number: prNumber, review_id: reviewId });
  const body = review.body ?? "";
  check("published review is from this run", body.includes(runId), runId);
  check("published review declares engine 3.5.0", body.includes("engine 3.5.0"));
  check("published review has a verdict section", /## Final verdict:/.test(body));
  check("published review does not leak secrets", !/"apiKey"|"baseUrl"|mg_/.test(body));
  check("published review includes coverage", /### Coverage/.test(body), undefined, true);

  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo: repoName,
    pull_number: prNumber,
    per_page: 100,
  });
  const ours = comments.filter((comment) => (comment.user?.login ?? "").toLowerCase().includes("cortado"));
  log(`[e2e] published review ${reviewId} with ${ours.length} inline comment(s)`);
  check("every reproduced finding has an inline comment or advisory", ours.length > 0 || coverage.every((entry) => entry.state !== "reproduced"), undefined, true);

  const { data: checks } = await octokit.rest.checks.listForRef({ owner, repo: repoName, ref: pull.head.sha, per_page: 100 });
  const cortadoCheck = checks.check_runs.find((entry) => entry.name === "Cortado" && entry.external_id === `cortado:${runId}`);
  check("Cortado check run exists for this run", Boolean(cortadoCheck));
  if (cortadoCheck) {
    const green = cortadoCheck.conclusion === "success";
    const unresolved = coverage.some((entry) => ["reproduced", "fix_failed", "error"].includes(entry.state));
    check("check conclusion is honest", !(green && unresolved), `conclusion=${cortadoCheck.conclusion} title=${cortadoCheck.output?.title ?? ""}`);
  }
} else {
  check("a review was published", false, row.publishError ?? "no publish error recorded");
}

// ---------------------------------------------------------------------------
// 6. Advisory expectations for files supplied with --expect
// ---------------------------------------------------------------------------
for (const expected of options.expectFiles) {
  if (!expected) continue;
  const matches = coverage.filter((entry) => entry.file === expected || (entry.file ?? "").endsWith(`/${expected}`));
  check(
    `a candidate exists for ${expected}`,
    matches.length > 0,
    matches.map((entry) => `${entry.state}`).join(", ") || "no candidate",
    true,
  );
  check(
    `${expected} reached reproduced or better`,
    matches.some((entry) => ["reproduced", "verified_fix", "fix_failed"].includes(entry.state)),
    matches.map((entry) => `${entry.state}: ${String(entry.reason).slice(0, 60)}`).join("; ") || undefined,
    true,
  );
}
check(
  "no candidate errored during runtime exercise",
  coverage.every((entry) => entry.state !== "error"),
  coverage.filter((entry) => entry.state === "error").map((entry) => `${entry.candidateId}: ${String(entry.reason).slice(0, 80)}`).join("; ") || undefined,
  true,
);

// ---------------------------------------------------------------------------
// 7. Verdict
// ---------------------------------------------------------------------------
const failures = results.filter((entry) => !entry.ok && !entry.advisory);
const warnings = results.filter((entry) => !entry.ok && entry.advisory);
log(`\n[e2e] ${results.filter((entry) => entry.ok).length} passed, ${failures.length} failed, ${warnings.length} advisory`);
log(`[e2e] artifacts: run=${runId} repo=${repository.fullName} pr=#${prNumber} log=${logPath}`);
if (options.strict && warnings.length > 0) {
  log("[e2e] strict mode: advisory checks count as failures");
  process.exit(1);
}
log(failures.length === 0 ? "[e2e] PASS" : "[e2e] FAIL");
process.exit(failures.length === 0 ? 0 : 1);
