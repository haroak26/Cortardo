# CortardoBot 3.5 — Live E2E Report (PR 6, strict)

Status: **failed (strict gate)** — honest failure, no faked passes.
Date: 2026-09-16 · Engine: `3.5.0` · Run: `1f6fe707-c80e-4f48-a373-fcfd0c01deed` · Review: `5221128300` · Check run: `neutral`

## 1. Verdict

18/18 hard checks passed, 0 hard failures, **1 advisory warning** (`no candidate errored during runtime exercise`). `--strict` promotes advisories to failures, so the gate exited 1. The engine itself behaved correctly and honestly: it claimed nothing it could not prove, recorded two `error` states for a harness failure, and published a neutral review. The failing advisory is a real engine defect (runtime dev-server port mismatch, §5.1), not an app defect.

## 2. Target and trigger

- `haroak26/Artificial-Gateway` PR #6 "New pricing page", head `a9a43b844bc406a7db6266a338af8c1de09786fe`, base `3f7d3774f15816cafc6119ef71805a890488bfb3`, branch `new-pricing-page`, 9 files, +347/−119.
- Enqueued through the real server runner: `node --import tsx scripts/e2e/live-3.5.mts --repo haroak26/Artificial-Gateway --pr 6 --strict --wait 45`.
- Real gateway models, real E2B sandbox, real GitHub publish. The script first removed 21 previous CortadoBot inline comments, then published one new review.
- Models: `openai/gpt-5.6-luna` (investigator, medium), `openai/gpt-6-astra` (engineer, high), `openai/gpt-5.6-sol` (reviewer, high).

## 3. Deterministic gates (pre-run)

| Gate | Result |
| --- | --- |
| `cd cortardobot && npm run verify:3.5` (typecheck + engine tests) | PASS — 36/36 |
| `npx tsc --noEmit` (root) | PASS |
| `npm test` (root server tests) | PASS — 49/49 |

## 4. Live result

