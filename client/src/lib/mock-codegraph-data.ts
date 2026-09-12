/* Mock codegraph data for the "Diagnose Error" experience.
   Every repository is modelled as one block per file plus import edges, so the
   UI can be exercised end-to-end before the real codegraph and Cortardo Bot
   endpoints are wired. Swap `buildMockCodeGraph` / `getDiagnosisScenario` for
   the live hooks when the graph API lands. */

import { findings, type MockFindingDetail, type SeverityKey } from './mock-review-data';

export type GraphFileStatus = 'idle' | 'searching' | 'affected' | 'editing' | 'fixed';
export type CodeFileKind = 'source' | 'test' | 'config' | 'docs';
export type ConnectionKind = 'imports' | 'calls' | 'types';

export interface CodeGraphFile {
  /** Stable id — the repo-relative path. */
  id: string;
  path: string;
  name: string;
  dir: string;
  language: string;
  kind: CodeFileKind;
  loc: number;
  entry?: boolean;
  hub?: boolean;
}

export interface CodeGraphConnection {
  source: string;
  target: string;
  kind: ConnectionKind;
}

export interface MockCodeGraph {
  repository: string;
  files: CodeGraphFile[];
  connections: CodeGraphConnection[];
}

export interface DiagnosisAffectedFile {
  fileId: string;
  note: string;
  root?: boolean;
}

export interface DiagnosisFixedFile {
  fileId: string;
  note: string;
  patch: string;
}

export interface DiagnosisScenario {
  repository: string;
  title: string;
  prNumber: number;
  severity: SeverityKey;
  rootFileId: string;
  summary: string;
  findings: MockFindingDetail[];
  /** File ids the scanner walks, in order (turn blue). */
  searchOrder: string[];
  /** Files the bot believes are impacted (turn red). */
  affected: DiagnosisAffectedFile[];
  /** Files the bot generated a fix for (turn green). */
  fixed: DiagnosisFixedFile[];
  phaseMs: { scan: number; impact: number; fix: number };
}

/* ── Repository specs ──────────────────────────────────────────────── */

interface RepoSpec {
  root: string[];
  dirs: Record<string, string[]>;
  overrides: Array<[string, string]>;
}

