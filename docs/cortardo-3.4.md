# CortardoBot 3.4 — The Autonomous Loop Actually Runs

> **Superseded by [3.5](cortardo-3.5.md).** The 3.4 engine was deleted after the
> live PR7 run proved the loop could not execute probes on repositories without
> a preinstalled test framework. This document is kept as the failure analysis
> that 3.5 was built from; the engine code lives at the git tag
> `cortardo-3.4-baseline`.

Engine version: `3.4.0` · Baseline: `3.3.0` (`docs/cortardo-3.3.md`) · Status: Phases 0–3 landed; Phase 4 E2E gates pending (not run in this change)

Goal: make the flagship autonomous loop — **investigate → prove → repair → verify** — the
default, enforced path for every judge-approved finding, and make it impossible for the
engine to silently skip it. 3.4 is a reliability and honesty release: every candidate ends
in a recorded terminal state, proof artifacts are first-class, and a run that cannot prove
its findings degrades visibly instead of publishing a static review that looks clean.

> **How to use this document:** Phase 0 is security/honesty P0. Phase 1 builds the prover.
> Phases 2–4 surface it to users and lock it in with fixtures. "Decisions locked" records
> the product calls made for this release; do not relitigate them in code review.

## Locked decisions

- **Unprovable policy (strict degradation).** When the judge approves a candidate for
  execution-based proof and the prover cannot produce an executable reproduction on a
  healthy sandbox, the run is `degraded` with a per-candidate reason. Degraded runs never
  produce a green check and never auto-commit.
- **Static-only publishing.** High/medium static-only findings are published as
  **non-blocking** inline comments labelled "unproven — static analysis". Static findings
  never drive `REQUEST_CHANGES` on their own; the Astra verdict and unresolved *proven*
  findings still can.
- **Prover model strategy (Luna first, escalate).** Deterministic planning runs for free;
  then `luna` authors probes (bounded); only a near-miss on a high+ severity candidate
  escalates to `codegen` (`gpt-6-astra`), capped at one escalation per run.
- Invariants that must never relax:
  - `isVerifiedFix()` is the only definition of a fix.
  - Harness errors / `error` / `likely` proof states are never confirmation and never
    permission to mark a repair `VERIFIED`.
  - Degraded runs can never produce a green check.
  - Every judge-approved candidate ends in exactly one recorded state:
    `PROVEN`, `UNPROVABLE`, `BUDGET` or `ERROR`.

## Why 3.3 failed (root cause)

The autonomous loop was **bypassed**, not broken. There is no stage that turns "this claim
deserves proof" into "here is an executable reproduction"; instead the engine computed a
boolean `provable` from hard-coded heuristics and rewrote the judge's PROVE verdict when it
was false.

Evidence from live runs (2026-09-15, engine 3.3.0, dev server working tree):

| Run | PR / head | candidates | confirmed | fixed/verified | proof stage | outcome |
| --- | --- | --- | --- | --- | --- | --- |
| `fcd25ed2` | PR6 `0b19da07` | 5 | 4 | 3/3 | 94.1s | full loop |
| `9adfa341` | PR6 `0b19da07` | 5 | 4 | 3/3 | 134.1s | full loop (cache replay) |
| `d9a6388d` | PR6 `a9a43b84` | 2 | 0 | 0/0 | **absent** | repair 0ms, verify 1ms |
| `03119ed1` | PR7 `74c5449d` | 3 | 0 | 0/0 | **absent** | repair 1ms, verify 0ms |

The moment the fixture changed from render crashes/nav regressions (provable by browser
check heuristics) to logic bugs (wrong time range, state corruption), the loop vanished.
The cached judge payload proves the engine overruled Terra:

```json
{"source":"terra","decisions":[
 {"reason":"No executable proof available","verdict":"STATIC_ONLY","priority":90,"candidateId":"c_dee64d49"},
 {"reason":"No executable proof available","verdict":"STATIC_ONLY","priority":90,"candidateId":"c_d055227d"},
 {"reason":"...localized visual styling issue...","verdict":"STATIC_ONLY","priority":3,"candidateId":"c_2ab18f23"}]}
```

`"No executable proof available"` exists only at `judge.ts:112`, in the branch that
rewrites a PROVE into STATIC_ONLY. Terra voted PROVE for the high-severity Billing bug and
the medium Usage bug.

### Root-cause chain

1. **Luna's proof intent is discarded.** `swarm-agent.ts` parses `suggestedExperiment` and
   never reads it; the proof plan is replaced by a fixture regex:
   `candidate.suggestedProof = candidate.check ? "browser" : /auth|docs|pricing/i.test(tests) ? "targeted_test" : "none"`.
