import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useUser } from '@/hooks/use-user';
import { cn } from '@/lib/utils';
import { Button } from '@/components/button';
import { MetricCard } from '@/components/ds';
import { SeverityChips, RunStatusDot, RunStatusBadge } from '@/components/review/bits';
import {
  dashboardMetrics,
  mockCodebaseMap,
  recentReviews,
  timeAgo,
  type CodeFileStatus,
  type CodebaseFile,
  type MockReview,
} from '@/lib/mock-review-data';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  FolderGit2,
  GitPullRequest,
  ShieldAlert,
} from 'lucide-react';

const METRIC_ICONS = {
  reviews: GitPullRequest,
  open: ShieldAlert,
  priority: AlertTriangle,
  repos: FolderGit2,
} as const;

const CODE_STATUS_META: Record<CodeFileStatus, { label: string; color: string; swatch: string }> = {
  clean: { label: 'Clean', color: 'hsl(var(--surface-deep))', swatch: 'bg-surface-deep' },
  fixing: { label: 'Being fixed', color: 'hsl(var(--warning))', swatch: 'bg-warning' },
  error: { label: 'Error', color: 'hsl(var(--danger))', swatch: 'bg-danger' },
};

function CardFooter({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-auto flex items-center gap-1 border-none bg-transparent pt-3 text-[12.5px] font-medium text-fg-muted transition-colors hover:text-foreground cursor-pointer"
    >
      {label} <ArrowRight size={13} />
    </button>
  );
}