const PAYMENTS_API: RepoSpec = {
  root: ['package.json', 'tsconfig.json', 'drizzle.config.ts', 'Dockerfile', 'README.md'],
  dirs: {
    src: ['index.ts', 'app.ts', 'config.ts'],
    'src/checkout': [
      'capture.ts',
      'create.ts',
      'idempotency.ts',
      'totals.ts',
      'cart.ts',
      'discounts.ts',
      'line-items.ts',
      'tax.ts',
      'pricing.ts',
      'session.ts',
      'types.ts',
    ],
    'src/refunds': ['amount.ts', 'create.ts', 'worker.ts', 'ledger.ts', 'types.ts'],
    'src/webhooks': ['receiver.ts', 'verify.ts', 'dispatch.ts', 'events.ts'],
    'src/webhooks/handlers': ['charge.ts', 'refund.ts', 'dispute.ts'],
    'src/payments': ['gateway.ts', 'psp.ts', 'cards.ts', 'methods.ts'],
    'src/auth': ['session.ts', 'tokens.ts', 'middleware.ts', 'password.ts', 'oauth.ts'],
    'src/http': ['client.ts', 'cache.ts', 'retry.ts', 'errors.ts', 'request-id.ts'],
    'src/db': ['index.ts', 'schema.ts', 'migrations.ts'],
    'src/db/queries': ['charges.ts', 'refunds.ts', 'customers.ts', 'idempotency.ts', 'invoices.ts'],
    'src/queue': ['producer.ts', 'consumer.ts'],
    'src/queue/jobs': ['capture.ts', 'refund.ts', 'reconcile.ts'],
    'src/payout': ['worker.ts', 'batch.ts', 'schedule.ts'],
    'src/notifications': ['email.ts', 'templates.ts', 'webhook.ts'],
    'src/observability': ['traces.ts', 'logs.ts', 'alerts.ts'],
    'src/lib': [
      'money.ts',
      'logger.ts',
      'crypto.ts',
      'result.ts',
      'date.ts',
      'validation.ts',
      'errors.ts',
      'metrics.ts',
      'flags.ts',
      'config.ts',
    ],
    'src/types': ['index.ts', 'domain.ts', 'api.ts'],
    'src/routes': ['checkout.ts', 'refunds.ts', 'webhooks.ts', 'admin.ts', 'health.ts'],
    'test/checkout': ['capture.test.ts', 'totals.test.ts', 'idempotency.test.ts'],
    'test/refunds': ['amount.test.ts', 'create.test.ts'],
    'test/webhooks': ['verify.test.ts', 'receiver.test.ts'],
    'test/auth': ['session.test.ts'],
    'test/http': ['retry.test.ts'],
    'test/integration': ['checkout-flow.test.ts', 'webhook-flow.test.ts'],
    'test/helpers': ['fixtures.ts', 'server.ts'],
    scripts: ['seed.ts', 'backfill.ts', 'rotate-keys.ts'],
  },
  overrides: [
    ['src/checkout/capture.ts', 'src/checkout/idempotency.ts'],
    ['src/checkout/capture.ts', 'src/db/queries/charges.ts'],
    ['src/checkout/capture.ts', 'src/lib/money.ts'],
    ['src/checkout/capture.ts', 'src/http/errors.ts'],
    ['src/checkout/idempotency.ts', 'src/db/queries/idempotency.ts'],
    ['src/queue/jobs/capture.ts', 'src/checkout/capture.ts'],
    ['src/queue/jobs/capture.ts', 'src/checkout/idempotency.ts'],
    ['src/refunds/amount.ts', 'src/lib/money.ts'],
    ['src/refunds/amount.ts', 'src/checkout/capture.ts'],
    ['src/refunds/create.ts', 'src/refunds/amount.ts'],
    ['src/webhooks/receiver.ts', 'src/webhooks/verify.ts'],
    ['src/webhooks/receiver.ts', 'src/checkout/capture.ts'],
    ['src/routes/checkout.ts', 'src/checkout/capture.ts'],
    ['src/routes/checkout.ts', 'src/http/errors.ts'],
    ['src/checkout/totals.ts', 'src/lib/money.ts'],
    ['src/checkout/totals.ts', 'src/checkout/line-items.ts'],
    ['src/index.ts', 'src/app.ts'],
    ['src/app.ts', 'src/config.ts'],
    ['src/app.ts', 'src/db/index.ts'],
  ],
};

const LEDGER: RepoSpec = {
  root: ['package.json', 'tsconfig.json', 'drizzle.config.ts', 'Dockerfile', 'README.md'],
  dirs: {
    src: ['index.ts', 'app.ts', 'config.ts'],
    'src/accounts': ['service.ts', 'balance.ts', 'types.ts'],
    'src/transfers': ['create.ts', 'settle.ts', 'worker.ts', 'types.ts'],
    'src/payout': ['worker.ts', 'batch.ts', 'schedule.ts', 'provider.ts'],
    'src/reports': ['query.ts', 'totals.ts', 'export.ts', 'types.ts'],
    'src/db': ['index.ts', 'schema.ts'],
    'src/db/queries': ['accounts.ts', 'transfers.ts', 'reports.ts'],
    'src/queue': ['producer.ts', 'consumer.ts'],
    'src/queue/jobs': ['settle.ts', 'reconcile.ts'],
    'src/http': ['client.ts', 'retry.ts', 'errors.ts'],
    'src/lib': ['money.ts', 'logger.ts', 'dates.ts', 'result.ts', 'config.ts'],
    'src/types': ['domain.ts', 'api.ts'],
    'src/routes': ['accounts.ts', 'transfers.ts', 'payouts.ts', 'reports.ts'],
    'src/notifications': ['email.ts', 'templates.ts'],
    test: ['setup.ts'],
    'test/accounts': ['balance.test.ts'],
    'test/transfers': ['settle.test.ts'],
    'test/payout': ['worker.test.ts'],
    'test/reports': ['query.test.ts'],
    'test/helpers': ['fixtures.ts'],
  },
  overrides: [
    ['src/payout/worker.ts', 'src/payout/provider.ts'],
    ['src/payout/worker.ts', 'src/db/queries/transfers.ts'],
    ['src/payout/worker.ts', 'src/http/retry.ts'],
    ['src/payout/worker.ts', 'src/queue/producer.ts'],
    ['src/payout/batch.ts', 'src/payout/worker.ts'],
    ['src/queue/jobs/settle.ts', 'src/payout/worker.ts'],
    ['src/queue/consumer.ts', 'src/queue/jobs/settle.ts'],
    ['src/transfers/worker.ts', 'src/transfers/settle.ts'],
    ['src/reports/query.ts', 'src/db/queries/reports.ts'],
    ['src/reports/totals.ts', 'src/lib/money.ts'],
    ['src/routes/reports.ts', 'src/reports/query.ts'],
    ['src/http/errors.ts', 'src/lib/logger.ts'],
    ['src/index.ts', 'src/app.ts'],
    ['src/app.ts', 'src/db/index.ts'],
  ],
};

