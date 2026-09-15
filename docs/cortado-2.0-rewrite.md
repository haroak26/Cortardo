# Cortado 2.0 — Ground-Up Rewrite Report

Status: **production path live** · final E2E on PR #6 (haroak26/Artificial-Gateway) passed:
**3 confirmed · 3 fixed · 3 verified** via a real browser proof, in 233.5s for $0.108.

Baseline commit: `1c80e5e` · Engine: `cortardobot/src/v3/` · Integration: `server/lib/review/`

---

## 1. Executive summary

The previous Cortado bot did not autonomously fix or verify anything:

- the last recorded E2E ran offline against 3 seeded files with no repository, no dependencies and no tests;
- its "proof" was a `grep` and its repair prompts truncated files to 3,000 chars, so Terra never saw the defect and all 3 patches failed to apply;
- the GitHub webhook only upserted a PR row; nothing ever triggered a review run or posted results.

The rewrite makes the loop real: **investigate → prove by execution → repair → verify**, with every
claim anchored to diff lines and every funded claim settled by running the code.

On the live E2E, the engine reproduced all three planted defects in a real Chromium session
(capturing the React stack trace for the crash), repaired each at the root cause (one required a
retry after a failed apply, proving the diagnose-and-retry path), and verified the fixes with
reproduction + typecheck + build.

---

## 2. Architecture

### 2.1 Module map (new)

```
cortardobot/src/v3/
  engine.ts          orchestrator: typed stages, budgets, events, AbortSignal, cleanup
  config.ts          model/sandbox defaults, stage budgets, bot gateway key priority
  types.ts           domain contracts (ReviewRequest, Candidate, ProofResult, RepairResult, ...)
  patch.ts           git + bare-hunk unified diff parser, line-accurate edit locator
  intelligence.ts    changed files, symbols, routes, pages, risk signals, classification, size
  detectors.ts       always-on deterministic detectors (crash, index-filter, nav regression, ...)
  swarm.ts           Luna investigators, full hunk context, per-agent budgets, partial results
  merge.ts           deterministic dedupe/merge/score against detectors
  judge.ts           Terra judge (constrained verdicts) + forced PROVE for deterministic findings
  proof.ts           engine-built proof plans: browser batch, targeted tests, status evaluation
  repair.ts          exact find/replace edits, apply, re-prove, diagnose, retry, deterministic fallback
  verify.ts          reproduction → targeted tests → typecheck → build (adaptive)
  astra.ts           final independent review (1 call, truncating schemas)
  result.ts          findings/markdown/summary assembly
  sandbox.ts         Sandbox interface + Playwright check script
  sandbox-e2b.ts     E2B adapter: clone, install, profile, applyEdits, startApp, browser checks
  sandbox-memory.ts  deterministic in-memory sandbox for tests
  safety.ts          patch policy (CI, .env, lockfiles, test weakening, destructive SQL)
  models.ts          OpenAI-compatible client (retries, JSON mode, timeout, usage/cost)
  util.ts            logger, withTimeout, mapLimit, JSON extraction, stable ids

server/lib/review/
  runner.ts          queue, run lifecycle, webhook→engine invocation, persistence
  publisher.ts       GitHub review body, inline comments, verified-fix suggestions, check run

server/lib/github/webhooks.ts   pull_request trigger + issue_comment @mention trigger
server/routes/github.ts         /api/runs, /api/runs/:id/attempts, /api/repositories/:id/runs, findings
shared/schema.ts                reviewRuns + reviewFindings tables
cortardobot/package.json        + e2b SDK
```

### 2.2 Pipeline

```
PR → change intelligence (no LLM)
   → deterministic detectors (always on, model-free)
   → sandbox setup (E2B clone + install, in parallel with swarm)
   → swarm (Luna, 3–4 focused agents, full hunks + real line numbers)
   → evidence merge (dedupe with detectors)
   → Terra judge (PROVE / STATIC_ONLY / DISCARD; deterministic findings force-proved)
   → proof (engine-built: real browser batch / tests)
   → repair loop (Terra exact edits → apply → re-prove → diagnose → retry)
   → verification (reproduction, targeted tests, typecheck, build)
   → Astra final review
   → publish (GitHub review + inline suggestions + check run) + persist
```

Design rules enforced by the engine, not the prompts:

- judge outputs verdicts only; **the engine builds and validates proof commands**, so a `grep` can never be "proof";
- file context is never truncated to the head of the file — repair gets the full file with line numbers;
- failed applies are diagnosed and the next attempt must change strategy (attempt 2 falls back to the engine-derived exact edit);
- verification runs regardless of whether repair is reported VERIFIED.

