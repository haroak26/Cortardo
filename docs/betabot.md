# Betabot — architecture, reliability, and roadmap

Engine version `0.4.0`. Related: [`../betabot/README.md`](../betabot/README.md).

---

## 1. What Betabot is

Betabot is the staged code-review agent that replaces the all-or-nothing CortardoBot
pipeline. The legacy engine and its server integration have been removed. Every stage
is read-only on the repository, and a run publishes **exactly one review comment** plus
one native GitHub suggestion per verified fix.

| Stage | Status | Output |
| --- | --- | --- |
| 1. codegraph | shipped | Internal only: the code graph of the changed files, consumed by the later stages. Never published |
| 2. hypotheses | shipped | Unproven, mechanism-level advisories, ranked by priority, rendered inside the single review |
| 3. fixes | shipped | Coordinator fix plans + codegen drafts (priority severities only); drafts stay off GitHub until verification |
| 4. verify | shipped | The autmpus loop: terra plans a sandbox test, the draft is cloned/applied/run in E2B, failures are diagnosed and repaired, verified edits become the inline suggestions |

The published review (`<!-- betabot -->` + `<!-- betabot:review -->`) carries the findings,
the fix and verification status of each, the verified patches outside the diff, and a
collapsed verification log. Because every legacy per-stage comment also carries
`<!-- betabot -->`, the first upgraded run replaces all of them at once.

Final live validation of the single-comment pipeline (`BETABOT_PROMPT_CACHE=0`):

| PR | Review | Verified | Evidence | Suggestions | Cost |
| --- | --- | --- | --- | ---: | ---: |
| #6 `betabot-25ce8bec` | `5719139423` | 2/3 (the third unverified, no suggestion) | compile | 3 | $0.4319 |
| #7 `betabot-79fc7451` | `5719252190` | 3/3 | 2 compile · 1 source check | 4 | $0.4230 |

The review publishes first, the suggestion review second, and evidence is graded honestly
("0 ran the changed code" on both runs). The earlier per-stage run is documented in
[`betabot-0.4-verify-e2e.md`](./betabot-0.4-verify-e2e.md).

---

## 2. Pipeline

```
GitHub App
   │  getPullRequest · listPullRequestFiles(patch) · getFileContent(head) · search/code
   ▼
run-inputs.ts ──► loadPullRequestContext / loadChangedFiles / analyseChangedFiles (tree-sitter)
   │  storage.getRepositoryCodegraph · storage.listRepositoryLearnings
   ▼
runBetabot() ─► stage 1 codegraph        buildCodegraphReport (internal, never published)
             ─► stage 2 hypotheses       scanHypotheses (9 rules, no model)
                                         runAssignmentPlanner (terra)      call 1
                                         runSwarm (luna, read tools)       ≤6 agents
                                         runSynthesis (terra)              call 2
                                         dedupeHypotheses → applyDismissals → priority 1..N
              ─► stage 3 fixes            runFixPlanner (terra)             call 1
                                         runCodegenAgent (sol) per priority hypothesis, validated
                                         (publishing and suggestions deferred)
              ─► stage 4 verify           E2B sandbox: clone head, install once
                                         runVerifyPlanner (terra) per fix  call 1
                                         apply edits → run harness (baseline + attempts)
                                         on failure: runVerifyRepair (terra) → sol rewrites
                                         ≤4 attempts (typically 1-2)
              ─► publish                  ONE review comment + one suggestion per verified fix
```

Stage 2 returns its structured `HypothesisReport` so stage 3 plans from exactly the ranked,
deduped list in the same run, and stage 3 returns its `FixReport` so stage 4 verifies exactly
the drafts it generated. Stages run with publishing disabled inside the pipeline; the run
composes and publishes the single review at the end. Running a stage alone (scripts, tests)
still publishes its own marker comment, and rebuilding a skipped upstream report is internal.

---

## 3. Stage 1 — codegraph

`buildCodegraphReport()` composes per changed file: fresh symbols, imports, imported-by,
callers/callees and likely tests from the stored index, with warnings for stale indexes and
unanalyzable files. Marker: `<!-- betabot:stage=codegraph -->`.

---

## 4. Stage 2 — hypotheses

