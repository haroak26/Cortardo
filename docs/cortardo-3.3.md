# CortardoBot 3.3 — Consistency, Reliability, Astra Codegen, Full Final Review

Engine version: `3.3.0` · Baseline: `3.2.2` (`docs/cortardo-3.2.md`) · Last updated: 2026-09-15
Goal: make the autonomous review engine **consistent and reliable end-to-end** — no silent
degradation, no lost or double runs, no unverifiable fixes — while moving code generation to
`gpt-6-astra` and turning the final review into a full, evidence-grounded PR-level report.

> **How to use this document:** "Remaining work" is ordered; a new session resumes from the
> first unchecked item using "Gates and validation". Nothing here is aspirational unless
> marked pending.

## Locked decisions

- **`codegen` role** (new, 4th): repair + diagnosis run on `openai/gpt-6-astra`. The final
  reviewer moves to a **different** model (`openai/gpt-5.6-sol` default) so the writer is never
  the reviewer.
- **Full PR-level final review**: overall verdict + confidence, summary, per-file walkthrough,
  risk register, test-coverage assessment, non-finding observations, limitations; rendered in
  the review body and check run; verdict drives review-event/check decisions behind guardrails.
- **Engine + server hardening**: all P0s and the high-value P1s from the 3.3 reliability audits.
- Invariants that must never relax: harness errors are never defect signals; `isVerifiedFix()`
  is the only definition of a fix; degraded runs can never produce a green check; stage
  timeouts are degradations, never successes.
- Deferred: language adapters, detector packs, bench/corpus (3.2 Phase C/D).

## Status snapshot

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Version bump, `codegen` role, reviewer swap, plumbing | **done** |
| 1 | Codegen quality: retrieval, guardrails, multi-file, learnings | **done** (persistent learnings + lint step deferred) |
| 2 | Full PR-level final review + verdict wiring | **done** |
| 3 | Engine reliability P0 (timeout honesty, abort, sandbox, repair integrity) | **done** |
| 4 | Engine reliability P1/P2 (budgets, cache, baseline, boundary, cleanups) | **done** (clock injection + stableId unification deferred) |
| 5 | Server reliability P0 (leases/CAS, recovery, outbox, publish state) | **done** |
| 6 | Server reliability P1/P2 (publisher, autocommit, concurrency, redaction) | **done** (cancellation endpoint + graceful drain deferred) |
| 7 | Validation gates, live checks, handoff | **done** — deterministic gates green, zero-spend PR6 E2E PASS, live-model PR6 run validated on GitHub |

## Phase 0 — roles and plumbing

- `ENGINE_VERSION` → `3.3.0`; prompt/tool/protocol versions bump with behaviour changes.
- `shared/models.ts`: `ModelRole = "luna" | "terra" | "codegen" | "astra"`.
  - `codegen` default `openai/gpt-6-astra`; `astra` (reviewer) default `openai/gpt-5.6-sol`.
  - `DEFAULT_REASONING.codegen = "high"`; env `CORTADO_MODEL_CODEGEN` /
    `CORTADO_REASONING_CODEGEN` (+ legacy `CORTARDO_MODEL_CODEGEN`).
- `ModelsConfig`/`HttpModelClient`/`ModelRouter`/`ModelTask`/`ModelSelection`/`usage.byRole`
  understand four roles; token cap `CORTADO_MAX_TOKENS_CODEGEN` (default 8000).
- Repair + diagnosis call `role: "codegen"`; the repair cache key uses `models.codegen`.
- Server: runner settings/stats and `/api/models` carry `codegen`; repository settings tolerate
  a missing `codegen` key (falls back to default).
- Tests: env precedence/defaults, codegen binding, cache invalidation.

## Phase 1 — codegen quality

- Context pack: references/call sites for changed symbols, covering tests, all evidence files
  for multi-file candidates, style grounding (prettier/eslint/editorconfig/tsconfig) + one
  nearby exemplar, size budget by PR size, instructions in the pack hash.
- Guardrails: max edited files/lines, no `@ts-ignore`/`as any`/new deps unless instructed,
  require an executed test/reproduction pass before accepting an attempt, add a lint/format
  verification step.
- Multi-file: per-file patches in `RepairResult`, targeted tests per edited file, per-file
  suggestions, autocommit/published-evidence consistency.