function FixQueueCard({ reviews, onOpen }: { reviews: MockReview[]; onOpen: () => void }) {
  return (
    <MetricCard
      label="Fix queue"
      hint="Pull requests with critical or high findings"
      icon={AlertTriangle}
      tone="danger"
      textPosition="top"
    >
      {reviews.length === 0 ? (
        <div className="flex flex-1 items-center gap-2 py-4 text-[13px] text-fg-muted">
          <CheckCircle2 size={15} className="shrink-0 text-success" />
          No pull requests are waiting on fixes.
        </div>
      ) : (
        <ul className="flex-1">
          {reviews.map((review) => (
            <li key={review.id} className="border-b border-border-subtle last:border-b-0">
              <button
                type="button"
                onClick={onOpen}
                className="-mx-1.5 flex w-full items-start gap-3 rounded-[8px] border-none bg-transparent px-1.5 py-2.5 text-left cursor-pointer transition-colors hover:bg-surface-hover/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{review.title}</p>
                  <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-muted">
                    {review.repository} #{review.number} · {review.author}
                  </p>
                </div>
                <div className="hidden shrink-0 items-center gap-2 pt-0.5 sm:flex">
                  <SeverityChips severity={review.severity} />
                  <span className="whitespace-nowrap text-[11.5px] tabular-nums text-fg-faint">
                    {timeAgo(review.createdAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CardFooter label="View all reviews" onClick={onOpen} />
    </MetricCard>
  );
}

function ActiveReviewsCard({ reviews, onOpen }: { reviews: MockReview[]; onOpen: () => void }) {
  return (
    <MetricCard
      label="Active reviews"
      hint="Reviews running right now"
      icon={GitPullRequest}
      tone="brand"
      textPosition="top"
    >
      {reviews.length === 0 ? (
        <div className="flex flex-1 items-center gap-2 py-4 text-[13px] text-fg-muted">
          <CheckCircle2 size={15} className="shrink-0 text-success" />
          All caught up. No reviews are running.
        </div>
      ) : (
        <ul className="flex-1">
          {reviews.map((review) => (
            <li key={review.id} className="border-b border-border-subtle last:border-b-0">
              <button
                type="button"
                onClick={onOpen}
                className="-mx-1.5 flex w-full items-start gap-3 rounded-[8px] border-none bg-transparent px-1.5 py-2.5 text-left cursor-pointer transition-colors hover:bg-surface-hover/60"
              >
                <span className="mt-[6px]">
                  <RunStatusDot status={review.status} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{review.title}</p>
                  <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-muted">
                    {review.repository} #{review.number} · {review.author}
                  </p>
                </div>
                <div className="hidden shrink-0 items-center gap-2 pt-0.5 sm:flex">
                  <span className="whitespace-nowrap text-[11.5px] tabular-nums text-fg-faint">
                    {timeAgo(review.createdAt)}
                  </span>
                  <RunStatusBadge status={review.status} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CardFooter label="View all reviews" onClick={onOpen} />
    </MetricCard>
  );
}

const CODE_BLOCK_PX = 14;
const CODE_BLOCK_GAP_PX = 5;
const CODEBASE_ROWS = 5;

function CodebaseCard() {
  const map = mockCodebaseMap;
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(0);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      setColumns(
        Math.max(1, Math.floor((width + CODE_BLOCK_GAP_PX) / (CODE_BLOCK_PX + CODE_BLOCK_GAP_PX))),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const files = map.files;
  const totals = map.totals;

  const visibleFiles = useMemo(() => {
    if (columns <= 0 || files.length === 0) return [];
    const target = Math.min(columns * CODEBASE_ROWS, files.length);
    const indexed = files.map((file, index) => ({ file, index }));
    const issues = indexed.filter((entry) => entry.file.status !== 'clean');
    const clean = indexed.filter((entry) => entry.file.status === 'clean');
    const chosen =
      issues.length >= target
        ? issues.slice(0, target)
        : [...issues, ...clean.slice(0, target - issues.length)];
    return chosen.sort((a, b) => a.index - b.index).map((entry) => entry.file);
  }, [columns, files]);

  const legendCount = (status: CodeFileStatus) =>
    status === 'clean' ? totals.clean : status === 'fixing' ? totals.fixing : totals.error;

  return (
    <MetricCard
      label="Codebase"
      hint="Each block is one indexed file, coloured by its current state."
      icon={Boxes}
      tone="neutral"
      textPosition="top"
      dotMatrix={false}
    >
      {(
        <>
          <div ref={gridRef} className="flex flex-wrap justify-start gap-[5px]">
            {visibleFiles.map((file: CodebaseFile) => {
              const meta = CODE_STATUS_META[file.status];
              return (
                <span
                  key={`${file.repository}:${file.path}`}
                  className="shrink-0 rounded-[3px]"
                  style={{ background: meta.color, width: CODE_BLOCK_PX, height: CODE_BLOCK_PX }}
                  title={`${file.repository} · ${file.path} — ${meta.label}`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-fg-muted">
              {(Object.keys(CODE_STATUS_META) as CodeFileStatus[]).map((status) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2.5 w-2.5 rounded-[2px]', CODE_STATUS_META[status].swatch)} />
                  {CODE_STATUS_META[status].label}{' '}
                  <span className="tabular-nums text-fg-faint">
                    {legendCount(status).toLocaleString()}
                  </span>
                </span>
              ))}
            </div>
            <span className="text-[11.5px] tabular-nums text-fg-faint">
              Showing {visibleFiles.length} of {totals.total.toLocaleString()} indexed files
            </span>
          </div>
        </>
      )}
    </MetricCard>
  );
}

export default function HomePage() {
  const { data: user } = useUser();
  const [, setLocation] = useLocation();

  const firstName = user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  const activeReviews = recentReviews.filter((r) => !['done', 'error', 'cancelled'].includes(r.status));
  const fixQueue = recentReviews
    .filter((r) => r.status === 'done' && r.severity.critical + r.severity.high > 0)
    .sort((a, b) => b.severity.critical - a.severity.critical || b.severity.high - a.severity.high);
  const openReviews = () => setLocation('/review/reviews');
  const diagnoseError = () =>
    setLocation(`/review/reviews?diagnose=${fixQueue[0]?.id ?? recentReviews[0]?.id ?? 'rv_01'}`);

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 px-4 sm:px-6 md:px-8 pt-10 pb-4 sm:pt-14 sm:pb-6 max-w-5xl mx-auto w-full">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h1 className="font-sans text-[15px] font-medium leading-tight text-foreground truncate">
              Welcome back, {firstName}
            </h1>
            <p className="mt-0.5 text-[12px] font-[450] leading-snug text-fg-warm">
              Reviews, findings, and open issues across your repositories.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button design="pill" onClick={diagnoseError}>
              Diagnose Error
            </Button>
            <Button design="pill-secondary" onClick={() => setLocation('/bot/rules')}>
              Bot
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {dashboardMetrics.map((metric) => {
            const Icon = METRIC_ICONS[metric.key as keyof typeof METRIC_ICONS] ?? GitPullRequest;
            return (
              <MetricCard
                key={metric.key}
                label={metric.label}
                value={metric.value}
                hint={metric.hint}
                icon={Icon}
                tone={metric.tone}
              />
            );
          })}
        </div>

        {/* Codebase map */}
        <div className="mb-4">
          <CodebaseCard />
        </div>

        {/* Pull request queues */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FixQueueCard reviews={fixQueue} onOpen={openReviews} />
          <ActiveReviewsCard reviews={activeReviews} onOpen={openReviews} />
        </div>
      </div>
    </div>
  );
}
