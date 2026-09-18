# CodeBot

CodeBot is the staged review agent that replaces the legacy all-or-nothing review pipeline.
Each stage ships, is tested, and is verified end-to-end on a live pull request before the
next stage is added. **A run publishes exactly one PR comment** — the review — plus one
native GitHub suggestion per verified fix. The review is published first and the suggestion
review follows it, so the conversation reads findings first and inline suggestions second.
Re-runs replace the previous review and the previous suggestions instead of spamming the
conversation.

Architecture, current behavior and the prioritized improvement plan:
[`../docs/codebot.md`](../docs/codebot.md).

## Stages

| Stage | Status | Output |
| --- | --- | --- |
| 1. codegraph | shipped | Internal only: the code graph for the changed files (symbols, imports, imported-by, callers/callees, likely tests) feeds stages 2-4. Never published |
| 2. hypotheses | shipped | Unproven, mechanism-level advisories, deduped and ranked by priority |
| 3. fixes | shipped | Coordinator fix plans + codegen drafts for the priority severities, kept off GitHub until verification |
| 4. verify | shipped | The autmpus loop: terra designs a sandbox test, the fix runs on a fresh clone of the PR head, and failures are diagnosed and repaired (up to 4 attempts) |

The pipeline (`runCodeBot`) runs stages 2-4 with publishing deferred, then publishes the
single review comment (`<!-- codebot -->` + `<!-- codebot:review -->`) and the verified
suggestions. The marker matches every legacy per-stage comment, so the first run after an
upgrade replaces all of them.

Stage 3 never compiles, applies or pushes anything; stage 4 compiles and tests in an
ephemeral E2B sandbox and never writes to the repository.

Stages 1 and 2 are deliberately read-only: they never change code, rewrite reviews, or
leave check runs behind.

## Hypotheses stage

The stage behaves like a detective at the crime scene: instead of "look for security holes", it
names the exact changed line and the failure it opens — "this change to the database timeout
looks risky; callers hold a pool connection for 30s, so the pool fills or the failure is masked
downstream". Three sources feed it:

- **Deterministic rules** (`src/rules.ts`) read the unified diff plus the stored code graph and
  emit grounded leads: threshold/config changes with their callers, export contract changes,
  storage-key writes and id-key value mismatches, changed conditions and ternaries (reversed
  mappings, flipped comparisons), empty catches and removed error handling, removed guards,
  removed cleanup calls.
- **Coordinator plan + swarm** (`src/master.ts`, `src/swarm.ts`): the coordinator (terra) splits
  the leads and uncovered files into up to 6 assignments; luna investigators run them in
  parallel with read-only tools (`read_file`, `find_files`, `search_code`, `get_impact`,
  `read_diff`) over the repository at the PR head; the coordinator then synthesizes the final
  ranked list from the diff, the leads and the investigator reports.
- **Learnings** (`src/learnings.ts`): dismissed fingerprints from `repository_learnings` are
  injected into the prompts and suppressed from the output, so repeated false positives shrink.

Every cited file must be in the diff and every line must be an added line; invalid entries are
dropped and counted. If the gateway key is missing, the plan fails, an agent fails or the cost
budget runs out, the stage keeps whatever evidence it has (down to the deterministic leads) and
says exactly what happened in the comment.

Everything it publishes is an **advisory, not a finding** — nothing is proven until a later stage
reproduces it. Each advisory prints its priority (`#n`) and dismissal id (`s_…`). Duplicate
findings are merged by `dedupeHypotheses` (same location, or overlapping wording across nearby
lines), so one bug appears exactly once.

## Fixes stage

Stage 3 turns each priority hypothesis into a draft patch:

- **Plan (terra)**: one call produces a concrete plan per hypothesis, or an explicit
  `not_fixable` reason.
- **Codegen (sol)**: parallel read-only agents return exact find/replace edits, validated
  against the current head (file readable, `find` unique, replacement different, ≤6 edits).
  Transport failures are retried and reported as `failed_transport`; outcomes are exhaustive
  (`generated | not_fixable | refused | failed | failed_transport | skipped`).
