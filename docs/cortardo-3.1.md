# CortardoBot 3.1 — Autonomous Review Engine

Status: **live E2E on PR6 passed** (2026-09-15 · run `342c3c43` · 3 confirmed / 3 fixed / 3 verified · $0.0766) — see [`cortardo-3.1-e2e-report.md`](./cortardo-3.1-e2e-report.md).
Engine: `cortardobot/src/v3/` · Integration: `server/lib/review/` · Engine version: `3.1.0`.

## What changed vs 3.0

| Area | 3.0 | 3.1 |
| --- | --- | --- |
| Models | `zai/glm-5.3`, `anthropic/claude-*` defaults, silently used when env absent | GPT defaults locked: `openai/gpt-5.6-luna`, `openai/gpt-5.6-terra`, `openai/gpt-6-astra`; preflight validates availability, fails loudly; ids persisted and published |
| Repair | one-shot JSON find/replace, static retry | **agent loop with a toolbelt**, context pack, adaptive 2 attempts + deterministic fallback, self-authored probes |
| Verification | `likely` counted as a pass; no patch invariant | only `disproven` passes; patch hunks required; two-run browser confirmation; harness errors are never defect signals |
| Publishing | stale patches possible, pre-fix failure shown under "fixed", stacked reviews | single `isVerifiedFix()` truth; suggestions only for clean, in-diff ranges; post-fix evidence shown; previous review for the same head dismissed |
| Caching | none | versioned multi-layer cache (run, context pack, swarm, judge, proof, repair, final review, within-run, provider prompt caching, sandbox deps) with credits-saved reporting |
| Runner | in-memory queue, no global timeout, no recovery | DB lease + heartbeat, stale-run recovery on boot, global budget enforced, idempotent per head SHA |
| Tests | 3.0 v3 had zero automated tests | 40 deterministic 3.1 tests + PR6 golden replay + publisher goldens; `npm run verify:v3` gate |

## Architecture

```
PR → change intelligence (no LLM)
   → deterministic detectors (always on)
   → context pack (codegraph-lite: imports, symbols, tests, routes, hashes)   [cached]
   → swarm — Luna investigators                                              [cached]
   → merge → judge — Terra (constrained verdicts, detector force-PROVE)      [cached]
   → proof — engine-built browser batch (two-run confirmation) / targeted tests [cached]
   → repair — Terra agent: tools → edit → self-test → adapt (2 attempts) → deterministic fallback
   → verification — reproduction ×2, touched-file tests, typecheck, build
   → Astra final review                                                      [cached]
   → publisher — honest state, suggestions, idempotent review, check run
```

### Agent toolbelt (executed in E2B, fully transcribed)

`read_file`, `list_dir`, `find_files`, `search_code`, `get_symbols`, `find_references`,
`get_tests_for`, `read_test`, `run_test_file`, `run_typecheck`, `run_build`,
`apply_edit` (dry-run count + postcondition + no-op rejection), `git_diff`,
`write_probe` / `run_probe` (self-testing; probes are temporary and removed after each attempt),
`run_reproduction` (authoritative two-run check), `finish`.

Protocol is JSON per turn (`actions: [{tool, args}]`), works with any OpenAI-compatible
gateway, and every turn is one model call. Attempts: 2 model-driven + 1 deterministic
fallback; failed edit hashes are blocked so the model cannot repeat a failed strategy.

## The honest result contract

| State | Published as |
| --- | --- |
| `VERIFIED_FIX` | suggestion (only when patch hunks exist and the range is in the diff) + post-fix verification evidence |
| `UNRESOLVED` | "reproduced, fix unresolved" + blocker; review requests changes; check not green |
| `UNSUPPORTED` | static observation only |
| `FAILED` | run error, no review, check red |

Enforced by one shared `isVerifiedFix()` used by result assembly, publisher, persistence and
the check run. No finding can be called fixed without: non-empty patch hunks, applied edit,
postcondition, reproduction disproven twice, touched-file tests, typecheck (and build for
complex changes).

## Caching

All keys are `sha256(schemaVersion | kind | engineVersion | promptVersion | toolVersion | model | repo | headSha | fileHashes | payload)`,
stored in `review_cache_entries` (Postgres) or `MemoryCacheStore` in tests.