const WEB: RepoSpec = {
  root: ['package.json', 'tsconfig.json', 'next.config.ts', 'Dockerfile', 'README.md'],
  dirs: {
    src: ['index.ts', 'app.ts', 'config.ts'],
    'src/auth': ['session.ts', 'tokens.ts', 'middleware.ts', 'password.ts', 'oauth.ts', 'types.ts'],
    'src/routes': ['auth.ts', 'pricing.ts', 'account.ts', 'checkout.ts'],
    'src/http': ['client.ts', 'cache.ts', 'errors.ts', 'retry.ts'],
    'src/lib': ['logger.ts', 'crypto.ts', 'config.ts', 'result.ts', 'dates.ts'],
    'src/pages': ['index.ts', 'pricing.ts', 'account.ts', 'login.ts'],
    'src/db': ['index.ts', 'schema.ts'],
    'src/db/queries': ['users.ts', 'sessions.ts'],
    'src/emails': ['send.ts', 'templates.ts'],
    'src/components': ['pricing.ts', 'account.ts', 'nav.ts', 'form.ts'],
    test: ['setup.ts'],
    'test/auth': ['session.test.ts', 'tokens.test.ts'],
    'test/http': ['cache.test.ts'],
    'test/routes': ['pricing.test.ts'],
    'test/helpers': ['fixtures.ts'],
  },
  overrides: [
    ['src/auth/session.ts', 'src/db/queries/sessions.ts'],
    ['src/auth/session.ts', 'src/http/cache.ts'],
    ['src/auth/session.ts', 'src/lib/crypto.ts'],
    ['src/auth/tokens.ts', 'src/db/queries/sessions.ts'],
    ['src/auth/middleware.ts', 'src/auth/session.ts'],
    ['src/routes/auth.ts', 'src/auth/session.ts'],
    ['src/routes/auth.ts', 'src/auth/tokens.ts'],
    ['src/routes/account.ts', 'src/auth/middleware.ts'],
    ['src/auth/oauth.ts', 'src/auth/tokens.ts'],
    ['src/pages/account.ts', 'src/http/cache.ts'],
    ['src/emails/send.ts', 'src/lib/logger.ts'],
    ['src/index.ts', 'src/app.ts'],
    ['src/app.ts', 'src/db/index.ts'],
  ],
};

const SPECS: Record<string, RepoSpec> = {
  'acme/payments-api': PAYMENTS_API,
  'acme/ledger': LEDGER,
  'acme/web': WEB,
};

/* ── Deterministic helpers ─────────────────────────────────────────── */

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function languageOf(name: string): string {
  if (name.endsWith('.tsx')) return 'tsx';
  if (name.endsWith('.ts')) return 'typescript';
  if (name.endsWith('.js')) return 'javascript';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml';
  if (name.endsWith('.sql')) return 'sql';
  if (name.endsWith('.css')) return 'css';
  if (name === 'Dockerfile') return 'docker';
  return 'text';
}

function kindOf(path: string): CodeFileKind {
  if (path.startsWith('test/') || path.endsWith('.test.ts') || path.endsWith('.test.tsx')) return 'test';
  if (path.endsWith('.md')) return 'docs';
  if (/\.(json|ya?ml)$/.test(path) || path === 'Dockerfile' || path.endsWith('.config.ts')) return 'config';
  return 'source';
}

