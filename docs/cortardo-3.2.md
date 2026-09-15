# CortardoBot 3.2 — Upgrade Plan, Status and Handoff

Engine version: `3.2.1` · Baseline: `3.1.0` (`docs/cortardo-3.1.md`) · Last updated: 2026-09-15
Goal: a fully autonomous review bot whose moat is **prove by execution → fix → live-test in E2B → understand why it failed → try a materially different fix → verify no regressions**, with broad multi-language coverage and a benchmark that proves it against CodeRabbit and Greptile.

> **How to use this document:** the "Remaining work" section is an ordered checklist. A new
> session can resume from the first unchecked item using the commands in "Gates and
> validation". Nothing in this file is aspirational unless marked pending.

## Locked decisions

- 3.2 ships **all phases** (0, A–E); this document tracks progress.
- Bench budget: **$0.25/PR cap, ~$10 total** (enforced by `maxCostUsd`, engine-side).
- Language scope: **broad multi-language** (adapter tiers below).
- **Opt-in per-repo auto-commit** of verified fixes (default suggestions-only).
- Invariants that must never relax: harness errors are never defect signals; `isVerifiedFix()`
  is the only definition of a fix; degraded runs can never produce a green check.

## Status snapshot

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Version bump, cost budget, swarm budgets, telemetry | **done** except `bench/` skeleton (part of D) |
| A | Agentic read-only swarm | **done, validated in real E2B** |
| B | Self-diagnosing repair loop | **B1–B5 done** incl. probe promotion, flake re-run and auto-commit |
| C | Coverage, multi-language adapters, product surface | **pending** (auto-commit settings shipped in B5) |
| D | Eval harness + competitive benchmark | **pending** (skeleton not created) |
| E | Ops hardening | **pending** |

Gates at the time of writing (all green):

```
cd cortardobot && npm run verify:v3   # typecheck + 71/71 v3 tests
cd cortardobot && npm test            # legacy 2.0 suites 1048/1048
npx tsc --noEmit && npm test          # root: tsc clean + 39/39 server/publisher tests
```

Zero-spend E2B validation (2026-09-15, PR6, scripted models): **PASS** — 3 confirmed /
3 fixed / 3 verified in 182.3s through the new sandbox-before-swarm path.

## Phase A — agentic swarm (done)

| Area | 3.1 | 3.2 |
| --- | --- | --- |
| Investigators | 4 single-shot diff-only calls, returned 0 hypotheses live with no telemetry | read-only tool loop per investigator (`swarm-agent.ts`), up to `maxSwarmTurns`, forced final answer turn |
| Tools | none | `read_file`, `list_dir`, `find_files`, `search_code`, `get_symbols`, `find_references`, `get_tests_for`, `read_test`, `git_diff`; mutation/probe/exec tools rejected before execution |
| Context | diff only | shared repo pack (`buildSwarmContext`): changed files numbered, compact diff, tests, routes, symbols, instructions |
| Sandbox | swarm raced the sandbox install | prepare/install completes before the swarm |
| Fallback | — | no sandbox/pack → 3.1 single-shot prompts (`mode:"single-shot"`) |
| Telemetry | none | `SwarmReport` per run (agent status/turns/tools/hypotheses/candidates/duration + capped transcripts); `swarm_agent`/`swarm_detail` events; persisted in `review_runs.stats.swarm` |
| Cache | `Candidate[]` | `{candidates, report}` under `swarm` key (old array shape still readable); repo pack under `swarm_context`; empty/failed swarms are **not** cached |
| Budgets | `swarmMs` | + `maxSwarmTurns` (3), `maxSwarmToolsPerTurn` (3), `maxCostUsd` enforced in `ModelRouter` |

Key files: `src/v3/swarm-agent.ts` (new), `src/v3/swarm.ts`, `src/v3/agent/context-pack.ts`,
`src/v3/engine.ts`, `tests/v3/swarm-agent.test.ts`, `tests/v3/engine.test.ts`.

## Phase B — self-diagnosing repair loop

### B1 typed failure reports (done)
- `FailureReport {category, summary, evidence, attemptedDiff, files, nextStrategy}` in `types.ts`.
- `classifyFailure()` (deterministic) + `diagnoseFailure()` in `agent/loop.ts`: one Terra
  `diagnosis` call for semantic failures (`reproduction_still_confirms`, `harness_error`,
  `no_edit`) while attempts remain; deterministic categories otherwise (no wasted calls).
- `RepairAttempt.failure` + `.diagnosis` populated; `renderFailureReport()` injects the
  failed diff + evidence + required next strategy into the next attempt prompt.

### B2 cross-finding strategy memory (done)
- `RepairRunMemory` (`blockedEdits`, `notes`) created once per `repairFindings` run and passed
  to every `runRepairAgent`; failed edit hashes are blocked across findings and diagnosis
  lessons are rendered as "Lessons from other repair attempts in this run".
