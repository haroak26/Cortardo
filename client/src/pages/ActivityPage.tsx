import { useMemo, useState } from 'react';
import {
  Activity,
  BookPlus,
  GitPullRequest,
  GraduationCap,
  Plug,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ReviewPageShell } from '@/components/review/bits';
import { FramedCard } from '@/components/framed-card';
import { cn } from '@/lib/utils';
import { activityEvents, timeAgo, type ActivityKind } from '@/lib/mock-review-data';

type FilterId = 'all' | 'reviews' | 'findings' | 'bot' | 'team';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'findings', label: 'Findings' },
  { id: 'bot', label: 'Bot' },
  { id: 'team', label: 'Team' },
];

const ACTIVITY_META: Record<ActivityKind, { icon: LucideIcon; tone: string }> = {
  review_started: { icon: GitPullRequest, tone: 'text-brand' },
  review_completed: { icon: ShieldCheck, tone: 'text-success' },
  review_failed: { icon: XCircle, tone: 'text-danger' },
  finding_fixed: { icon: ShieldCheck, tone: 'text-success' },
  finding_dismissed: { icon: ShieldAlert, tone: 'text-fg-muted' },
  rule_added: { icon: BookPlus, tone: 'text-brand' },
  learning_added: { icon: GraduationCap, tone: 'text-brand' },
  member_joined: { icon: UserPlus, tone: 'text-success' },
  repo_connected: { icon: Plug, tone: 'text-info' },
};

const KIND_GROUPS: Record<FilterId, ActivityKind[] | null> = {
  all: null,
  reviews: ['review_started', 'review_completed', 'review_failed'],
  findings: ['finding_fixed', 'finding_dismissed'],
  bot: ['rule_added', 'learning_added'],
  team: ['member_joined', 'repo_connected'],
};

function matches(kind: ActivityKind, filter: FilterId): boolean {
  const group = KIND_GROUPS[filter];
  return group === null || group.includes(kind);
}

export default function ActivityPage() {
  const [filter, setFilter] = useState<FilterId>('all');

  const filtered = useMemo(
    () => activityEvents.filter((event) => matches(event.kind, filter)),
    [filter],
  );

  return (
    <ReviewPageShell
      title="Activity"
      description="Everything that happened across reviews, findings, and your team."
    >
      <div className="mb-5 flex items-center gap-1">
        {FILTERS.map((option) => {
          const active = option.id === filter;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={active}
              className={`h-[30px] rounded-[10px] px-3 text-[12.5px] font-medium transition-colors border-none cursor-pointer ${
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

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity size={32} className="mb-3 text-fg-faint" strokeWidth={1.5} />
          <p className="text-[14px] font-medium text-foreground">No activity in this view</p>
          <p className="text-[12px] text-fg-muted mt-1">Try a different filter.</p>
        </div>
      ) : (
        <FramedCard>
          <ul>
            {filtered.map((event) => {
              const meta = ACTIVITY_META[event.kind];
              const Icon = meta.icon;
              return (
                <li key={event.id} className="border-b border-border-subtle last:border-b-0">
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-hover">
                      <Icon size={14} className={meta.tone} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] leading-snug text-foreground">
                        <span className="font-medium">{event.actor}</span> {event.text}
                      </p>
                      {event.repository && (
                        <p className="mt-1 truncate font-mono text-[11.5px] text-fg-muted">
                          {event.repository}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11.5px] tabular-nums text-fg-faint">
                      {timeAgo(event.createdAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </FramedCard>
      )}
    </ReviewPageShell>
  );
}
