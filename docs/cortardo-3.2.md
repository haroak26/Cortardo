# CortardoBot 3.2 — Upgrade Plan, Status and Handoff

Engine version: `3.2.0` · Baseline: `3.1.0` (`docs/cortardo-3.1.md`) · Last updated: 2026-09-15
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
| B | Self-diagnosing repair loop | **B1, B2, B3, B4 done; B5 pending** |
| C | Coverage, multi-language adapters, product surface, auto-commit | **pending** |
| D | Eval harness + competitive benchmark | **pending** (skeleton not created) |
| E | Ops hardening | **pending** |

Gates at the time of writing (all green):

```
cd cortardobot && npm run verify:v3   # typecheck + 58/58 v3 tests
cd cortardobot && npm test            # legacy 2.0 suites 1048/1048
npx tsc --noEmit && npm test          # root: tsc clean + 30/30 server/publisher tests
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

### B3 sandbox truth (done, one item left)
- Every attempt snapshots **all** paths it edits and restores them on failure.
- Partial multi-file `apply_edit` rolls back inside `agent/tools.ts`.
- Probes run with `profile.testSingle` (repo runner) instead of hardcoded vitest.
- **Left:** promote a model-authored failing probe into first-class verification evidence
  (today probes are deleted after each attempt; the transcript still records them).

### B4 batched verification (done)
- `verify.ts` batches: one app boot for all browser proofs (`proveMany`), one typecheck, one
  build, one run per unique targeted-test command.
- Baseline + affected tests: the engine captures a **baseline full test-suite run** on the
  pristine head at setup (`baselineTests`, budget `baselineMs`, `CORTADO_BASELINE_MS=0` disables).
  Verification adds an `affected_tests` step: runs the full suite once after fixes when the
  baseline was green; skips honestly when the baseline was red / missing / the change is tiny.
- **Left:** flake re-run for intermittent failures; per-repo (not just size-based) gating of
  the full suite for large monorepos.

### B5 learnings + auto-commit (next)
- `ReviewRequest.learnings` (`types.ts`) is still unused and `runner.ts` hardcodes
  `learnings: []`, `autoCommitFixes: false`.
- Plan: read `learnings: string[]` + `autoCommitFixes` from repository settings; feed
  learnings into swarm context, repair packs and judge prompts; implement
  `server/lib/review/autocommit.ts` that commits **only** `isVerifiedFix()` findings through
  the GitHub commit API (signed bot identity, max-N per run, re-check head SHA moved, never
  lockfiles/tests/workflows, idempotent, records a check-run note).

## Remaining work (ordered)

1. **Astra `max_tokens` bug (P0, from the 3.1 live report).** `src/v3/models.ts` sends
   `max_tokens`; `gpt-6-astra` rejects it (`use max_completion_tokens`) so `final_review`
   falls back to the deterministic review. Add automatic fallback to `max_completion_tokens`
   (same pattern as the JSON-mode / reasoning fallbacks) and a test with a fake fetch.
2. **B5** learnings plumbing + opt-in auto-commit (see above).
3. **Probe promotion** (B3 leftover): keep the last model-authored failing probe per finding,
   run it as the first `targeted_tests` step (or an `authored_probe` step) post-fix, include it
   in the review evidence.
4. **Flake handling:** re-run a failed targeted/affected test once; only treat a stable
   failure as a verification failure (mirror the browser two-run confirmation).
5. **Phase C — language adapters.** New `src/v3/languages/` with a `LanguageAdapter`
   contract (detect, detectors, symbols, resolveImport, affectedTests, testSingle, proofKind,
   repairRules). Generalize `RepoProfile` beyond npm (pip/poetry/uv, go.mod, Maven/Gradle,
   bundler, composer, nuget). Tiers: T1 TS/JS deep (done) → T2 Python, Go → T3 Java, Ruby,
   PHP, C#, Rust (detector + test-proof + repair, no browser).
6. **Phase C — detector packs:** secrets, dependency/CVE-lite, API contract/breaking changes,
   test-gap, config/migrations; each with dry fixtures and false-positive gates.
7. **Phase C — product surface:** PR walkthrough summary, file-level notes, `@cortado`
   commands (`fix`, `rerun`, `ignore`), learnings capture from replies, wire the deferred
   model picker (`client/src/components/PromptInput.tsx`) + repo settings.
8. **Phase D — `bench/`:** corpus ≥ 20 PRs across T1–T3 with oracle labels; scorer
   (precision/recall/F1, FP/PR, confirmed-fix rate, verified-fix correctness, regression-free
   rate, p50/p95 latency, model $ + E2B seconds/PR); `bench:offline` vs spend-gated
   `bench:live`; CI thresholds; run CodeRabbit/Greptile on the same corpus and score with the
   same oracle; publish `docs/cortardo-3.2-bench.md`.
9. **Phase E — ops:** E2B warm snapshots/pool + dependency cache, parallel proof/verify,
   per-repo concurrency + cancellation, model-outage degradation, cost dashboards,
   replay-from-cache, leak/restart tests.
10. **Small leftovers:** implement/remove the documented-but-missing `CORTADO_SWARM_MODE`
    override; `dismissPreviousBotReviews` cannot dismiss `COMMENTED` reviews (GitHub 422);
    publisher footer does not yet surface swarm telemetry.

## Where things live

```
cortardobot/src/v3/
  swarm.ts            orchestrator: agents, single-shot fallback, summary
  swarm-agent.ts      read-only investigator loop, evidence mapping, report
  agent/context-pack.ts  candidate packs + buildSwarmContext/renderSwarmContext
  agent/loop.ts       repair agent, failure classification, diagnosis, run memory
  agent/prompts.ts    repair + diagnosis + failure-report rendering
  agent/tools.ts      toolbelt (read-only guard lives in swarm-agent)
  repair.ts           per-finding repair, cache, per-run memory
  verify.ts           batched, baseline-aware verification
  proof.ts            two-run browser confirmation / targeted tests
  engine.ts           ordering (sandbox → swarm context → swarm → merge → judge → proof →
                      repair → verify → astra), caches, telemetry, budgets
  models.ts           HTTP client (note the max_tokens fallback TODO), ModelRouter + cost cap
  config.ts           budgets/env, resolveV3Config
  version.ts          3.2.0 (bump on behaviour changes to invalidate caches)
  types.ts            FailureReport, SwarmReport, budgets, ReviewResult.swarm