2. **`context.tests` is diff-scoped.** Only test files changed in the PR are known
   (`intelligence.ts`), so the `targeted_test` branch is unreachable on a normal PR. v3 has
   no repo-wide test discovery; v2 did (`src/stages/proof.ts`).
3. **The judge gate hard-downgrades.** A PROVE verdict is rewritten to STATIC_ONLY whenever
   `Boolean(candidate.check) || suggestedProof ∈ {existing_test,targeted_test,browser}` is
   false (`judge.ts`).
4. **No prover stage exists.** `proof.ts` can only replay a pre-existing browser check or
   an existing test command. v3 dropped v2's general `"script"` strategy
   (`reproductionCommand` + marker).
5. **Failure is silent.** Proof errors do not degrade; runs with 0 confirmed look clean.
6. **Validation was built on the happy path.** `tests/v3/proof.test.ts` asserts the
   limitation, `tests/v3/engine.test.ts` asserts the static-only downgrade, and the
   scripted E2E only selects detector candidates that already have a browser check.

## Findings register

### P0

- **P0-1 · Proof gate disables the loop** (`swarm-agent.ts`, `judge.ts`, `engine.ts`,
  `proof.ts`). Any defect without a browser heuristic or same-named existing test can never
  be confirmed, repaired or verified.
- **P0-2 · Silent proof failure** (`engine.ts`). Proof `error` is neither degrading nor
  surfaced; there is no loop-coverage metric.
- **P0-3 · Gateway API key persisted and exposed.** `ModelsConfig` carries `apiKey`/`baseUrl`;
  `engine.ts` stores the whole config as `result.models`; `runner.ts` persists it in
  `review_runs.stats`; `GET /api/runs` returns `stats` to any workspace member. Verified in
  the dev database. **Rotate the key and scrub existing rows.**
- **P0-4 · Repair marks fixes VERIFIED on inconclusive proofs** (`agent/loop.ts`): `error`
  and `likely` proofs are treated as "fixed", so `issuesFixed` can exceed `issuesVerified`.

### P1

- **P1-5 · Static-only findings are invisible in the PR** (`publisher.ts`, `astra.ts`):
  inline comments only cover confirmed findings; the report is told "No confirmed findings"
  and hard-codes `staticOnly: 0`.
- **P1-6 · Check and verdict disagree** (`publisher.ts`): a `REQUEST_CHANGES` review can sit
  next to a neutral check titled "no confirmed issues".
- **P1-7 · No proof-artifact contract** (`types.ts`, `proof.ts`, `verify.ts`): a
  model-authored probe can never be the authoritative reproduction.
- **P1-8 · Brittle agent JSON schemas reduce recall** (`swarm-agent.ts`, `agent/loop.ts`):
  one extra action rejects the whole turn and loses the agent's hypotheses; agent failure
  does not degrade.
- **P1-9 · Swarm recall is thin**: investigators can emit hypotheses without investigating.

### P2

- `engine.ts` casts `"unavailable"` to `BaselineTestResult`; `.status` is `undefined`
  downstream (works by accident).
- `merge.ts` does not merge near-duplicate candidates (double repair spend).
- `final_review` cache key omits proof state; the check-run/event ring buffer drops early
  stages; `formatMarkdown` omits `codegen`; detectors encode fixture-specific classes.

## 3.4 design

### Pipeline

```
3.3:   swarm → judge(PROVE|STATIC) → [boolean gate; if not "provable" → STATIC] → replay → repair → verify

3.4:   swarm → judge(PROVE|STATIC + reason) → proof planner
            ├─ deterministic: browser check | repo-wide related test | targeted test
            ├─ synthesis: prover agent (luna, escalate codegen) authors a probe/script
            │              must fail ≥2× pre-fix and cite the claimed file/symbol
            └─ PROVEN artifact ──→ repair(artifact-aware) → verify(replay artifact twice + suite/typecheck)
        UNPROVABLE/ERROR → recorded state → run degraded → surfaced in report, comments, check
```

### Contracts

- `ProofKind += "probe"`.
- `ProofArtifact { kind: "browser_check" | "existing_test" | "targeted_test" | "probe";
  check?; path?; content?; command?; preFixFailures: number; artifactHash: string }`.
