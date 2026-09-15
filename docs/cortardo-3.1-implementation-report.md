# CortardoBot 3.1 — Implementation Report

Date: 2026-09-15 · Engine version: `3.1.0` · Status: **built and deterministic-verified locally. No E2E, no gateway calls, no commits.**

## What landed

### Models (locked GPT defaults)

- `shared/models.ts` catalog: Luna `openai/gpt-5.6-luna`, Terra `openai/gpt-5.6-terra`, Astra `openai/gpt-6-astra`; reasoning Luna medium / Terra high / Astra high.
- `resolveV3Config` defaults to GPT, honours `CORTADO_MODEL_*` (plus legacy `CORTARDO_*`), and `preflightModels` fails loudly on a missing model or bad key (warns if the gateway has no `/models` endpoint).
- Model ids are persisted in run stats and published in the review header.
- `GET /api/models` plus repo-settings/API model selection are wired.

### Agentic engine (`src/v3/agent/`)

- Repair is a tool-using loop: context pack (files, imports, symbols, tests, routes, hashes) + toolbelt (`read_file`, `search_code`, `find_references`, `run_test_file`, `run_typecheck`/`run_build`, `apply_edit` with no-op/postcondition checks, `write_probe`/`run_probe`, `run_reproduction`, `finish`).
- 2 model-driven attempts with real-failure diagnosis, failed-edit hashes blocked, file snapshot/restore, then the deterministic engine-derived fix.
- Every turn and tool call is transcribed as evidence; probes are cleaned up after each attempt.

### Truth invariants

- `verify.ts`: only `disproven` passes; `likely`/`error` are inconclusive, never verified.
- `repair.ts`: VERIFIED requires an applied edit + postcondition + non-empty real diff + reproduction passing.
- `patchHasHunks` and one shared `isVerifiedFix()` drive result assembly, publisher, persistence and the check run.
- Browser harness: polling/readiness waits, clickability, `harnessError` never counts as a defect signal, and a passing check is re-run (two-run confirmation).
- Publisher: suggestions only for clean, in-diff ranges; post-fix evidence shown; "no patch produced" instead of fake fixes; degraded runs cannot go green; previous bot review for the same head is dismissed (no more stacked reviews).

### Caching (`src/v3/cache/` + `review_cache_entries`)

- Versioned keys (engine/prompt/tool/model/file hashes).
- Layers: run idempotency, context pack, swarm, judge, proof, repair (re-applied and re-verified before publishing), final review, within-run memoization, prompt-cache-friendly prompts, credits-saved reporting.
- Repair hits skip model calls but re-verify the fix against current file content first.

### Runner

- DB lease + heartbeat, boot-time stale-run recovery, global budget enforced with a `degraded` state, sandbox cleanup in `finally`, per-repo/API model selection, instructions passed through.
- Migration `0018_review_cache_and_leases.sql` plus an idempotent runtime schema guard.

## Verification (all green)

| Check | Result |
| --- | --- |
| `cortardobot npm run verify:v3` | typecheck + **40/40** 3.1 tests |
| `cortardobot npm test` | **1048/1048** legacy suites |
| root `npm test` | **30/30** (including publisher goldens) |
| root + cortardobot `tsc` | clean |

Highlights:

- PR6 golden replay = 3 confirmed / 3 verified in **1 attempt each**, with real patch hunks.
- Identical re-run = **0 model calls** (cache), and repair cache hits are re-verified.
- No-op edits, duplicate edits, flaky passes, harness errors and unresolved defects all fail safe.

## Gated next steps (requires explicit go-ahead)

1. E2B scripted validation, zero gateway spend:

   ```bash
   GITHUB_TOKEN=... E2B_API_KEY=... \
     node --import tsx scripts/live/e2b-scripted.ts --input .tmp-e2e/pr6-input.json
   ```

2. One live GPT run on a throwaway PR (gateway spend) — step 4 of the ladder.
3. Live PR6 run — only after the step 4 artefacts have been reviewed and signed off.

## Known deferrals

- Luna read-only tool round (the swarm already receives the full diff and the judge consumes detector evidence). Scheduled next.
- Wiring the app-side model picker (`client/src/components/PromptInput.tsx`) to the new `/api/models` endpoint.

## References

- Full plan and configuration: [`docs/cortardo-3.1.md`](./cortardo-3.1.md)
- Environment reference: [`cortardobot/.env.example`](../cortardobot/.env.example)
- Historical 2.0 report: [`docs/cortado-2.0-rewrite.md`](./cortado-2.0-rewrite.md)

> Note: the four modified `client/*` files present in the working tree are pre-existing parallel work-in-progress and were left untouched.