- Persistent learnings from verified fixes and diagnoses; quality telemetry (first-attempt
  verified rate, attempts/finding, regression-free rate).

## Phase 2 — full PR-level final review

- `FinalReviewReport` (+ `AstraReview` rationale/evidence refs): verdict, summary, walkthrough,
  risks, coverage, observations, limitations, confidence.
- Map-reduce `astra.ts`: per-finding deep reviews + PR synthesis; inputs include PR title/body,
  classification/size, compact diff, instructions, verification reasons/outputs, promoted
  probe, evidence ids.
- Honest degradation: timeout/failure → deterministic `fallbackReviews` for every finding and
  `degraded: true`; never `[]`.
- Rendering: verdict/walkthrough/risk/coverage/limitations at the top of the review body,
  confidence surfaced, ~60k body guard with truncation note, check-run `output.text`.
- Verdict wiring in `decideReviewEvent`/`decideCheckConclusion` with guardrails (never approve
  unverified high/critical; degraded never green; never contradict `runState`).

## Phase 3 — engine reliability P0

- `stage()` timeout fidelity: discriminated timeout → `timedOut` stage event + `markDegraded`,
  never a false `completed`.
- Cancellation: `AbortSignal` through stage → swarm/proof/repair/verify → sandbox exec/model
  calls; abort losers; abandoned failures logged; baseline awaited before repair mutates.
- Sandbox honesty: error proof results retained, degraded when unavailable; setup timeout is a
  failure; cleanup is bounded and reported; factory-failure cleanup.
- Repair tree integrity: restore applied edits on every non-success exit, assert the tree
  matches the emitted patch before `VERIFIED`, transactional `applyEdits`, cached-repair
  restore before fallback.
- Model client: fix infinite `finish_reason:"length"` recursion; bound capability fallback.

## Phase 4 — engine reliability P1/P2

- Budget truth: post-call cost enforcement, micro-dollar rounding, retry/fallback attempts
  counted, `Retry-After` honoured, deadline-aware retries, remaining budget passed into
  repair/verify.
- Cache correctness: reasoning/token params/`swarmMode`/profile commands/instructions in keys;
  cached payload validation; no partial context packs cached; review id-set equality.
- Baseline semantics `green|red|unavailable|timeout`; only red skips checks.
- Boundary: zod-decoded `ReviewRequest`, clamped budgets, shell-safe commands, token stripped
  from the git remote, secret redaction in logs/persisted errors.
- Cleanups: `stableStringify` shared refs, `stableId` unification, clock injection,
  `mergeCandidates` copy, guarded `extractJson`, coercion telemetry, E2B adapter fixes, v3
  tests in the default `npm test`.

## Phase 5 — server reliability P0

- Fenced run lifecycle: CAS claim/heartbeat/finish/fail (`lease_owner` + generation), visible
  heartbeat failures.
- Periodic recovery sweeper for stale `queued` and `running` rows; no zombie double-runs.
- Webhook outbox: durable run row before ACK; `processed` only after successful enqueue;
  reconciler for `received` deliveries.
- Publish state on the run (`publish_state`, attempts, error, review id); retry and allow
  re-enqueue for `done`-but-unpublished; check run finalized on every terminal path.
- Migration `0019`: run lease/publish columns + unique `review_findings(run_id, finding_key)`.

## Phase 6 — server reliability P1/P2

- Transactional findings/run/repo persistence; usage recorded on failure; credit hold/settle.
- Publisher: `commit_id` pinning, create-then-dismiss, duplicate suppression for `COMMENTED`,
  per-comment 422 handling, body size cap + truncation notice, classified retries.
- Manual-run dedupe on the resolved live head; per-repo advisory lock; bounded queue;
  cancellation; graceful drain.
- Autocommit deny-list expansion + secret scan; truncated-input honesty → `degradedReason`;
  secret redaction; deny-by-default authz; draft gating; cache pruning.

## Phase 7 — validation

- Gates per phase: `cd cortardobot && npm run verify:v3`, `npm test`, root
  `npx tsc --noEmit && npm test`.
- New tests: `tests/v3/util.test.ts`, `tests/v3/safety.test.ts`, `tests/v3/astra.test.ts`,
  stage-timeout/degraded honesty, sandbox-failure honesty, cached-repair restore, model
  length-recursion bound + abort signal, malformed-request boundary, cache payload validation;
  server tests for full-report rendering, verdict guardrails, body truncation, webhook enqueue
  failure reporting, autocommit deny-list/secret scan.