- `ProofResult.artifact?: ProofArtifact`, `ProofResult.proofState?: "PROVEN" | "UNPROVABLE" | "BUDGET" | "ERROR"`.
- `Candidate.suggestedExperiment?`, `Candidate.proofPlan?`.
- `ReviewResult.loop: { judgeProve; proven; proofUnavailable; proofErrors; candidates[] }`.
- `ReviewResult.models` stays `ModelSelection` and is built by projection — never by
  spreading `ModelsConfig`.
- `FinalReviewReport.findingsSummary` gains `proofUnavailable` and populates
  `staticOnly`/`discarded` from real decisions.

### Prover (Luna first, escalate)

1. **Tier 0 — deterministic (free).** Browser check from `inferCheck`; repo-wide related
   test discovery; targeted test. Attach the artifact and run it.
2. **Tier 1 — `luna`.** Max 2 attempts × 3 turns × 3k tokens. Tools:
   `read_file`, `search_code`, `find_files`, `get_tests_for`, `read_test`,
   `run_test_file`, `write_probe`, `run_probe`, `finish`. Success requires a probe that
   fails twice on the pristine head with output that references the claimed file or symbol.
3. **Tier 2 — `codegen` escalation.** Only for high/critical candidates where Luna wrote a
   probe that failed confirmation, capped at one escalation per run.
4. **Failure honesty.** Budget exhausted or no provable artifact ⇒ `proofState` recorded
   with the prover's last reason; no repair attempt.
5. **Artifact replay.** `proveOne`/`proveCandidates` accept artifacts; `verifyRepairs`
   replays the artifact twice post-fix and requires pass; `repair.probe` promotion is
   unified with the artifact.
6. Probes live in `.cortado-probes`, are deleted before repair and never enter the diff.

### Honesty and observability

- `judgeProve > 0 && proven < judgeProve` on a healthy sandbox ⇒ `degraded=true` with
  `degradedReason` naming the unprovable candidates.
- Review body and check text show proof coverage:
  `judge approved X · proven Y · unprovable Z` with per-candidate reasons.
- Static high/medium findings post as labelled non-blocking inline comments.
- Check conclusion: degraded ⇒ `neutral`; when the report requests changes but nothing was
  proven, the check title says "changes requested — no verified fixes" instead of
  "no confirmed issues".

### Security

- Engine projects `result.models` to `{ luna, terra, codegen, astra, reasoning }`; a unit
  test asserts no `apiKey`/`baseUrl` anywhere in the serialized result.
- Runner sanitizes again before persisting `stats`.
- Migration `0020_scrub_run_stats_secrets.sql` removes `models.apiKey` and `models.baseUrl`
  from existing `review_runs.stats`; ops rotates `CORTADO_AI_API_KEY` because it was
  persisted and served by `/api/runs`.

## Implementation phases

### Phase 0 — P0 stabilization

- [x] Project `result.models`; add no-secret tests.
- [x] Sanitize `models` in the runner before `stats`.
- [x] Migration `0020_scrub_run_stats_secrets.sql`.
- [x] Repair accepts only `disproven`; `issuesFixed` derives from `isVerifiedFix`.
- [x] Clamp agent action arrays instead of rejecting; degrade on swarm agent failure.
- [x] Degrade when proof errors or unprovable judge-approved candidates exist.

### Phase 1 — General proof

- [x] Types: `ProofArtifact`, `proofState`, `loop` coverage, `suggestedExperiment`.
- [x] Repo-wide test index in the sandbox profile and PR context.
- [x] Judge removes the `provable` gate; carries `suggestedExperiment` into judging.
- [x] Prover stage (deterministic → luna → codegen escalation) wired into the engine.
- [x] Artifact-aware `proveOne` / `verifyRepairs` replay.
- [x] Swarm candidate carries the experiment as its proof plan; fixture regex deleted.

### Phase 2 — Product surface

- [x] Publisher: static inline comments, proof-coverage section, honest check text.
- [x] Astra: populated `findingsSummary`, unproven digest in the report input.
- [x] Result markdown: loop coverage + `codegen` in the model line.

### Phase 3 — Recall hardening

- [x] Swarm prompt: investigate before hypothesising; carry the experiment.
- [x] Repo-wide test index feeds `relatedTestsFor` and the context pack.
- [x] Near-duplicate same-file candidates merge by claim-token overlap.

### Phase 4 — Validation (no E2E in this change)

- [x] Deterministic engine test where a no-check logic bug is proven by a synthesized
      probe, repaired and verified (`tests/v3/prover.test.ts`).
