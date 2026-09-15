# CortardoBot 3.1 — Live E2E Report

Status: **passed** — one live run on `haroak26/Artificial-Gateway` PR #6, no cleanup, existing comments preserved.
Date: 2026-09-15 · Engine: `3.1.0` · Run: `342c3c43-b188-43ed-89c9-8826707fbc79` · Review: `5208651577`

## 1. Target and trigger

- PR #6 "New pricing page", head `0b19da0708af5fa9fd437c0191c4fdeff668991a`, base `main`, branch `new-pricing-page`, 3 files, +340/−114.
- Signed `pull_request` `synchronize` webhook → `POST /api/webhooks/github` (HTTP 202), processed by the dev server on `:5000`.
- Exactly one run. No cleanup script, no review-body rewrites, no comment deletion.
- Models: `openai/gpt-5.6-luna` (medium), `openai/gpt-5.6-terra` (high), `openai/gpt-6-astra` (high).

## 2. Pre-run fix

The gateway lists the 3.1 models without the vendor prefix (`gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-6-astra`) but accepts both forms on completions. `preflightModels` compared ids exactly and aborted the run before any work. Fixed by matching on bare ids when the exact id is absent (`cortardobot/src/v3/models.ts`), with two new tests in `cortardobot/tests/v3/models.test.ts`.

Gate after the fix: `verify:v3` typecheck + **42/42** tests, root `tsc` clean, root `npm test` **30/30**.

## 3. Zero-spend validation (ladder step 3)

`scripts/live/e2b-scripted.ts` against PR6: real E2B clone/install, real Chromium proof, scripted repair — **3 confirmed / 3 fixed / 3 verified** in 175.8s, `PASS`. No gateway spend, no GitHub writes.

## 4. Live result

| Result | Value |
| --- | --- |
| Status | done · **3 confirmed · 3 fixed and verified** |
| Duration | 234.4s |
| Usage | 9 calls — Luna 4, Terra 4, Astra 1 · 53,449 in / 3,049 out · **$0.0766** |
| Cache | 0 hit / 12 miss (cold), not degraded |
| Check run | `104342739283` "Cortado" = completed/**success**, "3 issue(s) fixed and verified" |
| Review | `5208651577` (COMMENTED) + 3 verified-fix suggestions |

Stage timings: proof 108.4s · verify 67.3s · repair 38.8s · swarm 11.3s · judge 4.3s · sandbox setup 2.0s · final review 0.9s · preflight 0.27s.

Findings:

| Severity | Location | Result |
| --- | --- | --- |
| CRITICAL | `client/src/pages/Docs.tsx:312` — `undefinedValue.property.nested.value` throws during render | reproduced (browser `TypeError`), VERIFIED_FIX, 1 attempt, 299-byte patch |
| HIGH | `client/src/pages/Pricing.tsx:179` — `.filter((_, i) => i !== 1)` removes the featured "Max" tier | VERIFIED_FIX, 1 attempt, 205-byte patch |
| HIGH | `client/src/pages/Auth.tsx:85` — sign-up navigates to `/` instead of `/auth/register` | VERIFIED_FIX, 1 attempt, 194-byte patch |
| LOW | `client/src/pages/Auth.tsx:36` — gradient text missing `text-transparent` | static observation only |

Inline suggestions: `4014537876` (Docs.tsx:315), `4014537889` (Pricing.tsx:179), `4014537900` (Auth.tsx:85).

Comment preservation (before → after): reviews 16 → 17, review comments 7 → 10, issue comments 0 → 0. No comment was deleted. The 3.1 idempotency rule dismissed the previous same-head review `5203408742`; review `5203486684` could not be dismissed (GitHub rejects dismissing commented reviews) and remains `COMMENTED` with its comments intact.

## 5. Gaps observed

- **Astra call failed** — `gpt-6-astra` rejects `max_tokens` (`Unsupported parameter … use max_completion_tokens`), so `final_review` fell back to the deterministic review. The run completed and published honestly, but the Astra LLM review did not run. Fix: switch to `max_completion_tokens` with the same automatic fallback the client already uses for JSON mode/reasoning.
- **Luna swarm returned 0 hypotheses** on all 4 investigators (no error logged). The deterministic detectors force-PROVE carried confirmation, as in the PR6 golden replay, but full-strength LLM investigation is still not demonstrated live.
- `dismissPreviousBotReviews` cannot dismiss `COMMENTED` reviews (GitHub 422), so same-head commented reviews accumulate as historical duplicates.

## 6. Reproduce

```bash
cd cortardobot
npm run verify:v3

GITHUB_TOKEN=... E2B_API_KEY=... \
  node --import tsx scripts/live/e2b-scripted.ts --input .tmp-e2e/pr6-input.json --installation-id <id>

# one live run via the server on :5000
npx tsx .tmp/pr6-trigger.mts
```

Snapshot of the PR comments before/after is in `.tmp-e2e/pr6-existing.json`.