- Zero-spend scripted E2B + one live PR6 run (needs credentials): `codegen=openai/gpt-6-astra`,
  reviewer `openai/gpt-5.6-sol`, full report rendered, no false green, spend under cap.

## Implementation log (2026-09-15)

Deterministic gates at handoff:

```
cd cortardobot && npm run verify:v3   # typecheck + 95/95 v3 tests
cd cortardobot && npm test            # 1143/1143 (legacy + v3)
npx tsc --noEmit && npm test          # root: tsc clean + 48/48 server tests
```

Zero-spend E2B validation (2026-09-15, PR6, scripted models, real sandbox +
Chromium): **PASS** — 3 confirmed / 3 fixed / 3 verified in 153.8s, full
PR-level report model-authored (`report=model`, verdict `approve`), no degraded
stages, `codegen=openai/gpt-6-astra`, reviewer `openai/gpt-5.6-sol`. The
scripted path runs the engine + E2B only and never publishes to GitHub, so no
PR comment, review or check run is created, dismissed or deleted.

```
cd cortardobot && GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY=... E2B_API_KEY=... \
  node --import tsx scripts/live/e2b-scripted.ts --input .tmp-e2e/pr6-input.json --installation-id 161125043
```

Console outcome:

```
[2026-09-15T19:16:30Z] models: luna=openai/gpt-5.6-luna terra=openai/gpt-5.6-terra codegen=openai/gpt-6-astra astra=openai/gpt-5.6-sol
[e2b-scripted] status=completed duration=153.8s
[e2b-scripted] confirmed=3 fixed=3 verified=3
  - client/src/pages/Docs.tsx    proof=confirmed repair=VERIFIED patchHunks=true verification=true
  - client/src/pages/Pricing.tsx proof=confirmed repair=VERIFIED patchHunks=true verification=true
  - client/src/pages/Auth.tsx    proof=confirmed repair=VERIFIED patchHunks=true verification=true
[e2b-scripted] report=model verdict=approve degraded=false codegen=openai/gpt-6-astra reviewer=openai/gpt-5.6-sol
[e2b-scripted] PASS
```

Live-model validation (2026-09-15, PR6, full server path, real gateway + E2B):

- Run `fcd25ed2` (engine 3.3.0, `codegen=openai/gpt-6-astra`, reviewer `gpt-5.6-sol`):
  4 confirmed / 3 fixed+verified / 1 static observation, 19 model calls, **$0.5176**,
  277.3s, not degraded, report `source=model`, verdict `request_changes` (confidence 0.98)
  with walkthrough, 2 risks, coverage, 5 observations and 5 limitations.
- Run `adfa341` (same head + settings): full cache replay — 10 cache hits, **0 model calls,
  $0.00**, `creditsSavedUsd=0.5176`, same outcome.
- Published review `5215016936` (`CHANGES_REQUESTED`) with the full PR-level report; check run
  `Cortado` completed `neutral`; migration `0019` applied to the dev database beforehand.

Two live bugs were found by this run and fixed with regression tests:

1. **Self-dismissal (create-then-dismiss).** The fresh `CHANGES_REQUESTED` review matched
   `shouldDismissBotReview` for its own commit, so the publisher dismissed the review it had
   just created. `dismissPreviousBotReviews` now takes `excludeReviewId` (the created review)
   via `selectSupersededBotReviews`; run 2 logged no dismissal and the verdict stayed live.
2. **Lost publish bookkeeping.** The `publish_state` update was fenced on
   `lease_owner = PROCESS_ID`, but the completion CAS had already cleared the lease, so the
   update matched zero rows and `publish_state` stayed `pending/0`. The update is now keyed on
   the run id only (it is only reachable after the fenced completion).

**Version proof — the E2E ran 3.3, not 3.2:**

- `src/v3/version.ts` at run time: `ENGINE_VERSION = "3.3.0"`, `PROMPT_VERSION = "3.3.0"`.
- The script imports `../../src/v3/engine.ts` and is executed with `tsx` (no build step);
  the repo has no compiled `dist/` output, so the working tree is what executed.
