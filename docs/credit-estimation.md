# Credit Estimation for Cortardo Agent Runs

## Overview

Every Cortardo Agent run consumes credits. Before starting, the server estimates the cost, checks the user's balance, and places a hold. After completion, the hold is released against the **actual measured cost** (token counts reported by the gateway).

## Core Formula

```
1 credit = $0.001 USD of AI API usage (see server/lib/pricing.ts)
credits = costInDollars × 1000
```

Minimum balance to start a run: **5 credits** (hard floor).

## Model Routing

The agent uses a cheap default model (`zai/glm-5.3`, override with `CORTARDO_MODEL` /
`CORTARDO_TITLE_MODEL`) for clarify, planning, and artifact generation. All calls go through
Merge Gateway (`server/lib/cortardo/gateway.ts`), which reports real token usage per call.

| Stage | What it does | Where |
|-------|--------------|-------|
| clarify | Chat title + 3 clarification questions | `server/lib/cortardo/clarify.ts` |
| plan | Streamed reasoning + plan shown while the run starts | `server/lib/cortardo/gateway.ts` |
| artifacts | Screens, design tokens, assets proposals | `server/lib/cortardo/artifacts.ts` |

## Flow

```
User submits a brief
  → POST /api/cortardo-agent/runs { prompt, projectId }
  → create run (status: thinking), return { runId }

Run progresses (SSE at /api/cortardo-agent/runs/:runId/events):
  → reasoning stream → questions → user answers → screens/tokens/assets

Run completes:
  → status: done, artifacts persisted in cortardo_agent_runs
  → usage settles against the workspace credit budget (see credit-service)
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Balance below floor | Run rejected with a credit error |
| Workspace budget exceeded | Run rejected until budget resets |
| Run fails mid-way | Status: error; consumed usage still settles |
| Model returns invalid JSON | Stage retried/fails gracefully with a user-facing error |
