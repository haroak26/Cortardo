# Cortardo Bot 0.4 — stage 4 (verify) live E2E report

> Historical note: the first run below predates the single-comment change. At the time each
> stage published its own marker comment (hypotheses / fixes / verify); the pipeline now
> publishes one review comment plus the verified inline suggestions (see the addendum at the
> end). The stage-4 mechanics, evidence and costs below are unchanged.

Run `2026-09-17` · PR [`haroak26/Artificial-Gateway#7`](https://github.com/haroak26/Artificial-Gateway/pull/7)
· head `74c5449d` · engine `0.4.0` · budget `$0.50`.

Command:

```bash
CORTARDO_BOT_MAX_COST_USD=0.50 CORTARDO_BOT_API_KEY=... npm run bot:e2e:verify
```

The e2e first removes every Bot-authored issue comment and review comment on the PR, so the
run owns the conversation, then runs stages 2-4 and asserts: ≥1 priority fix generated, ≥1
verified, sandbox used, one comment per stage, every review comment tagged
`<!-- cortardo-bot:fix... -->`, no stale bot comments, and total cost within budget.

## Result

| Stage | Duration | Model calls | Cost at stage end | Artifact |
| --- | ---: | ---: | ---: | --- |
| 2. hypotheses | 56.6s | terra ×2 · luna ×11 | $0.0466 | comment `5717962209` |
| 3. fixes | 31.5s | terra ×3 · sol ×6 | $0.1350 | comment `5717968456` |
| 4. verify | 170.9s | terra ×7 · sol ×9 | **$0.2742** | comment `5718003687` |

- **3/3 priority fixes verified** (4 attempts, 8 commands, 3 reproductions), 0 unverified,
  0 inconclusive, 0 skipped.
- **3 verified suggestions posted**, the 3 stage-3 drafts replaced, 2 out-of-diff edits stay
  in the comment.
- Sandbox `im1gk40jif0mp9jz3ak9t` (`cortardo-review-v1`): clone 2.1s, `npm ci` 14.4s.
- Stage 2 found 7 hypotheses; **4 were filtered by the critical/high severity gate** before
  codegen.
- Conversation after the run: exactly the 3 stage comments plus 3 tagged suggestions; all 7
  artifacts from the previous run were removed by cleanup.

## Per-fix evidence

| Priority | Hypothesis | File | Evidence | Attempts | Harness |
| ---: | --- | --- | --- | ---: | --- |
| 1 | `s_fd221b5523` hardcoded model | `client/src/pages/Playground.tsx:130` | reproduction | 1 | probe + `npm run check` |
| 2 | `s_715a8de555` swapped 7d/90d mapping | `client/src/pages/Usage.tsx:28` | reproduction | 1 | inline probe + `npm run check` |
| 3 | `s_b4393f8265` truncated stored API key | `client/src/pages/ApiKeys.tsx:165` | reproduction | **2** | probe + `npm run check` |

All three harnesses failed on the unfixed head and passed with the fix — the strongest class
of verification. Terra authored the probes; every command exited 0 after the fix, and the
typed check (`tsc`) passed in the same clone.

## The repair cycle (fix 3)

Attempt 1 failed on the probe. Terra's diagnosis read the sandbox output and the current
files, and concluded the drafted edit was necessary but incomplete — the page stored the key
but never restored it, so a `sessionStorage.getItem` effect was missing. Sol then rewrote the
edit set from the pristine head, adding an out-of-diff `useEffect`. Attempt 2 passed:

- attempt 1: probe exit 1 (reported as a reproduction gap, `npm run check` pass) → diagnosis
- attempt 2: probe pass, `npm run check` pass → verified `reproduction`, 52.6s

This is exactly the intended 1-2 attempt behavior; the cap of 4 was not needed.

## Cost

| Role | Calls | Tokens in/out | Cached in | Cost |
| --- | ---: | --- | ---: | ---: |
| terra (coordinator: plan, synthesis, verify plans, diagnosis) | 7 | 38,756 / 7,847 | 8,448 (22%) | $0.1565 |
| luna (swarm investigators) | 11 | 29,636 / 4,403 | 16,984 (57%) | $0.0082 |
| sol (codegen + repairs) | 9 | 18,882 / 1,484 | 6,519 (35%) | $0.1096 |
| **Total** | 27 | | | **$0.2742 of $0.50** |

The stage-4 reserve ($0.15) was unlocked for the verify stage only; stages 2-3 stayed within
the spendable $0.35. `CORTARDO_BOT_TARGET_COST_USD=0.40` was not reached.

## Findings

1. **The shared gateway key chain picked an exhausted key.** The first run failed with
   `402 API key spend limit exceeded` from `CORTARDO_BOT_MERGE_API_KEY` while
   `OPENCODE_MERGE_KEY` was live. The runner needs `CORTARDO_BOT_API_KEY` set explicitly; this is
   the documented override and the same finding as
   [`cortardo-bot-cost-findings.md`](./cortardo-bot-cost-findings.md).
2. **Repaired reports.** Per-role usage objects were live tracker references, so published
   role sums drifted from the stage totals once later stages spent more. Role snapshots are
   now copied at report time; this run's receipt is internally consistent.
3. **Out-of-diff repair edits are not suggestions.** Sol's `useEffect` addition is part of
   the verified patch but falls outside the PR diff, so it is printed in the verify comment
   instead of a one-click suggestion. The suggestion review contains the 3 in-diff edits.
4. **Install dominates the sandbox cost**: 14.4s of the ~20s per-fix setup; the sandbox is
   reused across fixes and the harness itself is fast (4-5s `tsc`, 0.1s probes).
5. **A pre-existing probe failure is not a fix failure.** Terra marks commands that already
   fail on the unfixed head and either drops them from the harness or uses them as the
   reproduction, as happened on fix 3.

## Reproduce

```bash
npm run bot:test                                   # 99 unit tests, no network
./node_modules/.bin/tsc --noEmit
CORTARDO_BOT_MAX_COST_USD=0.50 CORTARDO_BOT_API_KEY=... \
  npm run bot:e2e:verify                           # live, publishes to PR 7
CORTARDO_BOT_DRY_RUN=1 CORTARDO_BOT_REPOSITORY_ID=... npm run bot:e2e:verify   # no writes
```

---

## Addendum — single-comment pipeline, fresh re-runs

Later single-comment runs on `2026-09-17` publish the review comment first and the suggestion
review second (`cortardo-bot-82a94878`: review `5718743257` at `17:41:57Z`, suggestion review
submitted `17:41:58Z`, 3/3 priority fixes verified, 4 inline suggestions, `$0.1937` of the
budget). An earlier single-comment run (`cortardo-bot-b6064a18`, review `5718483151`, 4/4
verified) predates the ordering change.

`2026-09-17` · run `cortardo-bot-b6064a18` · PR #7 head `74c5449d` · `CORTARDO_BOT_PROMPT_CACHE=0`
(provider cache entries cannot be purged through the API, so the run disables the
`prompt_cache_key` marker and pays full input price on cold prefixes).

Before the run all comments on PR 7 were deleted (3 issue comments, 3 review comments) and
the 13 old review bodies were minimized; codegraph is no longer published at all.

| Stage | Duration | Cost | Calls | Result |
| --- | ---: | ---: | --- | --- |
| hypotheses | 55.8s | $0.0449 | terra ×2 · luna ×14 | 7 findings, 4 critical/high |
| fixes | 31.6s | $0.1556 | terra ×3 · sol ×7 | 4 drafts, 3 filtered by severity |
| verify | 134.8s | $0.2372 | terra ×7 · sol ×7 | **4/4 verified, all reproduction** |

Final artifact: **one review comment** `5718483151` plus **5 inline suggestions** (all
`Cortardo Bot verified fix · high · 1 attempt(s)`); every fix verified on the first attempt. Total
`$0.2372` of the `$0.50` budget, cache-hit rate 34.7% (implicit prefix cache only).

### Loop hardening from the first single-comment run

The first fresh run exposed three autmpus gaps on `s_fd221b5523`, all fixed and unit-tested
before this re-run:

1. **Phantom probe commands.** Terra planned `node probe/verify-playground-model.mjs` without
   including the probe content, so the command failed `MODULE_NOT_FOUND` on every attempt.
   `parseVerifyPlan` now refuses commands that reference a `probe/...` file the plan does not
   include as a `probeFile`.
2. **Blind diagnosis.** Repair snapshots were read after `git checkout -f`, so terra diagnosed
   the pristine head and concluded the (already applied) edit was missing. Snapshots are now
   taken from the failed attempt's working tree before the reset.
3. **Harness-only repairs counted as unavailable.** When terra revised the harness but sol had
   no source edits, the loop gave up. It now keeps the existing edits and retries when the
   harness signature (commands, probe paths, reproductions) changed; `runVerifyRepair` also
   carries previous probe files forward when the repair response omits them.

### Final single-comment runs (PR 6 + PR 7)

Both runs used `CORTARDO_BOT_PROMPT_CACHE=0` after clearing every comment on each PR and
minimizing the old review bodies. The e2e asserts one review comment, suggestion tagging,
publish order (`review created_at <= suggestion review submitted_at`), the budget and that no
stale bot comments survive.

| PR | Run | Review | Result | Suggestions | Cost |
| --- | --- | --- | --- | ---: | ---: |
| #6 | `cortardo-bot-25ce8bec` | `5719139423` | 2/3 verified (compile) · the third unverified after 4 attempts, no suggestion posted | 3 | $0.4319 |
| #7 | `cortardo-bot-79fc7451` | `5719252190` | 3/3 verified (2 compile · 1 source check) | 4 | $0.4230 |

**Honest grading in practice.** The review header reports "0 ran the changed code" on both
runs: the client-only React changes could not be executed by the harness (no test suite and
no importable boundary), so the passes rest on `tsc`/source checks. That is exactly what the
review now says, and the unverified PR 6 fix was correctly withheld from the suggestions.

**Loop limitation found on PR 6.** Terra's repair planned a new helper module
(`client/src/pages/usage-period.ts`) that stage-3 codegen had not created. The engineer can
only emit find/replace edits on existing files, so the probe and `npm run check` failed on
every attempt and the fix ended `unverified` after 4 attempts. The plan and repair prompts now
state that edits replace existing text only and that a fix needing a new file must be folded
into an existing changed file or declared not fixable.