const ENTRY_FILES = new Set(['src/index.ts', 'src/app.ts', 'src/server.ts', 'src/main.ts', 'src/main.tsx']);
const HUB_FILES = new Set([
  'src/db/index.ts',
  'src/lib/logger.ts',
  'src/lib/config.ts',
  'src/types/index.ts',
  'src/http/client.ts',
  'src/queue/producer.ts',
]);

function buildFiles(spec: RepoSpec): CodeGraphFile[] {
  const paths: string[] = [...spec.root];
  for (const [dir, names] of Object.entries(spec.dirs)) {
    for (const name of names) paths.push(`${dir}/${name}`);
  }
  return paths.map((path) => {
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const dir = segments.length > 1 ? segments.slice(0, -1).join('/') : '.';
    const loc = 18 + (hashString(path) % 380);
    return {
      id: path,
      path,
      name,
      dir,
      language: languageOf(name),
      kind: kindOf(path),
      loc,
      entry: ENTRY_FILES.has(path) || undefined,
      hub: HUB_FILES.has(path) || undefined,
    };
  });
}

interface WeightedCandidate {
  id: string;
  weight: number;
}

function pickWeighted(candidates: WeightedCandidate[], count: number, rand: () => number): string[] {
  const pool = candidates.slice();
  const picked: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const total = pool.reduce((sum, c) => sum + c.weight, 0);
    let roll = rand() * total;
    let index = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j].weight;
      if (roll <= 0) {
        index = j;
        break;
      }
    }
    picked.push(pool[index].id);
    pool.splice(index, 1);
  }
  return picked;
}

function buildConnections(repo: string, files: CodeGraphFile[], spec: RepoSpec): CodeGraphConnection[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const list = byDir.get(file.dir) ?? [];
    list.push(file.id);
    byDir.set(file.dir, list);
  }
  const coreFiles = files.filter(
    (file) =>
      file.id === 'src/config.ts' ||
      ['src/lib', 'src/types', 'src/db', 'src/http', 'src/queue'].some((dir) =>
        file.id.startsWith(`${dir}/`),
      ),
  );

  const edges = new Map<string, CodeGraphConnection>();
  const add = (source: string, target: string, kind: ConnectionKind = 'imports') => {
    if (source === target || !byId.has(source) || !byId.has(target)) return;
    edges.set(`${source}→${target}`, { source, target, kind });
  };

  for (const [source, target] of spec.overrides) add(source, target);

  const rand = mulberry32(hashString(repo) ^ 0x9e3779b9);
  for (const file of files) {
    if (file.kind === 'config' || file.kind === 'docs') continue;
    const count = file.kind === 'test' ? 1 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3);
    const candidates: WeightedCandidate[] = [];

    for (const sibling of byDir.get(file.dir) ?? []) {
      if (sibling !== file.id) candidates.push({ id: sibling, weight: 3 });
    }
    if (file.dir !== '.') {
      const indexFile = `${file.dir}/index.ts`;
      if (byId.has(indexFile) && indexFile !== file.id) candidates.push({ id: indexFile, weight: 2 });
    }
    for (const core of coreFiles) {
      if (core.id !== file.id) candidates.push({ id: core.id, weight: 1 });
    }
    if (file.kind === 'test' || file.dir.startsWith('test/')) {
      for (const source of files) {
        if (source.kind === 'source' && source.dir !== '.') candidates.push({ id: source.id, weight: 1 });
      }
    }

    const unique = new Map<string, WeightedCandidate>();
    for (const candidate of candidates) {
      const existing = unique.get(candidate.id);
      if (existing) existing.weight += candidate.weight;
      else unique.set(candidate.id, { ...candidate });
    }
    for (const target of pickWeighted([...unique.values()], count, rand)) add(file.id, target);
  }

  return [...edges.values()];
}

const graphCache = new Map<string, MockCodeGraph>();