- [x] Prover unit tests: artifact creation, two-fail rule, harness honesty, escalation.
- [x] Honesty tests: proof error ⇒ degraded, never green; repair cannot verify on error.
- [x] Security tests: no secrets in `ReviewResult`.
- [x] Publisher tests: static-only inline comments, proof coverage, check conclusion.
- [ ] Scripted E2B logic-bug fixture (deferred; no E2E runs in this change).
- [ ] Live PR6/PR7 reruns with cache off (deferred; no E2E runs in this change).

## Implementation log (2026-09-15)

Deterministic gates at handoff:

```
cd cortardobot && npm run verify:v3   # typecheck + 103/103 v3 tests
cd cortardobot && npm test            # 1151/1151 (legacy + v3)
npx tsc --noEmit && npm test          # root: tsc clean + 50/50 server tests
```

Landed in this change:

- **Secret fix:** `publicModelSelection()` projects `result.models`; the runner sanitizes
  again before `stats`; migration `0020_scrub_run_stats_secrets.sql` was applied to the dev
  database (6 rows scrubbed; 0 rows now contain `apiKey`/`baseUrl`/`mg_`). **Ops still
  needs to rotate `CORTADO_AI_API_KEY`** because it was persisted and served by `/api/runs`.
- **Prover:** new `src/v3/prover.ts` (Luna first, codegen escalation) wired into a `prove`
  engine stage; artifacts travel on the candidate and are replayed by `proveOne` and
  `verifyRepairs`. Probe artifacts must fail twice; failures that do not reference the
  candidate are rejected.
- **Judge:** the `provable` gate and its "No executable proof available" downgrade are
  deleted; funding is now purely the proof budget. `suggestedExperiment` is carried through
  candidates and shown to the judge.
- **Honesty:** `LoopCoverage` records `PROVEN`/`UNPROVABLE`/`BUDGET`/`ERROR` for every
  judge-approved candidate; unprovable or errored candidates degrade the run; `issuesFixed`
  is computed from `isVerifiedFix`; repair only accepts a `disproven` reproduction.
- **Product surface:** proof-coverage section in the review body and check text; static
  high/medium candidates publish as labelled non-blocking inline comments; honest check
  titles; Astra receives the unproven digest and populates `findingsSummary`.
- **Recall:** repo-wide test index from the sandbox profile; context packs include related
  tests that are not in the diff; near-duplicate candidates merge; swarm schema arrays are
  clamped instead of rejecting the whole agent turn.

Still to do before shipping 3.4:

1. Rotate `CORTADO_AI_API_KEY` (the old key was persisted).
2. Run the scripted E2B logic-bug fixture and the live PR6/PR7 reruns (cache off) from
   Phase 4 — these are the gates that prove the loop runs on real logic bugs.

## Acceptance criteria

- **A1** A judge-approved candidate with no browser check and no existing test is proven
  via an authored probe, repaired and verified (deterministic engine test).
- **A2** Harness-error proof ⇒ `error`, no confirmed finding, run degraded, check cannot
  be green.
- **A3** `summary.issuesFixed === summary.issuesVerified` always; a repair with `error`/
  `likely` proof can never count as fixed.
- **A4** No `apiKey`/`baseUrl`/`mg_` in `ReviewResult`, `stats`, or `/api/runs`; migration
  0020 scrubs historical rows.
- **A5** Static high/medium findings appear as labelled non-blocking inline comments and do
  not by themselves request changes.
- **A6** Every judge-approved candidate has a recorded `loop` state; zero silent drops.
- **A7** Existing gates green: `cd cortardobot && npm run verify:v3`, `npm test`, root
  `npx tsc --noEmit && npm test`.

## Configuration (new)

```
CORTADO_PROVER_MS=180000              # shared budget across prover tiers
CORTADO_PROVER_ATTEMPTS=2             # tier-1 attempts per candidate
CORTADO_PROVER_TURNS=3                # tier-1 turns per attempt
CORTADO_PROVER_ESCALATIONS=1          # codegen escalations per run
CORTADO_PROVER_CANDIDATES=4           # judge-approved candidates to prove per run
```

## Risks / open questions

- Strict degradation makes more runs neutral: intentional honesty trade-off; the review
  body explains why.
- Probe quality: a probe that fails for the wrong reason is caught by the causality filter
  and by verification replay (a fix that does not change the probe outcome cannot verify).
- Cost: tier 0 is free; tier 1 is cheap; escalation is bounded to one high-severity
  candidate per run and remains under `maxCostUsd`.
- The 3.3 working tree must be committed as a baseline before 3.4 work is reviewed so the
  diff and gates are meaningful.