- The run logged the 3.3-only model line `models: ... codegen=openai/gpt-6-astra
  astra=openai/gpt-5.6-sol` (engine.ts:105) and `result.models` reported the same ids.
- Repair ran through the `codegen` role handler and the scripted `final_review_report`
  task (the 3.3 two-call map-reduce, `astra-report`) fired with `report=model`. Neither
  the `codegen` role/task nor the PR-level report exists in 3.2.

Shipped, by area:

- **Roles:** `shared/models.ts` has four roles; `codegen` defaults to `openai/gpt-6-astra`,
  the reviewer role defaults to `openai/gpt-5.6-sol`; `CORTADO_MODEL_CODEGEN` /
  `CORTADO_REASONING_CODEGEN` / `CORTADO_MAX_TOKENS_CODEGEN` (8000) are wired through
  `config.ts`, `models.ts`, `runner.ts`, `/api/models` and repository settings. Repair and
  diagnosis call `role:"codegen"`; the repair cache key uses `models.codegen`.
- **Final review:** `FinalReviewReport` + per-finding `AstraReview` rationale/evidence refs;
  two-call map-reduce (`astra-final`, `astra-report`) with PR title/body, compact diff,
  instructions, verification reasons/outputs and promoted probes; deterministic fallback per
  part (a report failure keeps model-authored per-finding reviews); guardrails raise approving
  verdicts over unresolved high/critical findings; `provider verdict` drives review event and
  check conclusion; the report renders at the top of the review body and check-run `output.text`;
  the body is clamped at 60k with a truncation notice.
- **Engine:** `withTimeout` returns `{value, timedOut}` and `stage()` emits `timed_out` +
  `markDegraded`; stage-level `AbortSignal` flows into swarm/repair/verify/proof/astra model
  calls and sandbox commands; sandbox failures keep error proofs and degrade the run; baselines
  are awaited before repair mutates the tree and carry `green|red|unavailable|timeout`; repair
  restores on every non-success exit and cached fixes are restored before the fallback agent;
  MemorySandbox `applyEdits` is transactional; model length-truncation recursion is bounded and
  capability fallbacks are depth-limited; cost is micro-dollar rounded and `Retry-After` is
  honoured; cache keys include mode/reasoning/token/runner/settings and cached payloads are
  validated; incomplete swarm packs are never cached; `ReviewRequest` is zod-validated at the
  boundary; E2B commands are shell-quoted, the clone token is stripped from the remote, pnpm/yarn
  installs are respected and dev-server logs are written.
- **Server:** fenced run lifecycle (CAS claim, lease-guarded completion/failure, generation
  counter), heartbeat failures tracked, periodic recovery for stale queued/running rows, queue
  cap, publish state (`publish_state`/attempts/error/review id) with retryable unpublished runs,
  check runs finished on failure, webhook enqueue failures mark the delivery as error, review
  publish pins `commit_id`, creates before dismissing and reports classified failures, findings
  upsert on `(run_id, finding_key)`, autocommit deny-list covers token-bearing config/key
  material and a secret scan blocks credential-looking fixes, truncated inputs degrade the run,
  and secrets are redacted from logs/errors/events. Migration:
  `migrations/0019_review_run_fencing_and_publish_state.sql`.

Deferred (tracked, not silently dropped): persistent cross-run learnings, lint/format
verification step, per-repo advisory locks, cancellation endpoint + graceful drain, clock
injection, `stableId` unification, DB-backed runner lifecycle tests (need a live Postgres).

## Configuration (new)

```
CORTADO_MODEL_CODEGEN=openai/gpt-6-astra     # repair + diagnosis
CORTADO_REASONING_CODEGEN=high
CORTADO_MAX_TOKENS_CODEGEN=8000
CORTADO_MODEL_ASTRA=openai/gpt-5.6-sol       # final reviewer (independent)
```

## Risks / open questions

- Reviewer swap + astra codegen raise per-PR spend; `maxCostUsd` (default 1.50) plus caching and
  telemetry bound it.
- Independence is model-level; evidence bundles stay separate so the reviewer is not anchored
  on the writer's reasoning.
- `AbortSignal` plumbing touches the `Sandbox` interface (Memory + E2B) — the widest change.
- Multi-instance CAS needs migration + tolerance for legacy rows.
- Pre-existing unrelated WIP (client redesign, `shared/schema.ts` app changes) must not be
  folded into 3.3 engine commits.
