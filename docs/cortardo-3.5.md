# CortardoBot 3.5 — Reproduce, Fix, Verify

Engine version: `3.5.0`. The 3.4 engine (prover, proof artifacts, judge gates) is
deleted; its story lives in `docs/cortardo-3.4.md` and the git tag
`cortardo-3.4-baseline`.

## The one rule

**A claim is not a finding until a script fails because of it.**
No judge gate, no "provable" heuristics, no dependency on the repository's test
framework. A reproduction is a self-contained script run with a pinned runtime
(`node`, `npx tsx`, `python3`, `bash`), executed twice on the PR head. Both runs
must fail and the output must name the claimed file. Anything else is dropped
with the attempted command and output recorded.

## Pipeline

```
plan        diff parse, context index, impact slice, gates        (free, deterministic)
investigate specialized investigators in parallel (bug, regression, ui,
            security, api) chosen by the diff; every investigator reads the
            real code and writes + runs its own reproduction script
fix         per reproduced finding: up to 3 attempts in one E2B sandbox.
            On failure: classify, diagnose (max 3 questions), run a
            context-refresh swarm (<=3 read-only researchers), retry with the
            refreshed evidence and a forced change of approach
verify      fresh sandbox, untouched head + patch, reproduction twice,
            typecheck + repository tests, then an independent reviewer agent
report      coverage + verdict; the publisher posts the review and check
```

## Runtime exercise

Defects that only appear when the application runs are covered by a dedicated
runtime path, on by default and disableable per repository (`runtime: false`) or
globally (`CORTADO_RUNTIME=0`).

- **Capability probe (free).** The runner supplies `package.json` and
  `.env.example` as anchors; the engine classifies the changed code as
  `ui` / `api` / `cli` / none. Nothing runnable → the stage is skipped with a
  reason, no sandbox, no cost.
- **Deterministic seeds.** Changed page routes become browser scenarios
  (Playwright is in the E2B template), changed HTTP routes become fetch
  scenarios that fail on 5xx, changed CLI entries get a startup smoke.
- **Agent-authored scenarios.** A `runtime investigator` boots the app
  (`start_app`), reads its output (`read_app_log`) and writes a Playwright or
  HTTP reproduction with `write_probe`/`run_probe`.
- **Artifacts carry setup/teardown.** `ReproArtifact.setup` starts the app and
  waits for readiness; `teardown` stops it. The same artifact is replayed during
  confirmation, repair and verification, so a runtime fix is verified on a clean
  tree exactly like a logic fix.
- **Base comparison.** Every runtime failure is replayed at the PR base SHA in
  the same sandbox. Passes on base, fails on head → runtime regression (blocks
  at high/critical, like a proven logic defect). Fails on both → pre-existing
  runtime issue, reported as advisory and never blocking. Passes on rerun →
  flake, dropped.
- **Honesty.** App did not start, browser missing, checkouts failed → `error`
  state, never a finding. The review body and check text record whether runtime
  was exercised or skipped and why.

## Candidate states

Every candidate ends in exactly one state, persisted in `review_runs.stats.coverage`:

| State | Meaning |
| --- | --- |
| `reproduced` | a script fails twice and names the file |
| `verified_fix` | reproduction passes twice on a clean replay and the reviewer approves |
| `fix_failed` | reproduced, but repair or verification failed (reason recorded) |
| `not_reproduced` | claimed, but no script could prove it — advisory only |
| `deferred` | budget stopped new work; the finding is reported, never lost |
| `error` | infrastructure/harness failure; never counts as a defect or a fix |

## Context

L0 is the stored code graph (`server/lib/codegraph`) — tree-sitter symbols,
call/reference edges, string references, docs — loaded once per run from
`repository_codegraphs` / `repository_code_files`. L1 overlays the changed files
at the PR head so new keys and strings are visible even when the graph lags.
The impact slice lists callers, callees, related tests, importers and every other
place a string used by the diff appears (for example who reads
`ag.activeWorkspaceId`). Investigators then fetch whatever else they need with
tools: `read_file`, `search_code`, `find_references`, `get_impact`,
`search_strings`, `get_tests_for`, `read_doc`.

## Budgets