- Files: `agent/loop.ts`, `agent/prompts.ts`, `repair.ts`.

### B3 sandbox truth (done)
- Every attempt snapshots **all** paths it edits and restores them on failure.
- Partial multi-file `apply_edit` rolls back inside `agent/tools.ts`.
- Probes run with `profile.testSingle` (repo runner) instead of hardcoded vitest.
- **Done (3.2.1):** the last pre-fix failing probe is promoted into an `authored_probe`
  verification step and included in the review evidence (see B3/B4 leftovers below).

### B4 batched verification (done)
- `verify.ts` batches: one app boot for all browser proofs (`proveMany`), one typecheck, one
  build, one run per unique targeted-test command.
- Baseline + affected tests: the engine captures a **baseline full test-suite run** on the
  pristine head at setup (`baselineTests`, budget `baselineMs`, `CORTADO_BASELINE_MS=0` disables).
  Verification adds an `affected_tests` step: runs the full suite once after fixes when the
  baseline was green; skips honestly when the baseline was red / missing / the change is tiny.
- Failed commands are re-run once (flakes labelled); **left:** per-repo (not just
  size-based) gating of the full suite for large monorepos.

### B5 learnings + auto-commit (done, 3.2.1)
- `ReviewRequest.learnings` is read from `repository.settings.learnings` in `runner.ts`,
  normalized in the engine (`util.ts:normalizeLearnings`) and injected into the swarm
  context pack, repair packs, the judge prompt and the Astra prompt. Learnings and
  instructions are hashed into the swarm/judge/repair/final-review cache keys, so settings
  changes can never serve stale context.
- `server/lib/review/autocommit.ts` commits only `isVerifiedFix()` findings in one atomic
  git-data commit on the PR branch: `contents:write` gate, max N per run (default 3),
  head-SHA re-check, deny-list for lockfiles/tests/workflows/env/vendored paths, per-run
  idempotency trailer (`Cortado-Autocommit: <runId>`), and an auto-commit note appended to
  the check run. Gated by `repository.settings.autoCommitFixes` (default off).
- Repo settings UI (`client/src/components/review/RepositoryReviewSettings.tsx`) exposes
  the auto-commit toggle, max fixes per run and a learnings editor; `PATCH
  /api/repositories/:id` merges settings instead of replacing the jsonb blob.

### B3/B4 leftovers (done, 3.2.1)
- Model-authored probes are captured with their exact content and command; the last pre-fix
  failing probe of the verified attempt is re-materialized and run as an `authored_probe`
  verification step, failing verification if it fails after the fix.
- Failed targeted/affected/probe commands are re-run once; only a stable failure is a
  regression, and flaky runs are labelled in the step reason.
- P0 fixed: `HttpModelClient` falls back from `max_tokens` to `max_completion_tokens` once
  per client (`models.ts`), so `final_review` no longer silently drops to the deterministic
  review on `gpt-6-astra`.
- Leftovers: `CORTADO_SWARM_MODE=agentic|single-shot` override implemented; previous bot
  reviews are only dismissed when `APPROVED`/`CHANGES_REQUESTED` (COMMENTED reviews can no
  longer 422); the review footer reports the engine version and swarm telemetry.

## Remaining work (ordered)

1. **Phase C — language adapters.** New `src/v3/languages/` with a `LanguageAdapter`
   contract (detect, detectors, symbols, resolveImport, affectedTests, testSingle, proofKind,
   repairRules). Generalize `RepoProfile` beyond npm (pip/poetry/uv, go.mod, Maven/Gradle,
   bundler, composer, nuget). Tiers: T1 TS/JS deep (done) → T2 Python, Go → T3 Java, Ruby,
   PHP, C#, Rust (detector + test-proof + repair, no browser).
2. **Phase C — detector packs:** secrets, dependency/CVE-lite, API contract/breaking changes,
   test-gap, config/migrations; each with dry fixtures and false-positive gates.
3. **Phase C — product surface:** PR walkthrough summary, file-level notes, `@cortado`
   commands (`fix`, `rerun`, `ignore`), learnings capture from replies, wire the deferred
   model picker (`client/src/components/PromptInput.tsx`).
4. **Phase D — `bench/`:** corpus ≥ 20 PRs across T1–T3 with oracle labels; scorer
   (precision/recall/F1, FP/PR, confirmed-fix rate, verified-fix correctness, regression-free
   rate, p50/p95 latency, model $ + E2B seconds/PR); `bench:offline` vs spend-gated
   `bench:live`; CI thresholds; run CodeRabbit/Greptile on the same corpus and score with the
   same oracle; publish `docs/cortardo-3.2-bench.md`. Blocked on a labelled corpus (none yet)
   and competitor access; build the offline corpus/scorer skeleton when starting.