| Result | Value |
| --- | --- |
| Status | `done` · publish `published` · **degraded=true** ("2 candidate(s) errored") |
| Summary | 3 found · **0 reproduced · 0 verified** · 1 not reproduced · 0 deferred · 2 errors |
| Duration / usage | 212.8s · 9 calls · **$0.0292** |
| Runtime stage | `exercised` (ui) — but both ui seeds died in setup, see §5.1 |
| Verdict | `approve_with_comments`, confidence 55% — "No reproduction, no finding; no clean replay, no verified fix." |
| GitHub review | `5221128300` COMMENTED · previous same-head review `5215205842` dismissed · 0 inline comments |
| Check run | "Cortado" completed/**neutral** — "no reproduced issues · 1 not reproduced" (honest: nothing was proven) |
| Fallbacks / leaks | no `vitest`/`jest`/`npm test` fallback, no `apiKey`/`baseUrl` in stats or review body — the 3.4 failure mode is gone |

Coverage (`review_runs.stats.coverage`):

| Candidate | File | State | Reason |
| --- | --- | --- | --- |
| `c_5b1567a87e` — `/api-keys` crashes or renders errors at runtime | `client/src/pages/ApiKeys.tsx` | `error` | setup failed: dev server did not start on `127.0.0.1:4173` |
| `c_846983d76b` — `/auth` crashes or renders errors at runtime | `client/src/pages/ApiKeys.tsx` | `error` | setup failed: dev server did not start on `127.0.0.1:4173` |
| `c_cf442533be` — Billing overwrites `ag.activeWorkspaceId` with the billing plan | `client/src/pages/Billing.tsx` | `not_reproduced` | "no recorded probe named billing-workspace-probe.mjs" |

## 5. What went wrong

### 5.1 Runtime dev-server port mismatch (the strict failure)

The engine starts the app with `npm run dev -- --host 127.0.0.1 --port 4173` (`cortardobot/src/context/runtime.ts:68`) and then polls `http://127.0.0.1:4173/` for readiness (`runtime.ts:81`).

Artificial-Gateway's dev script is `NODE_ENV=development tsx server/index.ts`; it ignores `--host/--port` CLI args and listens on `process.env.PORT || 5000` (`server/index.ts:161`). The engine never exports `PORT`, so the app (if it came up at all) bound `:5000` while the readiness probe waited 90s on `:4173`. Both UI seeds timed out, became `error` states, and degraded the run. The captured dev log tail ends at the npm banner (`NODE_ENV=development tsx server/index.ts --host 127.0.0.1 --port …`), consistent with a probe pointed at the wrong port.

The same pattern exists in the agent `start_app` path: `cortardobot/src/sandbox-e2b.ts:217` (`npm run dev -- --host 127.0.0.1 --port ${port}`).

This is why the one advisory check failed: `no candidate errored during runtime exercise — c_5b1567a87e: setup failed …; c_846983d76b: setup failed …`.

### 5.2 Claimed without a probe (Billing)

The Billing candidate is the known PR6/PR7 defect class ("Billing overwrites the globally persisted active workspace ID with the billing plan"), and an investigator named a probe (`billing-workspace-probe.mjs`) — but no such probe was recorded via `write_probe`, so 3.5 correctly refused to call it a finding: "no recorded probe named billing-workspace-probe.mjs". Correct honesty, zero reproduction: the run proved nothing. Sub-investigator effort was thin this run (bug/regression/runtime: 1 turn, 0 tool calls each; security: 3 turns/7 calls; ui: 2 turns/4 calls).

### 5.3 Misleading route→file attribution

The `/auth` seed was attributed to `client/src/pages/ApiKeys.tsx` (fallback to `changed[0]`, `cortardobot/src/context/runtime.ts:192-197`) even though the route belongs to `Auth.tsx`. Coverage entries should name the owning file or say "unknown", not silently mislabel.

### 5.4 Overstated runtime status

`stats.report.runtime.status` is `exercised` although every runtime seed died in setup. "Exercised" should require at least one seed to have actually executed.

## 6. What to fix

1. **Export the port to the dev server** (`cortardobot/src/context/runtime.ts:62-85`, `cortardobot/src/sandbox-e2b.ts:210-225`): build the command as `PORT=${port} npm run ${script}` (keep `--host/--port` only for scripts known to forward flags, e.g. Vite). Acceptance: an Express+Vite hybrid repo (`dev: tsx server/index.ts`, reads `process.env.PORT`) becomes ready on the probed port; add a unit test for this fixture.
2. **Attribute runtime seeds to the owning file** (`runtime.ts:192-197`): resolve `/auth` to `Auth.tsx` rather than falling back to `changed[0]`; when no file matches, record the seed as unattributed.
3. **Make claims and probes atomic** (investigate stage): if an investigator names a probe in its final answer, require the recorded probe; otherwise emit a warning event and keep the honest `not_reproduced`. Consider a probe-shape test for the Billing claim so the known defect is either proven or explicitly disproven.
4. **Distinguish exercised vs attempted** (`stats.report.runtime`): report `exercised: false, reason: setup failed …` when every seed errors, so the verdict line does not overstate.
5. **Re-run the gate after fixes**: PR6 strict must go green, then the remaining 3.5 ship checklist (live PR7 run with `--expect Billing.tsx --expect Usage.tsx`, runtime live gate, publish-crash test) per `docs/cortardo-3.5.md`.

## 7. Reproduce

```bash
# deterministic gates
cd cortardobot && npm run verify:3.5
cd .. && npx tsc --noEmit && npm test

# the live strict gate that failed
node --import tsx scripts/e2e/live-3.5.mts \
  --repo haroak26/Artificial-Gateway --pr 6 --strict --wait 45
```

## 8. Evidence

- Console + E2E log: `/tmp/opencode/e2e-pr6-console.log`, `/tmp/opencode/cortardo-e2e.log`
- DB: `review_runs.id = 1f6fe707-c80e-4f48-a373-fcfd0c01deed` (`stats.coverage`, `stats.degraded`, `stats.report.runtime`), `review_findings` rows `c_5b1567a87e`, `c_846983d76b`, `c_cf442533be`
- GitHub: review `5221128300`, check run "Cortado" (`neutral`), commit status on `a9a43b84`

## 9. Bottom line

3.5 is honest and leak-free — it dropped unprovable claims, refused to call harness failures defects, and published a neutral verdict — but the strict gate is red because the runtime harness probes a port the app was never told to use. Fix §6.1 (and §6.2-6.4 while in there), re-run PR6 strict, then continue the 3.5 ship checklist.
