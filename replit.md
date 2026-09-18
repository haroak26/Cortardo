# Cortardo

AI-powered code review workspace — connect repositories and review pull requests for bugs, security issues, and style drift. **Cortardo Bot** is the staged review agent (`bot/`): stage 1 (codegraph) publishes one marker-tagged PR comment describing the code graph of the files changed in the diff; stage 2 (hypotheses) publishes one comment with unproven, mechanism-level advisories produced by deterministic diff/graph rules plus a coordinator (terra) that plans assignments, a parallel luna swarm that reads the repo with read-only tools, and a coordinator synthesis; stage 3 (fixes) drafts patches for the priority severities (critical/high); stage 4 (verify, the autmpus loop) clones the PR head into an E2B sandbox, installs, applies each draft, runs terra's harness and repairs failures with sol (≤4 attempts, typically 1-2); the pipeline then publishes exactly one review comment (findings, fix statuses, collapsed verification log) with one native GitHub suggestion per verified fix, and codegraph is internal only. Model settings use `CORTADO_AI_*` plus `CORTARDO_BOT_MODEL` / `CORTARDO_BOT_SWARM_MODEL` / `CORTARDO_BOT_CODEGEN_MODEL`; `CORTARDO_BOT_NO_MODEL=1` runs deterministic-only and `CORTARDO_BOT_MAX_COST_USD` (default 0.50) caps the run. See `docs/cortardo-bot.md`. The legacy CortardoBot review engine and its `server/lib/review/` integration have been removed; engine 3.4 and earlier remain in git (`cortardo-3.4-baseline` tag).

## Architecture

- **Backend**: Express + TypeScript (`server/`)
- **Frontend**: React + Vite + TanStack Query + Wouter (`client/`)
- **Database**: PostgreSQL via Drizzle ORM (`shared/schema.ts`)
- **Auth**: Passport.js (local + Google OAuth)
- **Email**: Resend (primary) via `server/resend.ts`, Brevo (fallback) via `server/brevo.ts`, and local SMTP fallback

## Key Features

- **GitHub App integration**: install the app on repositories, sync them per workspace, browse pull requests, submit reviews, comment, and open issues. Setup guide: `docs/github-app-setup.md`.
- Real-time collaborative review workspace (inline comments, shared threads)
- Review rules and conventions surfaced in sidebar panels
- Findings / Components / Assets sidebar panels
- Team workspaces with role-based access
- Credit-based billing (Stripe / Paddle) with per-run usage settling
- Rate limiting on all auth endpoints via `authRateLimiter`
- **Timestamps are emitted as UTC ISO 8601** (`...Z`) from the server. `server/db.ts` overrides pg type parsers (OID 1114 → append Z, 1184 → as-is) and pins each connection to `SET TIME ZONE 'UTC'`.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — Express session secret
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — SMTP fallback email (optional; logs links to console if neither Resend nor SMTP is set)
- `RESEND_API_KEY` — Resend transactional email API key (primary email provider)
- `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` — Resend sender details
- `BREVO_API_KEY` — Brevo transactional email API key (fallback provider)
- `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` — Verified Brevo sender details
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth (optional)
- `GITHUB_APP_ID` — GitHub App id
- `GITHUB_APP_SLUG` — GitHub App slug (used to build the install URL)
- `GITHUB_APP_NAME` — display name (optional)
- `GITHUB_APP_PRIVATE_KEY` — PEM private key; literal `\n` sequences are normalized
- `GITHUB_WEBHOOK_SECRET` — HMAC secret for `X-Hub-Signature-256` verification
- `ENCRYPTION_KEY` — 32-byte hex key used to encrypt stored email credentials at rest
- `STRIPE_SECRET_KEY` — Stripe billing (required for paid plans)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (required for plan sync)

## Database Schema

See `shared/schema.ts`. Key tables:
- `users` — auth, email verification, email change, password reset tokens
- `workspaces` — team organization
- `projects` — design projects (`kind` = `cortardo`)
- `github_installations` — GitHub App installs linked to a workspace
- `repositories` — connected repos with per-repo `reviewEnabled`
- `pull_requests` — PRs synced from webhooks / the GitHub API
- `repository_codegraphs` / `repository_code_files` — code graph used as review context
- `webhook_deliveries` — idempotent GitHub webhook log

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