export function buildMockCodeGraph(repository: string): MockCodeGraph {
  const cached = graphCache.get(repository);
  if (cached) return cached;

  const spec = SPECS[repository] ?? PAYMENTS_API;
  const files = buildFiles(spec);
  const connections = buildConnections(repository, files, spec);
  const graph: MockCodeGraph = { repository, files, connections };
  graphCache.set(repository, graph);
  return graph;
}

function searchOrderFor(graph: MockCodeGraph, rootFileId: string): string[] {
  const adjacency = new Map<string, string[]>();
  for (const { source, target } of graph.connections) {
    adjacency.set(source, [...(adjacency.get(source) ?? []), target]);
    adjacency.set(target, [...(adjacency.get(target) ?? []), source]);
  }

  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [rootFileId];
  seen.add(rootFileId);
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    const neighbours = (adjacency.get(current) ?? []).slice().sort();
    for (const neighbour of neighbours) {
      if (!seen.has(neighbour)) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }

  const rest = graph.files
    .filter((file) => file.kind === 'source' || file.kind === 'test')
    .map((file) => file.id)
    .filter((id) => !seen.has(id))
    .sort();
  return [...order, ...rest];
}

/* ── Diagnosis scenarios ───────────────────────────────────────────── */

function findingsFor(repository: string): MockFindingDetail[] {
  return findings.filter((finding) => finding.repository === repository);
}

function paymentsScenario(repository: string): DiagnosisScenario {
  const graph = buildMockCodeGraph(repository);
  return {
    repository,
    title: 'Race condition in the new checkout path',
    prNumber: 479,
    severity: 'critical',
    rootFileId: 'src/checkout/capture.ts',
    summary:
      'Two concurrent capture requests can both pass the idempotency check before either persists its key, so the provider captures twice. The bot followed the guard through the capture route, the queue job and the idempotency store, then generated a fix that claims the key atomically inside the transaction.',
    findings: findingsFor(repository),
    searchOrder: searchOrderFor(graph, 'src/checkout/capture.ts'),
    affected: [
      { fileId: 'src/checkout/capture.ts', root: true, note: 'Guard reads the key before it is persisted — root cause.' },
      { fileId: 'src/checkout/idempotency.ts', note: 'Key is written after capture instead of claimed up-front.' },
      { fileId: 'src/db/queries/idempotency.ts', note: 'Upsert has a read-then-write window under concurrency.' },
      { fileId: 'src/db/queries/charges.ts', note: 'Charge row is re-read inside the retry loop.' },
      { fileId: 'src/queue/jobs/capture.ts', note: 'Retry re-enters capture with the same key.' },
      { fileId: 'src/checkout/totals.ts', note: 'Totals are recomputed on retry without a snapshot.' },
      { fileId: 'src/refunds/amount.ts', note: 'Refund check compares to the line total, not captured balance.' },
      { fileId: 'src/refunds/create.ts', note: 'Consumes the same captured balance during retries.' },
      { fileId: 'src/webhooks/receiver.ts', note: 'Duplicate provider webhook can re-trigger capture.' },
      { fileId: 'src/webhooks/verify.ts', note: 'Signature check runs after the body is parsed.' },
      { fileId: 'src/routes/checkout.ts', note: 'Returns the raw provider error to the client.' },
      { fileId: 'src/http/errors.ts', note: 'Error mapper forwards PSP detail without redaction.' },
    ],
    fixed: [
      {
        fileId: 'src/checkout/capture.ts',
        note: 'Claims the key inside the transaction before calling the provider.',
        patch: 'const claimed = await idempotency.claim(key, charge.id);\nif (!claimed) return existingCharge(key);',
      },
      {
        fileId: 'src/checkout/idempotency.ts',
        note: 'Persists the pending key before the capture call.',
        patch: 'await store.claim(key, { state: "pending" });\nconst charge = await psp.capture(...);\nawait store.complete(key, charge.id);',
      },
      {
        fileId: 'src/db/queries/idempotency.ts',
        note: 'Atomic claim with INSERT ... ON CONFLICT DO NOTHING.',
        patch: 'INSERT INTO idempotency_keys (key)\nVALUES ($1) ON CONFLICT (key) DO NOTHING\nRETURNING key;',
      },
      {
        fileId: 'src/refunds/amount.ts',
        note: 'Compares against the remaining capturable balance.',
        patch: 'if (minorUnits(refund) > captured - refunded) {\n  throw new RefundExceedsCapture();\n}',
      },
      {
        fileId: 'src/checkout/totals.ts',
        note: 'Sums integer minor units — no float math on money.',
        patch: 'const total = lines.reduce((sum, l) => sum + l.amountMinor, 0);',
      },
      {
        fileId: 'src/webhooks/receiver.ts',
        note: 'Verifies the HMAC over the raw body before parsing.',
        patch: 'const raw = await readRaw(req);\nverifySignature(raw, req.headers);\nconst event = JSON.parse(raw);',
      },
      {
        fileId: 'src/http/errors.ts',
        note: 'Redacts provider detail from client-facing errors.',
        patch: 'return { code: "card_declined", message: "Payment was declined." };',
      },
    ],
    phaseMs: { scan: 2600, impact: 1500, fix: 1700 },
  };
}

