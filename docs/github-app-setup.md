# GitHub App Setup

Cortardo uses a GitHub App (not an OAuth App) so it acts as `cortardo[bot]` with
installation-scoped tokens. Users install the app on the repositories they
choose; Cortardo never needs a long-lived personal access token.

## 1. Create the GitHub App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
   (<https://github.com/settings/apps/new>).
2. **Name**: `Cortardo` (or anything unique), **Homepage URL**: your Cortardo URL.
3. **Webhook**: check *Active*, set **Webhook URL** to
   `{PUBLIC_URL}/api/webhooks/github` and generate a **Webhook secret**.
4. **Setup URL** (under *Post installation*): `{PUBLIC_URL}/api/github/setup`
   and enable **Redirect on update**.
5. **Repository permissions**:
   - Metadata — Read (mandatory)
   - Contents — Read (diffs and file context for the codegraph)
   - Pull requests — Read & write (view PRs and submit reviews with inline comments)
   - Issues — Read & write (create issues and comments)
6. **Subscribe to events**:
   - Installation
   - Installation repositories
   - Pull request
7. *Where can this GitHub App be installed?* — Any account (or Only on this
   account for private deployments).
8. Create the app, then **Generate a private key** (`.pem`).

## 2. Configure the server

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=cortardo
GITHUB_APP_NAME=Cortardo
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<the secret from step 1>
```

The private key may contain literal `\n` sequences — they are normalized at
runtime. Restart the server after setting these.

Local development: GitHub cannot reach `localhost`, so expose the webhook via a
tunnel (e.g. `smee.io` or `ngrok`) and point the app's Webhook URL and Setup URL
at the tunnel host.

## 3. How the flow works

1. **Install** — The user opens *Account → Integrations → GitHub* (or
   *Repositories → Connect repo*) while signed in. The server signs a state
   token in an httpOnly cookie and redirects to
   `https://github.com/apps/{slug}/installations/new`.
2. **Setup callback** — GitHub redirects to `/api/github/setup` with
   `installation_id` + `state`. The server validates the state, verifies the
   installation with an app JWT, links it to the workspace, and syncs the
   repository list.
3. **Webhooks** — `/api/webhooks/github` verifies `X-Hub-Signature-256`
   against the raw body, records the delivery idempotently, then:
   - `pull_request` upserts the pull request;
   - `installation_repositories` re-syncs the repo list;
   - `installation` (`deleted`, `suspend`, `unsuspend`) updates or removes the
     local link.

## 4. Repository actions

All repository actions require workspace membership and a linked installation:

| Endpoint | Action |
| --- | --- |
| `GET /api/repositories/:id/pulls` | list synced pull requests (`?refresh=true&state=open`) |
| `GET /api/repositories/:id/pulls/:number` | view a PR and its changed files |
| `POST /api/repositories/:id/pulls/:number/reviews` | submit a review with inline comments |
| `POST /api/repositories/:id/issues` | create an issue |
| `POST /api/repositories/:id/issues/:number/comments` | comment on an issue or PR |

## 5. Operational notes

- Installation tokens are short-lived (1 hour) and refreshed automatically by
  `@octokit/auth-app`; clients are cached per installation.
- Removing a repository from the installation (or unlinking the installation)
  cascades to its pull requests.