5. **Phase E — ops:** E2B warm snapshots/pool + dependency cache, parallel proof/verify,
   per-repo concurrency + cancellation, model-outage degradation, cost dashboards,
   replay-from-cache, leak/restart tests.

## Where things live

```
cortardobot/src/v3/
  swarm.ts            orchestrator: agents, single-shot fallback, summary
  swarm-agent.ts      read-only investigator loop, evidence mapping, report
  agent/context-pack.ts  candidate packs + buildSwarmContext/renderSwarmContext
  agent/loop.ts       repair agent, failure classification, diagnosis, run memory
  agent/prompts.ts    repair + diagnosis + failure-report rendering
  agent/tools.ts      toolbelt (read-only guard lives in swarm-agent)
  repair.ts           per-finding repair, cache, per-run memory, probe capture
  verify.ts           batched, baseline-aware, flake-tolerant verification
  proof.ts            two-run browser confirmation / targeted tests
  engine.ts           ordering (sandbox → swarm context → swarm → merge → judge → proof →
                      repair → verify → astra), caches, telemetry, budgets
  models.ts           HTTP client (max_tokens → max_completion_tokens fallback), ModelRouter + cost cap
  config.ts           budgets/env (incl. CORTADO_SWARM_MODE), resolveV3Config
  version.ts          3.2.1 (bump on behaviour changes to invalidate caches)
  types.ts            FailureReport, AuthoredProbe, SwarmMode, SwarmReport, budgets, ReviewResult.swarm
server/lib/review/
  runner.ts           webhook → engine, persists stats (including swarm + autoCommit), publishing
  publisher.ts        honest state → review, inline suggestions, check run, swarm footer
  autocommit.ts       verified-fix commits (contents:write, deny-list, idempotent)
client/src/components/review/
  RepositoryReviewSettings.tsx  auto-commit toggle, max fixes, learnings editor
cortardobot/tests/v3/ swarm-agent.test.ts, engine.test.ts, repair.test.ts, verify.test.ts, learnings.test.ts, ...
docs/cortardo-3.2.md  this file
```

## Configuration

```
CORTADO_SWARM_MODE=auto        # auto | agentic | single-shot (forces the diff-only path)
CORTADO_SWARM_TURNS=3          # investigation turns per investigator
CORTADO_SWARM_TOOLS=3          # tool calls per investigator turn
CORTADO_MAX_COST_USD=0.25      # hard per-run provider-spend ceiling (0 disables)
CORTADO_BASELINE_MS=180000     # baseline full test-suite budget (0 disables)
CORTADO_MAX_TOKENS_* / CORTADO_AGENT_* / CORTADO_MODEL_* / cache envs unchanged
```

The `3.2.1` version bump invalidates every cache layer automatically; any behaviour change
must bump `ENGINE_VERSION`/`PROMPT_VERSION`/`TOOL_VERSION` in `src/v3/version.ts`.

Repository settings (`repositories.settings` jsonb) now carry `autoCommitFixes` (bool, default
off), `autoCommitMaxFindings` (1–10, default 3) and `learnings` (string[]).

## Gates and validation

```bash
# deterministic (no network, no spend) — must stay green at every step
cd cortardobot && npm run verify:v3
cd cortardobot && npm test
cd .. && npx tsc --noEmit && npm test

# zero-spend E2B validation (real sandbox/browser, scripted models)
GITHUB_TOKEN=... E2B_API_KEY=... \
  node --import tsx scripts/live/e2b-scripted.ts --input .tmp-e2e/pr6-input.json --installation-id <id>

# live PR6 run (real models; evidence: review_runs.stats + PR comments)
npx tsx .tmp/pr6-trigger.mts
```

Live-run checks after each phase: `review_runs.stats.swarm` has agent counts and hypotheses >
0 for a PR with real defects; `review_runs.stats.autoCommit` lists committed/skipped findings
when enabled; `$` spend stays under cap; the published review (with swarm footer) and check run
still reflect `isVerifiedFix()` only.

## Risks / open questions

- Real E2B verification raises latency; batching lands now, parallelism lands in E.
- Multi-language breadth is the biggest scope risk; the adapter tiers keep T3 to
  detector + test-proof + repair only.
- The bench spend must be enforced by the engine (`maxCostUsd`), not the harness.
- Bench thresholds (recall, FP rate, verified-fix correctness) still need sign-off before D.
- Pre-existing unrelated WIP remains uncommitted by design (client review-workspace
  redesign, `shared/schema.ts` app changes, `.tmp-e2e` scratch); do not fold it into 3.2
  engine commits — `git status` shows engine/server commits already landed.
