/* Mock data for the review dashboard while the UI is being built.
   Swap each export for its API-backed hook once the endpoints are wired. */

export type SeverityKey = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type SeverityCounts = Record<SeverityKey, number>;
export type RunStatus =
  | 'queued'
  | 'indexing'
  | 'planning'
  | 'reviewing'
  | 'verifying'
  | 'summarizing'
  | 'done'
  | 'error'
  | 'cancelled';

export const SEVERITY_ORDER: SeverityKey[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_META: Record<SeverityKey, { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#ef4444' },
  high: { label: 'High', color: '#f97316' },
  medium: { label: 'Medium', color: '#f59e0b' },
  low: { label: 'Low', color: '#0ea5e9' },
  info: { label: 'Info', color: '#94a3b8' },
};

function emptySeverity(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export function severityTotal(counts: SeverityCounts): number {
  return SEVERITY_ORDER.reduce((sum, key) => sum + counts[key], 0);
}

/* ── Dashboard metrics ───────────────────────────────────────────── */

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  hint: string;
  tone: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}

export const dashboardMetrics: DashboardMetric[] = [
  { key: 'reviews', label: 'Reviews run', value: 128, hint: '+14 in the last 7 days', tone: 'brand' },
  { key: 'open', label: 'Open findings', value: 34, hint: '212 found in total', tone: 'warning' },
  { key: 'priority', label: 'High priority', value: 7, hint: '2 critical · 5 high open', tone: 'danger' },
  { key: 'repos', label: 'Repositories', value: 6, hint: '5 indexed · 1 pending', tone: 'info' },
];

export const openSeverity: SeverityCounts = { critical: 2, high: 5, medium: 12, low: 9, info: 6 };

/* ── Review activity (GitHub-style contribution grid) ────────────── */

export interface ActivityDay {
  date: string;
  count: number;
}

/* Deterministic pseudo-random so the grid is stable across renders. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** 26 weeks of review activity, most recent day last. */
export const reviewActivity: ActivityDay[] = (() => {
  const rand = seeded(20260910);
  const days = 26 * 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: ActivityDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const roll = rand();
    let count = 0;
    if (!weekend) {
      if (roll > 0.22) count = 1 + Math.floor(rand() * 5);
    } else if (roll > 0.72) {
      count = 1 + Math.floor(rand() * 2);
    }
    out.push({ date: date.toISOString().slice(0, 10), count });
  }
  return out;
})();

export const activityWeeks = 26;

/* ── Recent reviews ──────────────────────────────────────────────── */

