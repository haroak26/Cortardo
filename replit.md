# Cortardo

AI-powered code review tool — connect a repository, and the Cortardo Agent reviews every pull request for bugs, security issues, and style drift.

## Architecture

- **Backend**: Express + TypeScript (`server/`)
- **Frontend**: React + Vite + TanStack Query + Wouter (`client/`)
- **Database**: PostgreSQL via Drizzle ORM (`shared/schema.ts`)
- **Auth**: Passport.js (local + Google OAuth)
- **Email**: Resend (primary) via `server/resend.ts`, Brevo (fallback) via `server/brevo.ts`, and local SMTP fallback
- **AI**: Merge Gateway (`merge-gateway-sdk`) — powers the Cortardo Agent (`server/lib/cortardo/`, `server/routes/cortardo-agent.ts`)

## Key Features

- **Cortardo Agent**: automated code review (clarify → plan → findings/summaries/fixes)
- Real-time collaborative review workspace (inline comments, shared threads)
- Review rules and conventions surfaced in sidebar panels
- Findings / Components / Assets sidebar panels
- Team workspaces with role-based access
- Credit-based billing (Stripe / Paddle) with per-run usage settling
- Rate limiting on all auth endpoints via `authRateLimiter`
- **Timestamps are emitted as UTC ISO 8601** (`...Z`) from the server. `server/db.ts` overrides pg type parsers (OID 1114 → append Z, 1184 → as-is) and pins each connection to `SET TIME ZONE 'UTC'`.

## Cortardo Agent

Agent backend in `server/lib/cortardo/` with routes in `server/routes/cortardo-agent.ts`:

- **Clarify** (`clarify.ts`): chat-title generation + EXACTLY 3 clarification questions (cheap model, background).
- **Plan** (`gateway.ts`): streamed reasoning + plan shown while the run starts.
- **Artifacts** (`artifacts.ts`): review areas, rules, and reusable check-module proposal (structured JSON via `completeJSON`).
- **Runs** are persisted in the `cortardo_agent_runs` table (`shared/schema.ts`); live progress via SSE at
  `GET /api/cortardo-agent/runs/:runId/events`; answers posted to `/api/cortardo-agent/runs/:runId/answers`.
- **Cost**: gateway reports actual usage; runs settle against measured tokens (see `server/lib/pricing.ts`).

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — Express session secret
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — SMTP fallback email (optional; logs links to console if neither Resend nor SMTP is set)
- `RESEND_API_KEY` — Resend transactional email API key (primary email provider)
- `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` — Resend sender details
- `BREVO_API_KEY` — Brevo transactional email API key (fallback provider)
- `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` — Verified Brevo sender details
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth (optional)
- `ENCRYPTION_KEY` — 32-byte hex key used to encrypt stored email credentials at rest
- `STRIPE_SECRET_KEY` — Stripe billing (required for paid plans)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (required for plan sync)
- `MERGE_GATEWAY_API_KEY` — AI gateway powering the Cortardo Agent
- `CORTARDO_MODEL`, `CORTARDO_TITLE_MODEL` — model overrides (default `google/gemini-3.7-flash`; must be a model available on the gateway via `GET /v1/models`)
- `CORTARDO_GATEWAY_TIMEOUT_MS` — per-call HTTP timeout (default 300000)
- `CORTARDO_MERGE_GATEWAY_TAG_<ROLE>` / `CORTARDO_MERGE_GATEWAY_TAG_KEY` / `CORTARDO_MERGE_GATEWAY_TAG_VALUE` — gateway analytics tags

## Database Schema

See `shared/schema.ts`. Key tables:
- `users` — auth, email verification, email change, password reset tokens
- `workspaces` — team organization
- `projects` — design projects (`kind` = `cortardo`)
- `cortardo_agent_runs` — agent runs: prompt, questions, answers, reasoning, plan, findings, rules, checks

## Important Notes

- `SafeUser` type omits all sensitive fields: password, tokens, expiry dates, reset tokens
- Cards use `bg-background` (not `bg-white`) for dark mode compatibility
- Landing page prompt is carried to the app via `sessionStorage["cortardo-landing-prompt"]` (prefilled in `HomePage`); `sessionStorage["cortardo-prompt"]` remains the canvas handoff key.

## Running

```bash
npm run dev       # Start development server (Express + Vite on port 5000)
npm run db:push   # Sync schema to database
npm run db:migrate  # Run pending migrations
```
