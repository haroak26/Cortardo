import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, GitPullRequest, Plus, CheckCircle2, Minus } from 'lucide-react';
import { Button } from '@/components/button';
import { FramedCard } from '@/components/framed-card';
import { ReviewPageShell, MarkedDivider } from '@/components/review/bits';
import { DiagnoseWorkbench } from '@/components/review/codegraph/DiagnoseWorkbench';
import { recentReviews, type RunStatus } from '@/lib/mock-review-data';

type FilterId = 'all' | 'running' | 'completed' | 'failed';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

const RUNNING: RunStatus[] = ['queued', 'indexing', 'planning', 'reviewing', 'verifying', 'summarizing'];

function matches(status: RunStatus, filter: FilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return RUNNING.includes(status);
  if (filter === 'completed') return status === 'done';
  return status === 'error' || status === 'cancelled';
}

export default function ReviewsPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');

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
      recentReviews.filter(
        (review) =>
          matches(review.status, filter) &&
          (review.title.toLowerCase().includes(query.toLowerCase()) ||
            review.repository.toLowerCase().includes(query.toLowerCase())),
      ),
    [query, filter],
  );

  return (
    <ReviewPageShell
      title="Reviews"
      description="Every review the bot has run, with the findings it produced."
      actions={
        <Button size="sm" onClick={() => openDiagnose(recentReviews[0]?.id ?? 'rv_01')}>
          <Plus size={15} />
          Diagnose Error
        </Button>
      }
    >
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
          <p className="text-[12px] text-fg-muted mt-1">Try a different filter, or start a new review.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((review) => {
            const isTarget = review.id === activeId;
            const isOpen = review.id === diagnoseId;

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
                          <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-muted">
                            {review.repository} #{review.number} · {review.author}
                          </p>
                        </button>
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
                            <DiagnoseWorkbench
                              repository={review.repository}
                              className="h-auto lg:h-[320px]"
                            />
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
                        <p className="mt-0.5 truncate font-mono text-[11.5px] text-fg-muted">
                          {review.repository} #{review.number} · {review.author}
                        </p>
                      </div>
                    </button>
                  )}
                </FramedCard>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4 text-[12.5px] text-fg-muted">
        <CheckCircle2 size={14} className="text-success shrink-0" />
        Every finding is verified before it reaches you.
      </div>
    </ReviewPageShell>
  );
}