function ledgerScenario(repository: string): DiagnosisScenario {
  const graph = buildMockCodeGraph(repository);
  return {
    repository,
    title: 'Payout retries hammer the provider during an outage',
    prNumber: 121,
    severity: 'high',
    rootFileId: 'src/payout/worker.ts',
    summary:
      'Failed payouts are retried forever at a fixed interval with no idempotency key, so a provider outage turns into a retry storm. The bot traced the retry path through the queue job and the transfer store, then capped the backoff and replayed settle writes safely.',
    findings: findingsFor(repository),
    searchOrder: searchOrderFor(graph, 'src/payout/worker.ts'),
    affected: [
      { fileId: 'src/payout/worker.ts', root: true, note: 'Retries without a backoff cap or idempotency key.' },
      { fileId: 'src/payout/batch.ts', note: 'Batches are replayed wholesale on failure.' },
      { fileId: 'src/payout/provider.ts', note: 'Every retry hits the provider with no jitter.' },
      { fileId: 'src/queue/jobs/settle.ts', note: 'Job requeues immediately on error.' },
      { fileId: 'src/queue/consumer.ts', note: 'Consumer has no dead-letter path for hot retries.' },
      { fileId: 'src/transfers/worker.ts', note: 'Settlement worker shares the same retry loop.' },
      { fileId: 'src/db/queries/transfers.ts', note: 'Settle writes are not idempotent.' },
      { fileId: 'src/reports/query.ts', note: 'Report query interpolates dates into SQL.' },
      { fileId: 'src/reports/totals.ts', note: 'Totals drift when duplicates settle.' },
      { fileId: 'src/http/retry.ts', note: 'Retry helper has no cap or jitter.' },
      { fileId: 'src/http/errors.ts', note: 'Provider outages are surfaced as generic 500s.' },
      { fileId: 'src/routes/payouts.ts', note: 'Manual replay endpoint bypasses the queue.' },
    ],
    fixed: [
      {
        fileId: 'src/payout/worker.ts',
        note: 'Exponential backoff with a cap plus idempotency key.',
        patch: 'const delay = Math.min(base * 2 ** attempt, 60_000);\nawait queue.enqueue(job, { delay, key: payout.id });',
      },
      {
        fileId: 'src/payout/batch.ts',
        note: 'Skips payouts that already settled.',
        patch: 'const pending = batch.filter((p) => p.state !== "settled");',
      },
      {
        fileId: 'src/payout/provider.ts',
        note: 'Adds jitter so retries spread across the outage window.',
        patch: 'const jitter = Math.random() * 0.3 * delay;',
      },
      {
        fileId: 'src/queue/jobs/settle.ts',
        note: 'Honours the job delay and moves to dead-letter after N tries.',
        patch: 'if (job.attempts >= MAX_ATTEMPTS) return deadLetter(job);',
      },
      {
        fileId: 'src/db/queries/transfers.ts',
        note: 'Upsert settle writes on the transfer id.',
        patch: 'INSERT INTO transfers (...) VALUES (...)\nON CONFLICT (transfer_id) DO NOTHING;',
      },
      {
        fileId: 'src/reports/query.ts',
        note: 'Binds dates as parameters.',
        patch: 'WHERE created_at BETWEEN $1 AND $2',
      },
      {
        fileId: 'src/http/retry.ts',
        note: 'Caps attempts and adds full jitter.',
        patch: 'const jittered = Math.random() * Math.min(cap, base * 2 ** attempt);',
      },
    ],
    phaseMs: { scan: 2200, impact: 1300, fix: 1500 },
  };
}

