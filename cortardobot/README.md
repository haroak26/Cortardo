# Cortado 2.0 — Fast Autonomous Code Review Engine

> **CortardoBot 3.2 lives in `src/v3/` and is the production path.** It adds an agentic
> read-only swarm, GPT-class model defaults, a tool-using repair agent, self-authored probes,
> strict fix-verification invariants, a multi-layer cache and a crash-safe run queue. See
> [`docs/cortardo-3.2.md`](../docs/cortardo-3.2.md) and
> [`docs/cortardo-3.1.md`](../docs/cortardo-3.1.md). The sections below describe the
> legacy 2.0 engine and its 1,048-case dry matrix.

Cortado is an agentic code review engine that does not just review code. It **investigates → proves → fixes → fails → understands why → fixes again → verifies**.

It is built on [LangGraph](https://langchain-ai.github.io/langgraphjs/) for a reliable, inspectable, customisable pipeline, and it runs **100% deterministically in dry mode** with zero AI API calls, which is what the 250-case dry test matrix exercises.

```
PR
 ↓
1. Change Intelligence   (no LLM)   classify, symbols, deps, risks
 ↓
2. Targeted Swarm        (Luna)     3–12 focused investigators
 ↓
3. Evidence Merge        (no LLM)   dedupe, corroborate, score
 ↓
4. Terra Judge           (Terra)    PROVE / STATIC_ONLY / DISCARD
 ↓
5. Proof                 (exec)     existing test → targeted test → probe → full env
 ↓
6. Repair Loop           (Terra)    understand → plan → patch → apply → test → diagnose → retry
 ↓
7. Verification          (exec)     reproduction → targeted → affected → typecheck → build
 ↓
8. Astra Final Review    (Astra)    validity, fix correctness, risk, approval
 ↓
Result                              markdown + structured JSON
```

## Quick start

```bash
cd cortardobot
npm install

# deterministic dry run (no AI calls, no processes spawned)
npm run bot -- --input ../pr.json

# run the 250-case end-to-end dry matrix
npm run dry

# run the 250-case exhaustive module suite
npm run exhaustive

# run the 287-case final adversarial/soak suite
npm run final

# run the 28-case hardening regression suite (live-mode bug fixes)
npm run hardening

# full test suite (1028 tests across all suites)
npm test
```

In dry mode the engine uses deterministic detectors to find planted defects and a
simulated repository (scriptable in-memory sandbox) to prove and repair them, so the
whole investigate → prove → fix → verify loop can be demonstrated without network
access. Live mode swaps in the real models and the real filesystem/subprocess sandbox.

`pr.json` describes a pull request:

```json
{
  "title": "Fix session ownership check",
  "body": "optional description",
  "files": [
    {
      "path": "server/auth/session.ts",
      "content": "<full head revision content>",
      "patch": "<optional unified diff>"
    }
  ],
  "repoRules": ["optional repository conventions"]
}
```

## Programmatic API

```ts
import { CortadoEngine, reviewPullRequest } from "./src/index";

const engine = new CortadoEngine({ mode: "dry" });
const result = await engine.run(pullRequest);

result.status;              // "completed" | "failed"
result.findings;            // confirmed/likely findings with proof + repair + review
result.repairs;             // VERIFIED | UNRESOLVED | UNSAFE | BUDGET_EXHAUSTED
result.summary;             // counts, duration, model calls, credits
result.markdown;            // human-readable report
result.usage;               // token + credit accounting
```

Dependency injection for tests and hosts:

```ts
new CortadoEngine({
  mode: "dry",
  sandbox,                          // custom Sandbox (Memory or Local)
  sandboxHandler,                   // dry-mode command handler
  commands: { test: "npx vitest run", testSingle: (f) => `npx vitest run ${f}` },
  models: { luna, terra, astra },   // custom ModelClient implementations
  repair: { maxAttempts: 3, maxTimeMs: 45_000, maxToolCalls: 12 },
  globalTimeoutMs: 180_000,
  logger, clock,
});
```

## Live mode

Live mode is enabled by `CORTADO_AI_API_KEY` (or `mode: "live"`):

```
CORTADO_AI_API_KEY=sk-...
CORTADO_AI_BASE_URL=https://api.openai.com/v1
CORTADO_MODEL_LUNA=gpt-5.6-luna
CORTADO_MODEL_TERRA=gpt-5.6-terra
CORTADO_MODEL_ASTRA=gpt-6-astra
```

Any OpenAI-compatible endpoint works. Without a key, the engine throws instead of silently making calls, and dry mode is used by default.

## Design guarantees

- **Hard swarm limits** — tiny 3, normal 8, complex 12 agents. No swarm explosion.
- **Strict agent contract** — max 2 hypotheses per agent, each with `file:line` evidence.
- **One Terra synthesis** — a single judge call decides what deserves proof.
- **Cheap-first proof** — existing test → targeted test → script probe → HTTP → browser → full environment.
- **Only confirmed findings enter repair** — static-only and disproven claims are reported, not "fixed".
- **Bounded repair** — `maxAttempts: 3`, `maxTimeMs: 45s`, `maxToolCalls: 12`, with explicit exit states.
- **Failure as data** — failed patches are diagnosed and the next attempt must change strategy.
- **Unsafe patches are rejected** — restricted paths (`.github/workflows`, `.env`, lockfiles), removed test assertions, destructive SQL.
- **Sandbox policy** — destructive shell commands are blocked (`rm -rf /`, `sudo`, `curl | bash`, force pushes, publishes).
- **Warm sandbox** — the sandbox is created in stage 1b and reused by every later stage; `sandbox.warmDependencies` can pre-install dependencies once (`npm ci --prefer-offline`) for live runs.
- **Deterministic dry mode** — same input produces the same candidates, decisions, proof results, repairs, reviews and markdown.

## Project layout

```
src/
  engine.ts                 public engine + reviewPullRequest
  cli.ts                    CLI entry (npm run bot)
  config.ts                 budgets, limits, pricing, defaults
  judge-policy.ts           deterministic judge policy (used as fallback too)
  result.ts                 result assembly + markdown report
  graph/
    state.ts                LangGraph annotation state
    pipeline.ts             StateGraph wiring + conditional routing + stage guards
  stages/
    change-intelligence.ts  Stage 1 (no LLM)
    swarm.ts                Stage 2 Luna agents
    evidence-merge.ts       Stage 3 (no LLM)
    judge.ts                Stage 4 Terra judge
    proof.ts                Stage 5 selective proof
    repair.ts               Stage 6–7 autonomous repair loop
    verify.ts               Stage 8 adaptive verification
    final-review.ts         Stage 9 Astra review
  models/
    dry.ts                  deterministic dry-run model (rule detectors + fixes)
    live.ts                 OpenAI-compatible client with retries
    router.ts               role routing + usage/credit accounting
  sandbox/
    memory.ts               in-memory sandbox with scriptable exec
    local.ts                real filesystem + subprocess sandbox
    dry-simulation.ts       deterministic exec handler for dry runs
    safety.ts               command + patch safety policy
  agents/
    detectors.ts            deterministic defect detectors and fixes
    roster.ts               swarm selection by classification and size
    contracts.ts            zod schemas for structured model output
    prompts.ts              strict JSON prompts
  util/                     diff engine, json extraction, clock, async, hashing
fixtures/prs.ts             10 PR fixtures used by the dry matrix
tests/
  dry/                      250-case end-to-end dry matrix (no network)
  exhaustive/               250-case module/edge/fuzz dry suite (no network)
  final/                    287-case adversarial/budget/soak dry suite (no network)
  hardening/                28-case live-mode/host-integration regression suite
  unit/                     module-level tests
  integration/              full-pipeline tests
scripts/
  run-dry.ts                standalone 250-case runner with pass/fail report
  run-exhaustive.ts         standalone exhaustive runner with group summary
  run-final.ts              standalone final runner with group summary
  run-hardening.ts          standalone hardening runner
  smoke.ts                  per-fixture inspection report
```

## Test matrix

Nothing here makes an AI call or touches the network. `fetch` is patched to throw in
every dry suite, and all models are deterministic.

### Suite 1 — end-to-end pipeline matrix (`npm run dry`)

The dry matrix is the Cartesian product of:

- **10 PR fixtures** — auth comparison, missing auth guard, SQL injection, XSS, hardcoded secret, off-by-one, unhandled rejection, N+1 awaits, breaking API signature, complex multi-defect PR.
- **5 proof behaviours** — confirm, no-repro, flaky, timeout, missing dependencies.
- **5 repair behaviours** — fix, wrong-layer (diagnosed retry), always-fail, unsafe patch, timeout/budget exhaustion.

`10 × 5 × 5 = 250` end-to-end dry tests that assert invariants for every run: stage coverage, decision uniqueness, proof/repair scoping, budgets, exit states, verification, review coverage, usage accounting, and no network access.

### Suite 2 — exhaustive module matrix (`npm run exhaustive`)

250 additional dry tests that probe every module, boundary and adversarial scenario:

| Group | Cases | Coverage |
| --- | --- | --- |
| `diff` | 52 | 40 seeded round-trip properties (CRLF, unicode, empty files, multi-hunk, no trailing newline) + 12 apply edge cases (missing files, shifted hunks, malformed headers, `/dev/null`) |
| `analysis` | 46 | all 11 detectors (detect + fix + false positive), all 10 fixtures, languages, routes, imports, risk signals, size/classification edges |
| `pipeline` | 56 | evidence merge (dedupe/score/cap), judge policy (budgets/bars/provable/downgrades), proof evaluation matrix, repair safety and exit states |
| `runtime` | 46 | memory + local sandbox lifecycle, command safety list, dry model behaviours, usage/credits, OpenAI-compatible client with an injected fake fetch (retry, error, timeout) |
| `engine` | 50 | engine overrides/timeouts/failure modes, deterministic runs, result assembly and markdown, util edge cases, seeded fuzz (random PRs, garbage patches/commands/JSON) |

### Suite 3 — final adversarial/soak matrix (`npm run final`)

287 additional dry tests targeting failure injection, budgets, transport, the CLI and
cross-run stability:

| Group | Cases | Coverage |
| --- | --- | --- |
| `cli` | 20 | argument parsing, help/usage, unreadable input, invalid JSON, markdown vs `--json` output, live-mode startup failure |
| `sandbox-failures` | 25 | injected faults in `setup/warm/read/write/exists/list/exec/applyPatch/snapshot/cleanup` and 15 fault combinations; the pipeline must degrade gracefully |
| `budgets` | 25 | every budget dimension (judge/proof/repair/verify/model calls/global timeout) exhausted and satisfied |
| `transport` | 25 | OpenAI-compatible client request shape, retries for 429/503/network errors, non-retryable 401/404, timeouts, missing usage, router limits |
| `result-permutations` | 20 | every proof status × repair exit combination mapped to tags, approvals and summaries |
| `detectors-deep` | 30 | fix idempotence, unrelated-content preservation, detection behind prefixes for all 11 detectors |
| `intelligence-deep` | 32 | exact multi-hunk line numbers, symbol/import/risk/classification boundaries, id stability |
| `consistency` | 40 | 10 fixtures × 4 behaviour pairs with full cross-module invariants on every run |
| `soak` | 30 | repeat/triple/interleaved runs must produce byte-identical markdown, summaries and decisions |
| `pipeline-deep` | 40 | merge/judge/proof/safety edge matrices |

### Suite 4 — hardening regressions (`npm run hardening`)

28 dry tests covering bugs found in live-mode and host-integration code review
(each of these produced a code fix):

- sandbox cleanup must never delete a host-supplied root;
- executed commands must not receive host secrets (`PATH` only allowlist);
- default per-model timeout so hung calls cannot burn credits;
- `/dev/null` new-file and deletion patches apply;
- patch paths escaping the repository are rejected;
- evidence normalization accepts `file:line`, ranges, columns and backticked paths;
- test discovery must not match substrings (`a.ts` must not select `data.test.ts`);
- judge prompts document the `CORTADO_VULNERABLE`/`CORTADO_SAFE` probe contract;
- warm dependency installs require `allowNetwork`;
- engines preserve a host-supplied sandbox root.

```bash
npm run dry          # 250/250 passed in ~2s
npm run exhaustive   # 250/250 passed in ~1s
npm run final        # 287/287 passed in ~3s
npm run hardening    # 28/28 passed in ~0.2s
npm test             # 1028/1028 tests: unit + integration + all dry suites
npm run typecheck    # strict TypeScript, no errors
```