---

## 3. E2E on PR #6 — results

Target: `haroak26/Artificial-Gateway` PR #6 "New pricing page", head `0b19da07`, `new-pricing-page`,
3 files, +340/−114. Trigger path: signed GitHub webhooks delivered to the local server
(`POST /api/webhooks/github`) — no offline JSON, no manual cloning.

### 3.1 Run 1 — `c7834d12`

| Result | Value |
| --- | --- |
| Status | done (131s) |
| Findings | 3 confirmed · 0 fixed · 0 verified |
| Review | posted (failed to fix) |
| Models | Luna hit the depleted shared gateway key (402), repairs never read files |

Two defects were exposed and fixed:

1. **E2B path bug** — `read()` used repo-relative paths, so the repair loop bailed in 0ms with
   "could not read". Fixed with path resolution against the sandbox root.
2. **Wrong gateway key** — the engine preferred the shared `MERGE_GATEWAY_API_KEY` which had run
   out of credits. Priority is now `CORTADO_AI_API_KEY → CORTARDO_BOT_MERGE_API_KEY → MERGE_GATEWAY_API_KEY`.

### 3.2 Run 2 — final, successful

| Result | Value |
| --- | --- |
| Run id | `54003362-bbc2-4a87-8e23-2b2d93edb02d` |
| Trigger | `issue_comment` mention (`@cortardobot review`), after the `pull_request` webhook was correctly deduped |
| Status | done · 3 confirmed · **3 fixed · 3 verified** |
| Duration | 233.5s (236s end-to-end) |
| Usage | 9 calls — Luna 4, Terra 4, Astra 1 · 31,311 in / 4,014 out · $0.1081 |
| Review | `5203486684` with 3 inline comments (verified-fix suggestion on `Docs.tsx`, findings on the others) |
| Check run | `Cortado` = completed/success, "3 issue(s) fixed and verified" |
| Persistence | 3 findings `status=fixed`, `fix.verified=true`, patches stored |

Findings produced (all with real browser reproductions):

| Severity | Location | Result |
| --- | --- | --- |
| CRITICAL | `client/src/pages/Docs.tsx:311-312` — `undefinedValue.property.nested.value` throws on render | reproduced `TypeError` with React stack trace, fixed, verified |
| HIGH | `client/src/pages/Pricing.tsx:179` — `.filter((_, i) => i !== 1)` removes the featured "Max" tier | reproduced (missing "Most Popular"), fixed, verified |
| HIGH | `client/src/pages/Auth.tsx:85` — sign-up button navigates to `/` instead of `/auth/register` | reproduced in browser, fixed, verified |
| LOW | `client/src/pages/Auth.tsx:36` — gradient text missing `text-transparent` | static observation |

---

## 4. Defects found and fixed during the rewrite

| # | Symptom | Root cause | Fix | Validated by |
| --- | --- | --- | --- | --- |
| 1 | Bare GitHub patches parsed as empty diffs | parser required `--- a/` `+++ b/` headers | new parser accepts bare `@@` hunks | detector replay on PR6 |
| 2 | `grep` accepted as proof | judge authored free-form commands | engine builds proof; browser/test strategies only | live E2E (browser proof) |
| 3 | Repair patches never applied | prompts truncated files to 3,000 chars | full numbered file + exact `find`/`replace` edits | live E2E repair |
| 4 | Repair skipped on E2B | relative paths passed to `files.read` | resolve paths against sandbox root | run 2 |
| 5 | Model calls failed (402) | depleted shared gateway key | dedicated `CORTARDO_BOT_MERGE_API_KEY` priority | run 2 |
| 6 | Playwright could not find Chromium | browser path not set | `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` | sandbox validation |
| 7 | Case-sensitive text assertions failed on uppercase CSS | `innerText` respects `text-transform` | case-insensitive contains | sandbox validation |
| 8 | Swarm stage discarded completed agents | whole-stage timeout | self-bounded swarm with per-agent timeouts and partial results | dry replay (post-run) |
| 9 | Astra review discarded | summary > 700 chars rejected whole JSON | truncating schema | dry replay (post-run) |
| 10 | Verified fixes rendered no suggestion blocks | line matcher failed on trailing-newline edits | `locateEdit` offset-based locator | dry replay (post-run) |

Also hardened: deterministic detectors force-PROVE when they carry an executable check; verification
runs reproduction + typecheck + build; check runs are best-effort if permissions are missing.