export interface MockReview {
  id: string;
  title: string;
  repository: string;
  number: number;
  author: string;
  status: RunStatus;
  findings: number;
  severity: SeverityCounts;
  createdAt: string;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export const recentReviews: MockReview[] = [
  {
    id: 'rv_01',
    title: 'Harden webhook signature verification',
    repository: 'acme/payments-api',
    number: 482,
    author: 'priya.n',
    status: 'reviewing',
    findings: 0,
    severity: emptySeverity(),
    createdAt: minutesAgo(6),
  },
  {
    id: 'rv_02',
    title: 'Race condition in the new checkout path',
    repository: 'acme/payments-api',
    number: 479,
    author: 'dan.okafor',
    status: 'done',
    findings: 4,
    severity: { critical: 1, high: 1, medium: 1, low: 1, info: 0 },
    createdAt: minutesAgo(96),
  },
  {
    id: 'rv_03',
    title: 'Tighten refund amount validation',
    repository: 'acme/payments-api',
    number: 474,
    author: 'sam.lee',
    status: 'done',
    findings: 2,
    severity: { critical: 0, high: 1, medium: 0, low: 0, info: 1 },
    createdAt: minutesAgo(300),
  },
  {
    id: 'rv_04',
    title: 'Swap the queue client for the shared transport',
    repository: 'acme/ledger',
    number: 128,
    author: 'morgan.k',
    status: 'error',
    findings: 0,
    severity: emptySeverity(),
    createdAt: minutesAgo(60 * 26),
  },
  {
    id: 'rv_05',
    title: 'Add idempotency keys to the payout worker',
    repository: 'acme/ledger',
    number: 121,
    author: 'priya.n',
    status: 'done',
    findings: 6,
    severity: { critical: 2, high: 2, medium: 1, low: 1, info: 0 },
    createdAt: minutesAgo(60 * 49),
  },
  {
    id: 'rv_06',
    title: 'Migrate session storage to signed cookies',
    repository: 'acme/web',
    number: 903,
    author: 'dan.okafor',
    status: 'done',
    findings: 3,
    severity: { critical: 0, high: 1, medium: 1, low: 1, info: 0 },
    createdAt: minutesAgo(60 * 72),
  },
  {
    id: 'rv_07',
    title: 'Document the public pricing helpers',
    repository: 'acme/web',
    number: 898,
    author: 'sam.lee',
    status: 'cancelled',
    findings: 0,
    severity: emptySeverity(),
    createdAt: minutesAgo(60 * 96),
  },
  {
    id: 'rv_08',
    title: 'Reduce N+1 queries on the invoices index',
    repository: 'acme/ledger',
    number: 117,
    author: 'morgan.k',
    status: 'done',
    findings: 5,
    severity: { critical: 0, high: 3, medium: 1, low: 0, info: 1 },
    createdAt: minutesAgo(60 * 120),
  },
];

/* ── Open findings ───────────────────────────────────────────────── */

export interface MockFinding {
  id: string;
  title: string;
  body: string;
  severity: SeverityKey;
  category: string;
  filePath: string;
  startLine: number;
  repository: string;
  createdAt: string;
}

export const openFindings: MockFinding[] = [
  {
    id: 'fd_01',
    title: 'Capture is not guarded by the idempotency key',
    body: 'The retry loop re-reads the charge before the key is persisted, so a concurrent request can capture twice.',
    severity: 'critical',
    category: 'bug',
    filePath: 'src/checkout/capture.ts',
    startLine: 142,
    repository: 'acme/payments-api',
    createdAt: minutesAgo(93),
  },
  {
    id: 'fd_02',
    title: 'Refund can exceed the captured amount',
    body: 'The check compares against the line total rather than the remaining capturable balance.',
    severity: 'high',
    category: 'bug',
    filePath: 'src/refunds/amount.ts',
    startLine: 31,
    repository: 'acme/payments-api',
    createdAt: minutesAgo(300),
  },
  {
    id: 'fd_03',
    title: 'Rounding uses float math on currency amounts',
    body: 'Totals are summed as floats and rounded once at the end, which drifts on split-tender orders.',
    severity: 'high',
    category: 'correctness',
    filePath: 'src/checkout/totals.ts',
    startLine: 44,
    repository: 'acme/payments-api',
    createdAt: minutesAgo(96),
  },
  {
    id: 'fd_04',
    title: 'Error message leaks the provider response',
    body: 'The raw PSP error is returned to the client, including the decline reason and card suffix.',
    severity: 'medium',
    category: 'security',
    filePath: 'src/checkout/capture.ts',
    startLine: 88,
    repository: 'acme/payments-api',
    createdAt: minutesAgo(96),
  },
  {
    id: 'fd_05',
    title: 'Payout worker retries without a backoff cap',
    body: 'A failing payout is retried forever at a fixed interval, hammering the provider during an outage.',
    severity: 'medium',
    category: 'performance',
    filePath: 'src/payout/worker.ts',
    startLine: 77,
    repository: 'acme/ledger',
    createdAt: minutesAgo(60 * 48),
  },
  {
    id: 'fd_06',
    title: 'Session cookie is missing the SameSite attribute',
    body: 'Without SameSite, the session cookie is attached to cross-site requests and widens CSRF exposure.',
    severity: 'high',
    category: 'security',
    filePath: 'src/auth/session.ts',
    startLine: 22,
    repository: 'acme/web',
    createdAt: minutesAgo(60 * 72),
  },
];

/* ── Repositories ────────────────────────────────────────────────── */

export interface MockRepository {
  id: string;
  fullName: string;
  provider: 'github' | 'gitlab' | 'bitbucket';
  isPrivate: boolean;
  indexed: boolean;
  reviewEnabled: boolean;
  openFindings: number;
  lastReviewedAt: string | null;
}

export const repositories: MockRepository[] = [
  { id: 'rp_01', fullName: 'acme/payments-api', provider: 'github', isPrivate: true, indexed: true, reviewEnabled: true, openFindings: 14, lastReviewedAt: minutesAgo(6) },
  { id: 'rp_02', fullName: 'acme/ledger', provider: 'github', isPrivate: true, indexed: true, reviewEnabled: true, openFindings: 9, lastReviewedAt: minutesAgo(60 * 26) },
  { id: 'rp_03', fullName: 'acme/web', provider: 'github', isPrivate: true, indexed: true, reviewEnabled: true, openFindings: 6, lastReviewedAt: minutesAgo(60 * 72) },
  { id: 'rp_04', fullName: 'acme/infra', provider: 'github', isPrivate: false, indexed: true, reviewEnabled: false, openFindings: 3, lastReviewedAt: minutesAgo(60 * 140) },
  { id: 'rp_05', fullName: 'acme/docs', provider: 'github', isPrivate: false, indexed: true, reviewEnabled: true, openFindings: 2, lastReviewedAt: minutesAgo(60 * 200) },
  { id: 'rp_06', fullName: 'acme/mobile', provider: 'gitlab', isPrivate: true, indexed: false, reviewEnabled: false, openFindings: 0, lastReviewedAt: null },
];

/* ── Codebase map ────────────────────────────────────────────────── */

export type CodeFileStatus = 'clean' | 'fixing' | 'error';

export interface CodebaseFile {
  repository: string;
  path: string;
  status: CodeFileStatus;
}

export interface CodebaseMap {
  connected: boolean;
  totals: { total: number; error: number; fixing: number; clean: number };
  files: CodebaseFile[];
  sampled: number;
}

const CODEBASE_DIRS = ['src/lib', 'src/routes', 'src/components', 'server/lib', 'shared'];
const CODEBASE_FILES = [
  'utils.ts', 'api.ts', 'router.ts', 'schema.ts', 'hooks.ts',
  'runner.ts', 'store.ts', 'client.tsx', 'page.tsx', 'types.ts',
];

export const mockCodebaseMap: CodebaseMap = (() => {
  const files: CodebaseFile[] = [];
  let seed = 20260910;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (const repository of repositories.filter((repo) => repo.indexed)) {
    for (const dir of CODEBASE_DIRS) {
      for (const name of CODEBASE_FILES) {
        const roll = rand();
        files.push({
          repository: repository.fullName,
          path: `${dir}/${name}`,
          status: roll > 0.9 ? 'error' : roll > 0.75 ? 'fixing' : 'clean',
        });
      }
    }
  }
  const totals = {
    total: files.length,
    error: files.filter((file) => file.status === 'error').length,
    fixing: files.filter((file) => file.status === 'fixing').length,
    clean: files.filter((file) => file.status === 'clean').length,
  };
  return { connected: true, totals, files, sampled: totals.total };
})();

/* ── Full findings list (Reviews + Security pages) ───────────────── */

export interface MockFindingDetail extends MockFinding {
  status: 'open' | 'fixed' | 'dismissed';
  confidence: number;
  reviewId: string;
}

export const findings: MockFindingDetail[] = [
  { ...openFindings[0], status: 'open', confidence: 0.92, reviewId: 'rv_02' },
  { ...openFindings[1], status: 'open', confidence: 0.88, reviewId: 'rv_03' },
  { ...openFindings[2], status: 'open', confidence: 0.81, reviewId: 'rv_02' },
  { ...openFindings[3], status: 'open', confidence: 0.74, reviewId: 'rv_02' },
  { ...openFindings[4], status: 'open', confidence: 0.69, reviewId: 'rv_05' },
  { ...openFindings[5], status: 'open', confidence: 0.86, reviewId: 'rv_06' },
  {
    id: 'fd_07',
    title: 'SQL is built with string interpolation',
    body: 'The report query concatenates user-supplied dates into the WHERE clause instead of binding them.',
    severity: 'critical',
    category: 'security',
    filePath: 'src/reports/query.ts',
    startLine: 58,
    repository: 'acme/ledger',
    createdAt: minutesAgo(60 * 49),
    status: 'open',
    confidence: 0.95,
    reviewId: 'rv_05',
  },
  {
    id: 'fd_08',
    title: 'Webhook body is parsed before the signature check',
    body: 'The JSON body is parsed and logged before the HMAC is verified, so unauthenticated payloads reach logs.',
    severity: 'high',
    category: 'security',
    filePath: 'src/webhooks/receiver.ts',
    startLine: 19,
    repository: 'acme/payments-api',
    createdAt: minutesAgo(60 * 22),
    status: 'open',
    confidence: 0.83,
    reviewId: 'rv_01',
  },
  {
    id: 'fd_09',
    title: 'Refresh token never expires',
    body: 'Issued refresh tokens carry no expiry and are only invalidated when the user signs out.',
    severity: 'medium',
    category: 'security',
    filePath: 'src/auth/tokens.ts',
    startLine: 64,
    repository: 'acme/web',
    createdAt: minutesAgo(60 * 72),
    status: 'open',
    confidence: 0.71,
    reviewId: 'rv_06',
  },
  {
    id: 'fd_10',
    title: 'Dependency pinned to a version with a known advisory',
    body: 'The lockfile pins a parser release with a published prototype-pollution advisory.',
    severity: 'high',
    category: 'security',
    filePath: 'package-lock.json',
    startLine: 4120,
    repository: 'acme/infra',
    createdAt: minutesAgo(60 * 140),
    status: 'open',
    confidence: 0.79,
    reviewId: 'rv_04',
  },
  { ...openFindings[5], id: 'fd_11', status: 'fixed', confidence: 0.9, reviewId: 'rv_03' },
  {
    id: 'fd_12',
    title: 'Unbounded in-memory cache on the hot path',
    body: 'The per-request cache is keyed by URL with no eviction, so memory grows with traffic.',
    severity: 'medium',
    category: 'performance',
    filePath: 'src/http/cache.ts',
    startLine: 33,
    repository: 'acme/web',
    createdAt: minutesAgo(60 * 96),
    status: 'fixed',
    confidence: 0.77,
    reviewId: 'rv_08',
  },
];

/* ── Bot rules + learnings ───────────────────────────────────────── */

export interface MockRule {
  id: string;
  glob: string | null;
  instruction: string;
  scope: string;
  enabled: boolean;
  createdAt: string;
}

export const rules: MockRule[] = [
  { id: 'rl_01', glob: 'src/**/*.ts', instruction: 'Never log raw request bodies. They contain card data.', scope: 'acme/payments-api', enabled: true, createdAt: minutesAgo(60 * 24 * 9) },
  { id: 'rl_02', glob: '**/*.sql', instruction: 'All queries must use bound parameters. Flag string interpolation in SQL.', scope: 'All repositories', enabled: true, createdAt: minutesAgo(60 * 24 * 6) },
  { id: 'rl_03', glob: null, instruction: 'Currency amounts are always integer minor units. Flag any float math on money.', scope: 'All repositories', enabled: true, createdAt: minutesAgo(60 * 24 * 21) },
  { id: 'rl_04', glob: 'src/legacy/**', instruction: 'Skip style and documentation comments in the legacy folder.', scope: 'acme/ledger', enabled: true, createdAt: minutesAgo(60 * 24 * 33) },
  { id: 'rl_05', glob: 'migrations/**', instruction: 'Flag any destructive migration that drops a column without a backfill step.', scope: 'acme/ledger', enabled: false, createdAt: minutesAgo(60 * 24 * 41) },
];

export interface MockLearning {
  id: string;
  text: string;
  scope: string;
  source: 'feedback' | 'rule' | 'manual';
  accepted: number;
  rejected: number;
  createdAt: string;
}

export const learnings: MockLearning[] = [
  { id: 'ln_01', text: 'The team accepted "Capture is not guarded by the idempotency key" (bug). Keep flagging issues like this.', scope: 'acme/payments-api', source: 'feedback', accepted: 14, rejected: 0, createdAt: minutesAgo(92) },
  { id: 'ln_02', text: 'The team dismissed "Public helper is missing a doc comment". Do not flag missing docs unless there is concrete evidence.', scope: 'acme/payments-api', source: 'feedback', accepted: 0, rejected: 11, createdAt: minutesAgo(300) },
  { id: 'ln_03', text: 'The team accepted "Refund can exceed the captured amount" (bug). Keep flagging issues like this.', scope: 'acme/payments-api', source: 'feedback', accepted: 6, rejected: 0, createdAt: minutesAgo(60 * 20) },
  { id: 'ln_04', text: 'Skip style findings in the legacy folder. The team is not maintaining it.', scope: 'acme/ledger', source: 'manual', accepted: 3, rejected: 0, createdAt: minutesAgo(60 * 24 * 6) },
  { id: 'ln_05', text: 'The team dismissed "Unused import after the refactor" three times this month.', scope: 'acme/web', source: 'feedback', accepted: 0, rejected: 8, createdAt: minutesAgo(60 * 24 * 3) },
  { id: 'ln_06', text: 'Round-trip currency tests are considered authoritative. Do not flag arithmetic in test fixtures.', scope: 'All repositories', source: 'manual', accepted: 2, rejected: 0, createdAt: minutesAgo(60 * 24 * 12) },
];

/* ── Helpers ─────────────────────────────────────────────────────── */

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export { emptySeverity };