server/lib/review/
  runner.ts           webhook → engine, persists stats (including swarm), publishing
  publisher.ts        honest state → review, inline suggestions, check run
  autocommit.ts       (to create) verified-fix commits
cortardobot/tests/v3/ swarm-agent.test.ts, engine.test.ts, repair.test.ts, verify.test.ts, ...
docs/cortardo-3.2.md  this file
```

## Configuration

```
CORTADO_SWARM_TURNS=3          # investigation turns per investigator
CORTADO_SWARM_TOOLS=3          # tool calls per investigator turn
CORTADO_MAX_COST_USD=0.25      # hard per-run provider-spend ceiling (0 disables)
CORTADO_BASELINE_MS=180000     # baseline full test-suite budget (0 disables)
CORTADO_MAX_TOKENS_* / CORTADO_AGENT_* / CORTADO_MODEL_* / cache envs unchanged
```

The `3.2.0` version bump invalidates every cache layer automatically; any behaviour change
must bump `ENGINE_VERSION`/`PROMPT_VERSION`/`TOOL_VERSION` in `src/v3/version.ts`.

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
0 for a PR with real defects; `$` spend stays under cap; the published review and check run
still reflect `isVerifiedFix()` only.

## Risks / open questions

- Real E2B verification raises latency; batching lands now, parallelism lands in E.
- Multi-language breadth is the biggest scope risk; the adapter tiers keep T3 to
  detector + test-proof + repair only.
- The bench spend must be enforced by the engine (`maxCostUsd`), not the harness.
- Bench thresholds (recall, FP rate, verified-fix correctness) still need sign-off before D.
- Pre-existing unrelated WIP exists in the working tree (client files, migrations); do not
  commit it with 3.2 engine changes.