### 4.1 Deterministic rules (`rules.ts`)
threshold/config changes, export contract changes, storage-key writes, id-key value
mismatches, empty/removed catches, unawaited state-changing calls, **condition changes**
(reversed ternaries, flipped comparisons — catches PR7's `7d/30d` mapping without a model),
guard removal, cleanup removal. Deduped by `file:line:mechanism`, ranked, capped at 12.

### 4.2 Coordinator plan + swarm + synthesis
Terra splits leads and uncovered files into ≤6 assignments. Luna investigators each run a
read-only tool loop (`read_file`, `read_diff`, `find_files`, `search_code`, `get_impact`);
`search_code` is clearly labelled as the **default-branch index**, never as head evidence.
Empty answers are pushed back until tools ran; the harness grounds a lazy agent itself. One
agent failing never fails the run. Terra then synthesizes the final list and may add
cross-file defects nobody reported.

### 4.3 One bug exactly once (`dedupeHypotheses`)
Same file required; same line+mechanism collapses; same line with a different mechanism
collapses only when the wording overlaps (so a truncation and an empty catch on one line
stay separate); nearby lines collapse with the same mechanism or strong overlap; same symbol
and mechanism collapse at any distance. Losers are merged (downstream refs unioned) and
counted in Notes.

### 4.4 Priority and learnings
The synthesis emits `priority` (1 = fix first), the report renumbers `1..N`, and every
advisory prints `priority #n` plus its dismissal id (`s_…`). Dismissals from
`repository_learnings` are injected into prompts and suppressed from output;
`npm run betabot:learnings -- --dismiss …` manages them.

---

## 5. Stage 3 — fixes (drafts only)

### 5.1 Plan (terra, one call)
Every **priority** hypothesis — severity `critical` or `high` by default
(`BETABOT_FIX_SEVERITIES`) — becomes either a concrete plan
(`summary`, `steps`, `files`, `risks`, `testIdea`) or an explicit `not_fixable` reason;
medium/low advisories are counted and skipped. `maxFixes=0` means every priority hypothesis.

### 5.2 Codegen (sol, parallel, up to 2 attempts per fix)
Each plan runs a read-only agent that must read the current code and return exact
find/replace edits. Validation (`validateFixEdits`): file readable at head, `find` present
exactly once, `replace` different, ≤6 edits; suggested ranges are mapped to head line
numbers and marked `inDiff` when every line exists on the patch's new side. Transport
failures are retried inside the attempt loop and reported as `failed_transport`, distinct
from `failed` validation. Outcomes are exhaustive: `generated | not_fixable | refused |
failed | failed_transport | skipped`, and skips state the reason (budget/deadline/plan).

### 5.3 Publishing
- **Inside the pipeline publishing is deferred**: stage 3 keeps both its suggestions and its
  comment off GitHub when stage 4 will run. The verified set is what readers see.
- **Standalone runs** publish as before: in-diff edits become one GitHub review (event
  `COMMENT`) with ```` ```suggestion ```` blocks tagged `<!-- betabot:fix <id> -->`, and a
  stage summary comment carries the plan, outcome, out-of-diff patches, confidence, attempts
  and usage. Re-runs list and delete previous betabot suggestions first, so one live set
  exists per PR.
- If the review API fails, the stage falls back to summary-only patches and says so.

Nothing is compiled, applied or pushed. That is stage 4.

### 5.4 Cost and caching
- Models: coordinator `openai/gpt-5.6-terra`, swarm `openai/gpt-5.6-luna`, codegen
  `openai/gpt-5.6-sol`.
- Codegen runs with **minimal reasoning** (`BETABOT_REASONING_CODEGEN`, default `minimal`),
  `codegenTurns=3`, a shared cacheable context prefix (same system prompt + repo/PR + full
  diff for every fix) and a per-run content cache for tool reads.
- The footer reports codegen calls, tokens, **cached tokens** and total cost against
  `BETABOT_MAX_COST_USD` (default $0.50).

---

## 6. Stage 4 — verify (autmpus loop)

Stage 4 is the only stage that executes code. It never writes to the repository; it clones
the PR head into an ephemeral E2B sandbox and proves the priority drafts there.

### 6.1 Selection
Only generated fixes whose hypothesis severity is in `BETABOT_FIX_SEVERITIES`
(`critical,high` by default) reach the sandbox. Medium/low advisories stay as advisories.

### 6.2 Plan (terra, one call per fix)
Input: hypothesis, fix plan, drafted edits, changed-file diff, `package.json`, the repository
tree and the likely tests from the code graph. Output: an optional install override, up to 5
commands, up to 3 probe files, and `mustFailBefore` — the commands expected to fail on the
unfixed head. Validation rejects destructive commands, unsafe probe paths, oversized probes
and duplicate commands. When terra is unavailable, the deterministic fallback uses the
repository's own `test` / `check` / `build` scripts or detected test files.

### 6.3 Sandbox
A single E2B sandbox per run (`BETABOT_E2B_TEMPLATE`, default `cortardo-review-v1`). Clone is
depth-1 `refs/pull/N/head` with the GitHub App installation token, SHA-verified, and the
token is scrubbed from the remote before any other command runs. Install is detected from
the lockfile (`npm ci`, `pnpm`, `yarn`, `bun`). Logs are redacted and tailed.

### 6.4 The loop
Baseline runs the harness on the pristine head. Each attempt resets the worktree, writes
probe files, applies the full edit set and runs the harness. An attempt passes only when
every command exits 0. Evidence is graded honestly: `reproduction`/`probe`/`tests` require
commands that actually execute repository code; a probe that only reads source text produces
`static` (source check — behavior not exercised); typecheck/build-only evidence is `compile`.
The pipeline always adds the repository's own typecheck or test command when a terra harness
omitted it, and the review says how many verified fixes ran the changed code and warns when a
fix rests on source/compile checks, so knock-on effects are never implied. On failure terra
diagnoses from the exit codes, output and current files; sol rewrites the edits from the
pristine head (in the diff or outside it), and terra may replace the commands. Maximum 4
attempts (1 initial + 3 repairs); stops early on success, `unfixable`, budget or deadline.
Commands that already fail on the unfixed head are reported as pre-existing and never counted
as fix failures. The harness probe contents are published in the collapsed verification log.

### 6.5 Outcome
Verified edits become the inline suggestions (each tagged `<!-- betabot:fix <id> -->` with a
severity/evidence/attempt header) and the single review comment carries the findings, the
verified set, the out-of-diff patches and a collapsed verification log with commands, exit
codes, durations, attempt history, diagnoses and evidence class. Unverified fixes leave no
suggestion. No `E2B_API_KEY`, a failed clone or a failed install posts the drafts unverified
and states the reason.

The pipeline publishes exactly one comment per run: the review. It carries the generic
`<!-- betabot -->` marker, so publishing it also deletes every legacy per-stage comment
(`codegraph`, `hypotheses`, `fixes`, `verify`) from earlier runs. Publish order is review
comment first, then the suggestion review, so the conversation leads with the findings; if
posting the suggestions fails, the review is republished once with the failure in its notes.

---

## 7. Configuration

| Env | Default | Purpose |
| --- | --- | --- |
| `BETABOT_API_KEY` | — | explicit gateway key override (checked first) |
| `BETABOT_MODEL` / `BETABOT_SWARM_MODEL` / `BETABOT_CODEGEN_MODEL` | terra / luna / sol | role models |
| `BETABOT_REASONING` / `BETABOT_REASONING_CODEGEN` | medium / minimal | reasoning effort |
| `BETABOT_SWARM_AGENTS` / `_CONCURRENCY` / `_TURNS` / `_TOOLS` / `_SEARCH` | 6 / 3 / 4 / 3 / on | swarm |
| `BETABOT_MAX_FIXES` | 0 (all priority) | codegen cap |
| `BETABOT_FIX_SEVERITIES` | critical,high | severities that are fixed and verified |
| `BETABOT_CODEGEN_CONCURRENCY` / `_TURNS` | 2 / 3 | codegen pool |
| `BETABOT_MAX_COST_USD` | 0.50 | shared soft ceiling for stages 2-4 |
| `BETABOT_TARGET_COST_USD` | 0.40 | soft goal |
| `BETABOT_STAGE2_BUDGET` | 0.22 | stage 2 cap |
| `BETABOT_STAGE4_RESERVE_USD` | 0.15 | slice only the verify stage may spend |
| `BETABOT_HYPOTHESES_MS` | 300000 | stage 2 wall clock |
| `BETABOT_LEARNINGS` | on | dismissal suppression |
| `BETABOT_VERIFY` | on | 0 disables stage 4 |
| `BETABOT_VERIFY_ATTEMPTS` | 4 | 1 initial + repairs |
| `BETABOT_VERIFY_MS` / `_COMMAND_TIMEOUT_MS` | 900000 / 300000 | stage and command clocks |
| `BETABOT_VERIFY_COMMANDS` | — | newline-separated overrides (skips terra) |
| `BETABOT_E2B_TEMPLATE` / `_TIMEOUT_MS` | cortardo-review-v1 / 900000 | sandbox |
| `E2B_API_KEY` | — | required for stage 4 |
| `BETABOT_NO_MODEL` | — | deterministic-only |

The gateway client retries transient statuses, and capability fallbacks (json mode, token
caps, reasoning, temperature) are decided **per request**, so concurrent agents cannot race
each other's recovery.

---

## 8. Validation

- `npm run betabot:test` — 102 unit tests: rules (including the reversed ternary), agent loop
  (pushback, grounding, recovery), tools, planning, synthesis, dedupe, learnings, fixes
  (validation, retries, transport failures, suggestions), verify planning and validation,
  the autmpus loop (reproduction, repair, attempt cap, budget, pre-existing failures,
  inconclusive outcomes), sandbox helpers (clone/install/edit application), the single review
  comment (findings, statuses, out-of-diff patches, no codegraph), model transport races.
- `./node_modules/.bin/tsc --noEmit` clean.
- `npm run betabot:eval` — fixture recall: PR6 100% (2/2), PR7 100% (6/6); deterministic
  mode catches the rules-only expectations with zero model calls.
- `npm run betabot:e2e` — codegraph debug check; calls `runCodegraphStage` directly because
  the pipeline never publishes codegraph.
- `npm run betabot:e2e:hypotheses` / `:fixes` — live checks of the single review comment
  (findings, drafts, no codegraph comment) and of the suggestion set.
- `npm run betabot:e2e:verify` — live stage 2-4 e2e: removes old bot artifacts, clones the PR
  head in E2B, verifies the priority fixes, asserts one review comment + tagged verified
  suggestions and the budget. See [`betabot-0.4-verify-e2e.md`](./betabot-0.4-verify-e2e.md)
  (pre-single-comment run).

---

## 9. Reliability & robustness roadmap

Audit findings drive four phases. Phase 1 shipped with the suggestions/caching work.

### Phase 1 — shipped
Per-request capability fallbacks (concurrency race fixed), transport retry in codegen,
`failed_transport` outcomes, search-index labelling, read truncation hints, native
suggestions with cleanup, codegen minimal reasoning, shared cache prefix, cached-token
telemetry, coverage of every hypothesis, priority-severity gating, and the stage-4 autmpus
loop (E2B clone/install/verify/repair, graded evidence, verified-only suggestions).

### Phase 2 — reliability core
1. **GitHub resilience**: retries with jitter around Octokit (plain clients today),
   rate-limit awareness, and 403/secondary-limit handling.
2. **Run persistence**: a `betabot_runs` table (repo, PR, head, stage, status, usage,
   comment ids) plus a per-repo advisory lock and head-SHA dedupe so concurrent webhook
   deliveries cannot double-post or race comment replacement.
3. **Shared inputs**: load PR files/analyses/index once per run and pass them to all stages.
4. **Quality gate**: run `betabot:eval` in CI on every prompt/model change.

### Phase 3 — correctness hardening
5. **Syntax gate**: parse edited content with the existing tree-sitter analyses before
   publishing a suggestion; reject edits that break the file (stage 4 already compiles the
   whole changed tree in the sandbox, so this is now mostly a cheap pre-filter).
6. **Missing patches**: synthesize diffs from head/base content for large or binary files.
7. **Index freshness**: overlay changed files into the graph or trigger re-index at the PR
   head so cross-file edges are not stale.
8. **Injection & secrets**: keep repository content as data in prompts; redact token-like
   strings from comments and warnings (stage 4 redacts sandbox output; published comments
   still take graph content verbatim).
9. **Sandbox reuse**: cache prepared sandboxes per repository/head across runs to cut the
   ~15s install cost on repeated verifications.

### Phase 4 — enterprise operations
10. Per-repository budgets, model policies and enablement; audit logs for every model call
    and published artifact.
11. Metrics/SLOs: latency per stage, recall on fixtures, cost per PR, cache-hit rate,
    failure rates by class; alert on repeated transport or GitHub failures.
12. Runbook + self-host docs; fallback routing to a secondary gateway.

---

## 10. Open questions

1. Should verified fixes be auto-committed to the PR branch behind an explicit per-repo
   setting, instead of only suggested?
2. Should medium/low hypotheses get a cheap "compile-only" verification pass?
3. Should a failed verification trigger a fresh hypothesis pass instead of only a repair?
4. How many suggestion comments are acceptable on very large PRs before switching back to
   a single summary?
5. Should reaction-based learning (👍/👎 on suggestions) feed dismissals automatically?
