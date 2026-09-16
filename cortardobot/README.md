# CortardoBot 3.5 — Reproduce, Fix, Verify

Autonomous code review engine. One rule drives everything:

> **A claim is not a finding until a script fails because of it, and a fix is
> not a fix until a clean sandbox replays it.**

See [`docs/cortardo-3.5.md`](../docs/cortardo-3.5.md) for the full handoff.
Engine 3.4 and earlier are preserved in git (tag `cortardo-3.4-baseline`,
[`docs/cortardo-3.4.md`](../docs/cortardo-3.4.md)).

## Pipeline

```
plan        diff parse, context index, impact slice, capability detection   (free)
investigate specialized investigators in parallel (bug, regression, ui,
            security, api, runtime) — each must read the real code and ship
            a reproduction script that fails twice
fix         up to 3 attempts per reproduced finding in one E2B sandbox;
            failed attempts get a diagnosis and a context-refresh swarm
verify      fresh sandbox, untouched head + patch, reproduction twice,
            typecheck/tests, then an independent reviewer agent
report      coverage + verdict; the server publishes the review and check
```

Runtime exercise (UI/API/CLI) runs through the same gate: deterministic
scenarios seeded from the diff, agent-authored browser/HTTP repros, and a
base-vs-head comparison so only regressions introduced by the PR can block.

## Roles

Three plain model roles, configurable in the app:

| Role | Default | Job |
| --- | --- | --- |
| `investigator` | `openai/gpt-5.6-luna` | reads code, authors and runs reproductions |
| `engineer` | `openai/gpt-6-astra` | fixes the defect against the failing script |
| `reviewer` | `openai/gpt-5.6-sol` | independent verification and final report |

## Commands

```bash
npm run verify:3.5    # typecheck + engine test suite (no network, no E2B)
npm test              # same engine test suite
```

Live end-to-end (real gateway, real E2B, real GitHub publish) is run from the
workspace root against any repository and pull request:

```bash
node --import tsx scripts/e2e/live-3.5.mts --repo owner/name --pr 42 --strict
node --import tsx scripts/e2e/live-3.5.mts --list          # connected repositories
```

## Layout

```
src/
  engine.ts        orchestrator (soft budgets, events, result assembly)
  artifact.ts      reproduction artifact runner (setup → script ×N → teardown)
  agent/           one loop, one tool registry, role prompts
  context/         code graph index, impact slice, runtime capability probe
  stages/          plan · investigate · fix · verify · report
  sandbox-e2b.ts   E2B adapter (clone, install, exec, dev server)
  sandbox-memory.ts deterministic sandbox for tests
tests/engine/      deterministic gate suite
scripts/verify-3.5.ts
```