- run idempotency: partial unique index on active `(repository_id, head_sha, engine_version)`
- context pack, swarm, judge, proof, final review: stage payloads + measured `costUsd` in meta
- repair: verified edits + patch; on a hit the model calls are skipped but the fix is
  re-applied and re-verified against the current file hash before anything is published
- within-run memoization + provider prompt caching (stable system prefix, deterministic ordering)
- reporting: per-stage hit/miss and credits saved appear in run stats and the review footer.

## Runner reliability

- DB-backed lease + heartbeat (`CORTADO_RUN_LEASE_MS`, `CORTADO_RUN_HEARTBEAT_MS`), stale-run
  recovery on boot (`recoverStaleReviewRuns`, also called lazily before the first enqueue).
- Global budget enforced (`CORTADO_GLOBAL_TIMEOUT_MS`); skipped stages mark the run degraded,
  and a degraded run can never produce a green check.
- Sandbox cleanup in `finally`; model preflight at boot for live runs.
- Repository/run model selection flows: repo settings or API body → engine request → run stats.

## Configuration

See `cortardobot/.env.example` for the full list. Model defaults:

```
CORTADO_MODEL_LUNA=openai/gpt-5.6-luna
CORTADO_MODEL_TERRA=openai/gpt-5.6-terra
CORTADO_MODEL_ASTRA=openai/gpt-6-astra
CORTADO_REASONING_LUNA=medium
CORTADO_REASONING_TERRA=high
CORTADO_REASONING_ASTRA=high
```

## Tests and gates

```bash
cd cortardobot
npm run test:v3      # 40 deterministic 3.1 tests (no network)
npm run verify:v3    # typecheck + 3.1 suites (deploy gate)
npm test             # legacy 2.0 suites (1048) still green
cd .. && npm test    # 30 server tests incl. publisher goldens
```

3.1 suites cover: model config/preflight/reasoning fallback/cost, cache keys + TTL/LRU,
patch locator (incl. the PR6 trailing-newline regression), `isVerifiedFix`/states,
verification truth table, two-run proof confirmation and flaky-pass detection, agent loop
(attempt-1 success, no-op rejection, duplicate-edit block, adaptive retry, deterministic
fallback, restore-on-failure, probe cleanup), repair cache re-verification, PR6 golden
replay (3 confirmed / 3 verified / 1 attempt each), zero-model-call cached replay, and
publisher goldens (suggestions only at valid diff ranges, honest unresolved output).

## Validation ladder

1. Deterministic suites — **done** (`verify:v3` green, 42/42 after the preflight prefix fix).
2. Local fixture + memory sandbox — **done** (PR6 golden replay).
3. E2B + scripted models, zero gateway spend — **done** (PR6: 3 confirmed / 3 fixed / 3 verified, 175.8s).
4. One live GPT run on a throwaway PR — **skipped**; the PR6 live run was requested directly.
5. Live PR6 run — **done** (2026-09-15): run `342c3c43-b188-43ed-89c9-8826707fbc79`, 3 confirmed / 3 fixed / 3 verified, 234.4s, 9 calls, $0.0766, check run success, review `5208651577`. Full report: [`cortardo-3.1-e2e-report.md`](./cortardo-3.1-e2e-report.md).

## Known gaps / next steps

- Live run gap: `gpt-6-astra` rejects `max_tokens` (needs `max_completion_tokens`), so the Astra
  final review fell back to the deterministic review. Send the supported parameter with the existing
  automatic fallback.
- Live run gap: the Luna swarm returned 0 hypotheses on all investigators; detectors force-PROVE
  carried the run. Addressed in 3.2 by the agentic read-only swarm with per-agent telemetry —
  see [`cortardo-3.2.md`](./cortardo-3.2.md).
- `dismissPreviousBotReviews` cannot dismiss `COMMENTED` reviews (GitHub 422), so historical
  same-head comments accumulate.
- Luna tool-use (read-only investigation round) is not enabled yet; the swarm prompt already
  receives the full diff and the merge/judge stages consume detector evidence. Scheduled next.
- The app-side model picker (`client/src/components/PromptInput.tsx`) is still not wired to
  the review trigger; `GET /api/models` and repo settings support are in place.
- `docs/cortado-2.0-rewrite.md` remains as the historical 2.0 report.