Budgets are soft. They gate *starting* new work and never abort work in
progress: an exhausted ceiling produces `deferred` candidates and the run still
completes and publishes. Defaults: 30 min wall clock, 160 model calls, $3 per
run, 5 investigators, 3 researchers per failed attempt, 3 fix attempts. All are
environment-tunable (`CORTADO_INVESTIGATORS`, `CORTADO_FIX_ATTEMPTS`,
`CORTADO_MAX_COST_USD`, ...). A clean PR never starts a sandbox.

## Roles and models

Three plain roles, configurable in the app:

- `investigator` — default `openai/gpt-5.6-luna` (fast, cheap, reads and reproduces)
- `engineer` — default `openai/gpt-6-astra` (writes the fix against the failing script)
- `reviewer` — default `openai/gpt-5.6-sol` (independent verification and report)

Legacy env names (`CORTADO_MODEL_LUNA`, ...) still resolve, but the canonical
keys are `CORTADO_MODEL_INVESTIGATOR`, `CORTADO_MODEL_ENGINEER`,
`CORTADO_MODEL_REVIEWER`.

## Why 3.4 failed (evidence from the live PR7 run)

Run `644bee50` (2026-09-16) found the real defects in Artificial-Gateway PR7
(the Billing storage bug, the reversed Usage period mapping) but proved none of
them. The investigators wrote valid `node:test`-style probes; `run_probe` fell
back to `npx vitest run` because the repository has no test script or test
framework. Vitest could not start, the harness error was classified as
"unprovable", repair never ran, and the run degraded with 0 confirmed. The
engine could not prove a single logic bug on a repository without a preinstalled
test runner — exactly the case the loop exists for. 3.5 removes that dependency:
probes are scripts with a pinned runtime, and harness failures are `error`
states, never `not_reproduced`.

Two plumbing defects from the same period are also fixed: coverage now persists
to `stats.coverage`, and publish state is recorded in the same transaction
window as the review creation so a crash cannot leave a live review with
`publish=pending`.

## Deterministic gates

```
cd cortardobot && npm run verify:3.5   # typecheck + 36 engine tests
npx tsc --noEmit && npm test           # root: typecheck + 47 server tests
```

The engine tests cover: context impact/string search, grounded investigators,
reproduce-or-drop, harness errors as `error`, fix + clean replay + reviewer,
soft-budget deferral, sandbox failure degradation, no-secret projection,
publish body/comments/check decisions, and runtime exercise (capability
detection, setup/teardown ordering, harness/flake handling, base comparison,
pre-existing classification).

## Live E2E

```bash
# from the workspace root — real gateway, real E2B, real GitHub publish
node --import tsx scripts/e2e/live-3.5.mts --repo owner/name --pr 42 --strict

# fixture-specific expectations are optional and generic
node --import tsx scripts/e2e/live-3.5.mts --repo owner/name \
  --expect src/pages/Billing.tsx --expect src/pages/Usage.tsx --strict

# discover connected repositories; --pr defaults to the newest open PR
node --import tsx scripts/e2e/live-3.5.mts --list
```

The script is not tied to any pull request. `--repo` accepts a repository uuid
or `owner/name`; without `--pr` it reviews the most recently updated open PR.

The script enqueues a review through the real server runner, waits for it,
then checks the run and the GitHub side:

- hard: engine `3.5.0`, status `done`, review published, no `apiKey`/`baseUrl`
  anywhere in stats or the review body, no `vitest`/`jest`/`npm test` fallback
  in the events, every candidate has a terminal state and a reason, runtime is
  either exercised or skipped with a reason.
- advisory (`--strict` promotes them): each `--expect <path>` has a candidate
  that reached `reproduced` or better, inline comments exist, the check
  conclusion is honest, no candidate errored.
- cleanup: previous CortadoBot inline comments are removed first (disable with
  `--keep-comments`).

Logs go to `${E2E_LOG:-/tmp/opencode/cortardo-e2e.log}`.

## Still to run before shipping 3.5

1. Live rerun on Artificial-Gateway PR7
   (`node --import tsx scripts/e2e/live-3.5.mts --repo haroak26/Artificial-Gateway --pr 7 --strict --expect client/src/pages/Billing.tsx --expect client/src/pages/Usage.tsx`)
   — the two defects must either reach `verified_fix` or fail with real
   command/output evidence. No `vitest` may appear in the logs.
2. Runtime live gate as part of the same run: the changed routes must be
   exercised with base comparison, or the run must record an honest skip.
3. PR6 rerun for regression parity.
4. Publish-crash test: kill the worker between review creation and the DB
   update, re-enqueue, confirm exactly one review.
