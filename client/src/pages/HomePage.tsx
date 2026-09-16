import { useLocation } from 'wouter';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/button';
import { MetricCard } from '@/components/ds';
import { runStatus } from '@/components/review/bits';
import {
  dashboardMetrics,
  recentReviews,
  timeAgo,
  type MockReview,
} from '@/lib/mock-review-data';
import {
  AlertTriangle,
  ArrowRight,
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

const RUN_STATUS_LEVEL: Record<string, number> = {
  queued: 1,
  preparing: 1,
  indexing: 2,
  planning: 2,
  reviewing: 2,
  verifying: 3,
  sandboxing: 3,
  fixing: 3,
  publishing: 3,
  summarizing: 3,
  done: 4,
  error: 4,
  cancelled: 4,
};

const STATUS_BAR_COUNT = 4;
const STATUS_BAR_HEIGHT = 10;

function RunStatusIcon({ status }: { status: string }) {
  const meta = runStatus(status);
  const level = RUN_STATUS_LEVEL[status] ?? 1;
  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      className="flex items-end gap-[2px]"
      style={{ height: STATUS_BAR_HEIGHT }}
    >
      {Array.from({ length: STATUS_BAR_COUNT }, (_, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full"
          style={{
            height: STATUS_BAR_HEIGHT,
            background: index < level ? meta.color : 'hsl(var(--surface-hover-strong))',
          }}
        />
      ))}
    </span>
  );
}

function CardFooter({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-auto -mb-1 flex items-center gap-1 border-none bg-transparent pt-3 text-[12.5px] font-medium text-fg-muted transition-colors hover:text-foreground cursor-pointer"
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
                className="-mx-2 flex w-[calc(100%+16px)] items-start gap-3 rounded-[8px] border-none bg-transparent px-2 py-2.5 text-left cursor-pointer transition-colors hover:bg-surface-hover/60"
              >
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
                className="-mx-2 flex w-[calc(100%+16px)] items-start gap-3 rounded-[8px] border-none bg-transparent px-2 py-2.5 text-left cursor-pointer transition-colors hover:bg-surface-hover/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{review.title}</p>
                  <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-muted">
                    {review.repository} #{review.number} · {review.author}
                  </p>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 pt-0.5 sm:flex">
                  <span className="whitespace-nowrap text-[11.5px] tabular-nums text-fg-faint">
                    {timeAgo(review.createdAt)}
                  </span>
                  <RunStatusIcon status={review.status} />
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

export default function HomePage() {
  const { data: user } = useUser();
  const [, setLocation] = useLocation();

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
  const firstName = (user?.displayName?.trim() || user?.email?.split('@')[0] || 'there').split(/\s+/)[0];
  const activeReviews = recentReviews.filter((r) => !['done', 'error', 'cancelled'].includes(r.status));
  const fixQueue = recentReviews
    .filter((r) => r.status === 'done' && r.severity.critical + r.severity.high > 0)
    .sort((a, b) => b.severity.critical - a.severity.critical || b.severity.high - a.severity.high);
  const openReviews = () => setLocation('/review/reviews');
  const diagnoseError = () =>
    setLocation(`/review/reviews?diagnose=${fixQueue[0]?.id ?? recentReviews[0]?.id ?? 'rv_01'}`);

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 px-4 sm:px-6 md:px-8 pt-10 pb-8 sm:pt-14 sm:pb-12 max-w-5xl mx-auto w-full">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="font-sans text-[15px] font-medium leading-tight text-foreground truncate">
              {timeGreeting}, {firstName}
            </h1>
            <p className="mt-0.5 text-[12px] font-[450] leading-snug text-fg-warm">
              Reviews and findings across your repositories.
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
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

        {/* Pull request queues */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <FixQueueCard reviews={fixQueue} onOpen={openReviews} />
          <ActiveReviewsCard reviews={activeReviews} onOpen={openReviews} />
        </div>
      </div>
    </div>
  );
}