---

## 5. Models and cost

| Role | Model | Used for |
| --- | --- | --- |
| Luna | `zai/glm-5.3` | parallel investigators (bounded, partial results) |
| Terra | `anthropic/claude-sonnet-5` | judge, repair edits, diagnosis |
| Astra | `anthropic/claude-opus-5` | final independent review |

Final run: $0.108 (108.066 credits), 9 calls, 35,325 tokens total. Every model call,
token and cost is persisted on `review_runs` (`stats.usage`, `tokens_in/out`, `credits_settled`).

---

## 6. Validation performed

- **E2B sandbox validation** (real PR6 checkout): clone 3s, `npm ci` 12–13s; baseline browser
  batch reproduced 3/3 defects; after deterministic patches, 3/3 checks passed.
- **Repair loop validation** (real E2B, scripted model): Docs attempt 1 failed to apply →
  diagnosed → attempt 2 applied → VERIFIED (2 attempts); Pricing/Auth VERIFIED on attempt 1;
  verification passed reproduction + typecheck + build.
- **Dry replay of PR6** through the full engine with scripted models: 3/3 confirmed by browser
  proof, 3/3 fixed, 3/3 verified; asserts trailing-newline patch rendering and Astra truncation.
- **Test suites**: `cortardobot` 1048/1048 passing; server tests 25/25 passing; strict TypeScript
  clean in both the root project and `cortardobot`.

Note: the swarm-budget, Astra-truncation and suggestion fixes landed after the final live E2E
(the 2-run budget was exhausted) and are covered by deterministic tests only.

---

## 7. How to run

### Environment

```
CORTARDO_BOT_MERGE_API_KEY=...        # preferred bot gateway key
E2B_API_KEY=...                       # sandbox
GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET
DATABASE_URL=...
```

Sandbox template: `cortardo-review-v1` (Node 22, git, npm, Playwright + Chromium).

### Server + triggers

```bash
npm run dev                                   # server on :5000, loads the review runner
# triggers:
#   pull_request opened/synchronize/reopened  -> automatic run (deduped by head SHA)
#   issue_comment "@cortardobot review"       -> on-demand run
#   POST /api/repositories/:id/runs           -> manual run from the app
```

### E2E harness (live, signed webhooks)

```bash
node --import tsx .tmp/e2e-pr6-live.mts
```

Sends a `pull_request` webhook (verifies head-SHA dedupe), then an `@cortardobot` mention
webhook, waits for the run, and prints findings, review, inline comments and check run.

### Offline validations (no gateway spend)

```bash
cd cortardobot
node --import tsx .tmp-e2e/v3-detectors.ts        # detector coverage on PR6
node --import tsx .tmp-e2e/v3-engine-dry.ts       # full engine with scripted models
node --import tsx .tmp-e2e/v3-sandbox-validate.ts # E2B clone/install/boot/browser/fix
node --import tsx .tmp-e2e/v3-repair-live.ts      # repair retry loop on real E2B
```

---

## 8. Files added / changed

Added:

- `cortardobot/src/v3/` (all engine modules listed in §2.1)
- `server/lib/review/runner.ts`, `server/lib/review/publisher.ts`
- `cortardobot/.tmp-e2e/v3-*.ts` validation harnesses

Changed:

- `server/lib/github/webhooks.ts` — `triggerReview` dependency, `issue_comment` mention handling, suspension/review-enabled checks
- `server/routes/github.ts` — review-run and findings APIs, webhook wiring
- `shared/schema.ts` — `review_runs`, `review_findings`
- `cortardobot/package.json` — `e2b` dependency

---

## 9. Known limitations / next steps

- The legacy v2 engine remains for the existing 1,048-test suite; the server and E2E use v3 exclusively.
- The final live run still used detectors as the primary source of findings because Luna's agents
  were cut off by the old stage budget; the post-run fix lets partial swarm results survive.
  A future E2E should show Luna hypotheses reaching the review.
- `contents: read` on the GitHub App means verified fixes are posted as suggestions only;
  auto-commit requires `contents: write` and the `settings.autoCommitFixes` flag.
- Reviews are posted as a new review per run; update-in-place by marker/head SHA is the next
  idempotency step.
- Bot rules/learnings tables and the remaining app-side APIs are not yet rebuilt; the client
  currently reads runs/findings from the new endpoints.
- A third live E2E is recommended after the swarm/Astra/publisher fixes to confirm full-strength
  LLM investigation end-to-end.
