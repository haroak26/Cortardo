import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, GitPullRequest, Plus, CheckCircle2, Minus } from 'lucide-react';
import { Button } from '@/components/button';
import { FramedCard } from '@/components/framed-card';
import { ReviewPageShell, MarkedDivider, RunStatusBadge } from '@/components/review/bits';
import { DiagnoseWorkbench } from '@/components/review/codegraph/DiagnoseWorkbench';
import { ListSkeleton } from '@/components/ds';
import { useWorkspace } from '@/contexts/workspace-context';
import { useReviewRuns, type ApiReviewRun } from '@/hooks/use-github';
import type { RunStatus } from '@/lib/mock-review-data';

type FilterId = 'all' | 'running' | 'completed' | 'failed';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

const RUNNING: RunStatus[] = ['queued', 'preparing', 'indexing', 'planning', 'reviewing', 'verifying', 'sandboxing', 'fixing', 'publishing', 'summarizing'];

function matches(status: RunStatus, filter: FilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return RUNNING.includes(status);
  if (filter === 'completed') return status === 'done';
  return status === 'error' || status === 'cancelled';
}

function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Cost, duration, tokens and cache from the run's persisted bot stats. */
function reviewMetrics(stats: Record<string, unknown> | null | undefined): string | null {
  const bot = (stats?.bot ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof bot.durationMs === 'number') parts.push(formatDurationShort(bot.durationMs));
  if (typeof bot.costUsd === 'number') parts.push(`$${bot.costUsd.toFixed(bot.costUsd < 0.1 ? 4 : 2)}`);
  if (typeof bot.tokensIn === 'number' || typeof bot.tokensOut === 'number') {
    parts.push(
      `${Number(bot.tokensIn ?? 0).toLocaleString()} in / ${Number(bot.tokensOut ?? 0).toLocaleString()} out tokens`,
    );
  }
  const hits = typeof bot.cacheHits === 'number' ? bot.cacheHits : null;
  const misses = typeof bot.cacheMisses === 'number' ? bot.cacheMisses : null;
  const cachedTokens = typeof bot.cachedTokens === 'number' ? bot.cachedTokens : null;
  const tokensIn = typeof bot.tokensIn === 'number' ? bot.tokensIn : null;
  if (cachedTokens !== null && tokensIn && tokensIn > 0 && cachedTokens > 0) {
    parts.push(`prefix cache ${Math.round((cachedTokens / tokensIn) * 100)}%`);
  } else if (hits !== null && misses !== null && hits + misses > 0) {
    parts.push(`result cache ${Math.round((hits / (hits + misses)) * 100)}%`);
  }
  if (typeof bot.cacheSavingsUsd === 'number' && bot.cacheSavingsUsd > 0) {
    parts.push(`saved $${bot.cacheSavingsUsd.toFixed(2)}`);
  }
  if (bot.smokeStarted === true) parts.push(`smoke ${Number(bot.smokeRoutes ?? 0)} route(s)`);
  if (typeof bot.suggested === 'number' && bot.suggested > 0) parts.push(`${bot.suggested} suggestion(s)`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

interface ReviewRow {
  id: string;
  title: string;
  repository: string;
  repositoryId: string | null;
  number: number;
  author: string;
  status: RunStatus;
  run: ApiReviewRun;
}

export default function ReviewsPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { activeWorkspaceId } = useWorkspace();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');

  const runsQuery = useReviewRuns(activeWorkspaceId);

  const reviews = useMemo<ReviewRow[]>(
    () =>
      (runsQuery.data ?? []).map((run) => ({
        id: run.id,
        title: run.title ?? 'Review run',
        repository: run.repositoryFullName ?? 'unknown/repository',
        repositoryId: run.repositoryId ?? null,
        number: run.pullRequestNumber ?? 0,
        author: run.pullRequestAuthor ?? 'bot',
        status: (run.status as RunStatus) ?? 'queued',
        run,
      })),
    [runsQuery.data],
  );

  const diagnoseId = useMemo(() => new URLSearchParams(search).get('diagnose'), [search]);
  const closingIdRef = useRef<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  useEffect(() => {
    if (diagnoseId) {
      closingIdRef.current = diagnoseId;
      setClosingId(null);
      return;
    }
    const previous = closingIdRef.current;
    if (!previous) return;
    setClosingId(previous);
    const timer = window.setTimeout(() => {
      closingIdRef.current = null;
      setClosingId(null);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [diagnoseId]);

  const activeId = diagnoseId ?? closingId;

  const openDiagnose = (reviewId: string) => setLocation(`/review/reviews?diagnose=${reviewId}`);
  const closeDiagnose = () => {
    if (diagnoseId) {
      closingIdRef.current = diagnoseId;
      setClosingId(diagnoseId);
    }
    setLocation('/review/reviews');
  };

  const filtered = useMemo(
    () =>
      reviews.filter(
        (review) =>
          matches(review.status, filter) &&
          (review.title.toLowerCase().includes(query.toLowerCase()) ||
            review.repository.toLowerCase().includes(query.toLowerCase())),
      ),
    [reviews, query, filter],
  );

  return (
    <ReviewPageShell
      title="Reviews"
      description="Every review the bot has run, with the findings it produced."
      actions={
        reviews.length > 0 ? (
          <Button size="sm" onClick={() => openDiagnose(reviews[0].id)}>
            <Plus size={15} />
            Diagnose Error
          </Button>
        ) : undefined
      }
    >
      {runsQuery.isLoading ? (
        <FramedCard>
          <ListSkeleton rows={5} />
        </FramedCard>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <GitPullRequest size={36} className="mb-3 text-fg-faint" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-foreground">No reviews yet</p>
          <p className="mt-1 max-w-sm text-[12.5px] text-fg-muted">
            Connect a repository and the bot will review every pull request automatically.
          </p>
          <Button size="sm" className="mt-5" onClick={() => setLocation('/review/repositories')}>
            <Plus size={15} />
            Connect a repository
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-1">
              {FILTERS.map((option) => {
                const active = option.id === filter;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFilter(option.id)}
                    aria-pressed={active}
                    className={`h-[30px] px-3 rounded-[10px] text-[12.5px] font-medium transition-colors border-none cursor-pointer ${
                      active
                        ? 'bg-brand text-brand-foreground'
                        : 'bg-transparent text-fg-muted hover:bg-surface-hover hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="relative w-full sm:w-[260px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search reviews..."
                aria-label="Search reviews"
                className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <GitPullRequest size={32} className="text-fg-faint mb-3" strokeWidth={1.5} />
              <p className="text-[14px] font-medium text-foreground">No reviews match this view</p>
              <p className="text-[12px] text-fg-muted mt-1">Try a different filter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filtered.map((review) => {
                const isTarget = review.id === activeId;
                const isOpen = review.id === diagnoseId;
                const subtitle = [
                  review.repository,
                  review.number ? `#${review.number}` : null,
                  review.author,
                ]
                  .filter(Boolean)
                  .join(' · ');
                const metrics = reviewMetrics(review.run.stats);

                return (
                  <motion.div
                    key={review.id}
                    layout="position"
                    transition={{ layout: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } }}
                    className={isOpen ? 'md:col-span-2' : undefined}
                  >
                    <FramedCard className="flex h-full flex-col p-0">
                      {isTarget ? (
                        <>
                          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-3 transition-colors hover:bg-surface-hover/50">
                            <button
                              type="button"
                              onClick={closeDiagnose}
                              className="min-w-0 flex-1 cursor-pointer text-left"
                              aria-label="Collapse review"
                            >
                              <p className="truncate text-[13.5px] font-medium text-foreground">{review.title}</p>
                              <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-muted">{subtitle}</p>
                              {metrics && (
                                <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted/80">{metrics}</p>
                              )}
                            </button>
                            <RunStatusBadge status={review.status} />
                            <button
                              type="button"
                              onClick={closeDiagnose}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                              aria-label="Collapse review"
                            >
                              <Minus size={15} />
                            </button>
                          </div>
                          <AnimatePresence initial={false} onExitComplete={() => setClosingId(null)}>
                            {isOpen && (
                              <motion.div
                                key="body"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                                className="overflow-clip [overflow-clip-margin:10px]"
                              >
                                <MarkedDivider />
                                <div>
                                  <p className="px-4 pt-3 text-[12px] font-medium uppercase tracking-wide text-fg-muted">
                                    Codebase map
                                  </p>
                                  <DiagnoseWorkbench
                                    repository={review.repository}
                                    repositoryId={review.repositoryId}
                                    className="h-auto lg:h-[320px]"
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openDiagnose(review.id)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/50"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium text-foreground">{review.title}</p>
                            <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-muted">{subtitle}</p>
                            {metrics && (
                              <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted/80">{metrics}</p>
                            )}
                          </div>
                          <RunStatusBadge status={review.status} />
                        </button>
                      )}
                    </FramedCard>
                  </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 mt-4 text-[12.5px] text-fg-muted">
        <CheckCircle2 size={14} className="text-success shrink-0" />
        Every finding is verified before it reaches you.
      </div>
    </ReviewPageShell>
  );
}