- **Publishing**: inside the pipeline the drafts stay off GitHub until stage 4 posts the
  verified set (deferred). Standalone stage runs still post the drafts as a GitHub review of
  ```` ```suggestion ```` blocks. Nothing is compiled, applied or pushed.
- **Cost**: minimal reasoning for codegen, a shared cacheable prompt prefix, `codegenTurns=3`
  and per-run content caching; the footer shows tokens, cached tokens and cost against
  `CODEBOT_MAX_COST_USD`.

Only the priority fixes are drafted: hypotheses whose severity is in
`CODEBOT_FIX_SEVERITIES` (default `critical,high`). Everything else is listed as skipped.

## Verify stage — the autmpus loop

Stage 4 proves the priority drafts in a sandbox instead of trusting them:

1. **Plan (terra)**: one call turns the hypothesis, the fix plan, the drafted edits and the
   repository tree into a harness — an optional probe file, the commands to run, and the
   commands expected to fail on the unfixed head (the reproduction).
2. **Run (E2B)**: a fresh clone of the PR head (`refs/pull/N/head`, SHA-verified, depth 1)
   installs dependencies once, then each fix is applied and the harness runs. Clone,
   install and every command's exit code, duration and output tail are recorded.
3. **Repair (terra → sol)**: when the harness fails, terra reads the failing command output,
   the git-verified state and the current files, diagnoses the cause and returns a revised
   plan (in the diff or outside it); sol rewrites the edits from the pristine head. Up to 4
   attempts (1 initial + 3 repairs), typically 1-2. Terra can drop a command that already
   fails on the unfixed head and declare the fix unfixable when no correct change exists.
   Edits are find/replace on existing files only — no new files, deletions or rewrites — and
   the repair prompt says so, so a fix that would need a new module is declared not fixable
   instead of burning attempts.
4. **Publish**: only verified edits are posted as native suggestions (each tagged
   `<!-- codebot:fix <id> -->` with a one-line context header), and the single review comment
   carries the findings, the verified set and a collapsed verification log with commands,
   exit codes, durations, attempt history, diagnoses and the harness probe contents.
   Evidence is graded honestly: `reproduction`/`probe test`/`tests` mean the changed code was
   actually executed; `compile` means typecheck/build only; `source check` means text
   assertions only (behavior not exercised). The review states how many verified fixes ran
   the changed code, and warns when a fix rests on source/compile checks — knock-on effects
   are only as covered as the harness. The pipeline always adds the repository's own
   typecheck/test command to a terra harness that omitted it.

Nothing is pushed: the PR branch is never written to. The stage degrades honestly — no
`E2B_API_KEY`, a failed clone or a failed install posts the drafts unverified and says why.

## Layout

- `src/codegraph.ts` — composes the per-file graph from fresh head analysis + the stored repo index
- `src/patch.ts` — unified diff parsing and the compact diff the agents read
- `src/rules.ts` — deterministic hypothesis rules over diff + code graph
- `src/prompts.ts` — coordinator plan/synthesis and swarm investigator prompts
- `src/master.ts` — planning, synthesis, validation, lead matching and merging
- `src/agent.ts` / `src/tools.ts` — read-only tool loop and the five read tools
- `src/swarm.ts` — assignment coverage, parallel investigators, per-agent failure isolation
- `src/fixes.ts` — fix planning, codegen validation, suggestions and the fixes stage
- `src/verify.ts` — stage 4: terra verify plan, the autmpus attempt loop, verify report
- `src/sandbox.ts` — E2B adapter, token clone, install detection, edit application, log redaction
- `src/model.ts` — gateway client (per-request fallbacks) + per-role usage/cache and the shared cost budget
- `src/learnings.ts` — dismissal fingerprints, suppression and prompt injection
- `src/hypotheses.ts` — `runHypothesisStage()` and the pure report builder
- `src/markdown.ts` — stage comment rendering and markers
- `src/github.ts` — comment publishing (replaces the prior stage comment)
- `src/index.ts` — `runCodeBot()` pipeline, stage dispatch and shared loaders
- `tests/` — unit tests for the graph, rules, agent loop, tools, master, fixes, sandbox loop and comment builders
- `scripts/e2e-*.ts` — live e2e per stage (verify clones and tests in E2B) · `scripts/eval.ts` — fixture recall harness
- `scripts/learnings.ts` — dismiss/list repository noise

## Commands

Run from the repository root:

```bash
npm run bot:test               # unit tests
npm run bot:e2e                # live stage 1 e2e against haroak26/Artificial-Gateway#6
npm run bot:e2e:hypotheses     # live stage 2 e2e
npm run bot:e2e:fixes          # live stage 2+3 e2e (publishes suggestions)
npm run bot:e2e:verify         # live stage 2+3+4 e2e: cleans old bot comments, clones in E2B, verifies
npm run bot:eval               # fixture recall/price against the planted-bug PRs
npm run bot:eval -- --pr 7 --deterministic   # rules-only recall, no model calls
npm run bot:learnings -- --repository owner/repo --list
npm run bot:learnings -- --repository owner/repo --dismiss s_ab12cd34ef --reason "intentional"
```

The eval harness is for CodeBot itself: it runs stage 2 against `haroak26/Artificial-Gateway`
PRs 6 and 7 and scores whether each planted defect is named. `--deterministic` scores only the
defects the rules are expected to catch.

The e2e scripts accept overrides:

```bash
CODEBOT_REPOSITORY=owner/repo CODEBOT_PR=123 npm run bot:e2e
CODEBOT_REPOSITORY_ID=<uuid> CODEBOT_DRY_RUN=1 npm run bot:e2e:hypotheses
CODEBOT_DRY_RUN=1 CODEBOT_NO_MODEL=1 npm run bot:e2e:hypotheses
```

`CODEBOT_DRY_RUN=1` builds the report and comment without posting anything.
`CODEBOT_NO_MODEL=1` skips the master-agent call and exercises the deterministic rules only.

Stage 2 model settings (base URL comes from `CORTADO_AI_BASE_URL`; the key resolves
`CODEBOT_API_KEY` → `CORTADO_AI_API_KEY` → legacy names):

```bash
CODEBOT_API_KEY=...                       # optional: swap an exhausted gateway key
CODEBOT_MODEL=openai/gpt-5.6-terra        # coordinator: plan + synthesis (default)
CODEBOT_SWARM_MODEL=openai/gpt-5.6-luna   # swarm investigators (default)
CODEBOT_CODEGEN_MODEL=openai/gpt-5.6-sol  # codegen engineer (default)
CODEBOT_SWARM_AGENTS=6                    # max assignments
CODEBOT_SWARM_CONCURRENCY=3               # agents in flight at once
CODEBOT_SWARM_TURNS=4                     # model turns per agent
CODEBOT_SWARM_TOOLS=3                     # tool calls per turn
CODEBOT_SWARM_SEARCH=0                    # disable gateway code search
CODEBOT_LEARNINGS=0                       # ignore stored dismissals
CODEBOT_MAX_FIXES=0                       # 0 = attempt every priority hypothesis
CODEBOT_FIX_SEVERITIES=critical,high      # only these severities are fixed and verified
CODEBOT_CODEGEN_CONCURRENCY=2             # codegen agents in flight
CODEBOT_CODEGEN_TURNS=3                   # codegen turns per fix
CODEBOT_MAX_COST_USD=0.50                 # shared soft cost ceiling (stages 2-4)
CODEBOT_TARGET_COST_USD=0.40
CODEBOT_STAGE2_BUDGET=0.22
CODEBOT_STAGE4_RESERVE_USD=0.15           # only the verify stage may spend this
CODEBOT_HYPOTHESES_MS=300000              # stage wall-clock budget
CODEBOT_MODEL_TIMEOUT_MS=60000
CODEBOT_REASONING=medium                  # coordinator/swarm reasoning
CODEBOT_REASONING_CODEGEN=minimal         # codegen reasoning
CODEBOT_VERIFY=1                          # 0 disables the sandbox stage
CODEBOT_VERIFY_ATTEMPTS=4                 # 1 initial + repairs
CODEBOT_VERIFY_MS=900000                  # stage 4 wall clock
CODEBOT_VERIFY_COMMAND_TIMEOUT_MS=300000
CODEBOT_VERIFY_COMMANDS=                  # newline-separated overrides (skips terra)
CODEBOT_E2B_TEMPLATE=cortardo-review-v1
CODEBOT_E2B_TIMEOUT_MS=900000
E2B_API_KEY=...                           # sandbox stage
```

The comment footer reports per-role calls, tokens and cost against the budget.

## Relationship to the legacy engine

The legacy review engine and its `server/lib/review/` integration have been removed;
engine 3.4 and earlier remain in git history (`cortardo-3.4-baseline` tag). CodeBot is the
only review pipeline and does not import any legacy engine code.