function webScenario(repository: string): DiagnosisScenario {
  const graph = buildMockCodeGraph(repository);
  return {
    repository,
    title: 'Signed session cookies and refresh-token lifetime',
    prNumber: 903,
    severity: 'high',
    rootFileId: 'src/auth/session.ts',
    summary:
      'The session cookie is issued without SameSite protection and the refresh token never expires, so a stolen cookie survives sign-out. The bot traced issuance through the auth route, middleware and session store, then hardened the cookie, key material and cache eviction.',
    findings: findingsFor(repository),
    searchOrder: searchOrderFor(graph, 'src/auth/session.ts'),
    affected: [
      { fileId: 'src/auth/session.ts', root: true, note: 'Cookie is missing SameSite and a strict path.' },
      { fileId: 'src/auth/tokens.ts', note: 'Refresh tokens carry no expiry.' },
      { fileId: 'src/auth/middleware.ts', note: 'Middleware accepts cookies without rotating them.' },
      { fileId: 'src/auth/oauth.ts', note: 'OAuth callback reuses the same long-lived token.' },
      { fileId: 'src/routes/auth.ts', note: 'Login response sets the permissive cookie.' },
      { fileId: 'src/routes/account.ts', note: 'Account view relies on the unrotated session.' },
      { fileId: 'src/db/queries/sessions.ts', note: 'Session rows are never expired or evicted.' },
      { fileId: 'src/http/cache.ts', note: 'Unbounded in-memory cache on the hot path.' },
      { fileId: 'src/pages/account.ts', note: 'Client caches the session payload forever.' },
      { fileId: 'src/lib/crypto.ts', note: 'Signing uses a static non-rotating key.' },
      { fileId: 'src/emails/send.ts', note: 'Sign-out receipt does not invalidate other sessions.' },
    ],
    fixed: [
      {
        fileId: 'src/auth/session.ts',
        note: 'SameSite=Lax, HttpOnly and a strict path.',
        patch: 'cookie: { httpOnly: true, sameSite: "lax", secure: true, path: "/" }',
      },
      {
        fileId: 'src/auth/tokens.ts',
        note: 'Refresh tokens rotate and expire after 14 days.',
        patch: 'expiresAt = new Date(Date.now() + 14 * DAY);\nreturn rotate(refresh, { expiresAt });',
      },
      {
        fileId: 'src/auth/middleware.ts',
        note: 'Rotates the token when it is past half-life.',
        patch: 'if (session.age > HALF_LIFE) await rotateSession(session);',
      },
      {
        fileId: 'src/db/queries/sessions.ts',
        note: 'Expires and evicts stale session rows.',
        patch: 'DELETE FROM sessions WHERE expires_at < now();',
      },
      {
        fileId: 'src/http/cache.ts',
        note: 'Bounded LRU with a 1000-entry cap.',
        patch: 'cache.set(key, value, { max: 1000, ttl: 60_000 });',
      },
      {
        fileId: 'src/lib/crypto.ts',
        note: 'Signs with a rotating key set.',
        patch: 'sign(payload, keys.current, { previous: keys.previous });',
      },
    ],
    phaseMs: { scan: 2100, impact: 1300, fix: 1400 },
  };
}

const SCENARIO_BUILDERS: Record<string, (repository: string) => DiagnosisScenario> = {
  'acme/payments-api': paymentsScenario,
  'acme/ledger': ledgerScenario,
  'acme/web': webScenario,
};

const scenarioCache = new Map<string, DiagnosisScenario>();

export function getDiagnosisScenario(repository: string): DiagnosisScenario {
  const cached = scenarioCache.get(repository);
  if (cached) return cached;

  const build = SCENARIO_BUILDERS[repository] ?? paymentsScenario;
  const scenario = build(repository);
  scenarioCache.set(repository, scenario);
  return scenario;
}
