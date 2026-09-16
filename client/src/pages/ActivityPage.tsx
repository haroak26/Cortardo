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
import { SettingsCard, SettingsRow } from '@/components/settings-ui';
import {
  OpenDropdown,
  OpenDropdownBackdrop,
  OpenDropdownItem,
  OpenDropdownMenu,
} from '@/components/open-dropdown';
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
  const [filterOpen, setFilterOpen] = useState(false);

  const filtered = useMemo(
    () => activityEvents.filter((event) => matches(event.kind, filter)),
    [filter],
  );

  const activeFilter = FILTERS.find((option) => option.id === filter);

  return (
    <ReviewPageShell
      title="Activity"
      description="Everything that happened across reviews, findings, and your team."
      actions={
        <div className="relative min-w-[130px]">
          <OpenDropdown
            open={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
            aria-label="Filter activity"
            value={activeFilter?.label}
          />
          {filterOpen && (
            <>
              <OpenDropdownBackdrop onClick={() => setFilterOpen(false)} />
              <OpenDropdownMenu align="right">
                {FILTERS.map((option) => (
                  <OpenDropdownItem
                    key={option.id}
                    selected={option.id === filter}
                    onClick={() => {
                      setFilter(option.id);
                      setFilterOpen(false);
                    }}
                  >
                    {option.label}
                  </OpenDropdownItem>
                ))}
              </OpenDropdownMenu>
            </>
          )}
        </div>
      }
    >
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity size={32} className="mb-3 text-fg-faint" strokeWidth={1.5} />
          <p className="text-[14px] font-medium text-foreground">No activity in this view</p>
          <p className="text-[12px] text-fg-muted mt-1">Try a different filter.</p>
        </div>
      ) : (
        <SettingsCard>
          {filtered.map((event) => {
            const meta = ACTIVITY_META[event.kind];
            const Icon = meta.icon;
            return (
              <SettingsRow
                key={event.id}
                align="start"
                label={
                  <span className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-hover">
                      <Icon size={14} className={meta.tone} strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">
                        <span className="font-medium">{event.actor}</span> {event.text}
                      </span>
                      {event.repository && (
                        <span className="mt-0.5 block truncate font-mono text-[11.5px] font-normal text-fg-muted">
                          {event.repository}
                        </span>
                      )}
                    </span>
                  </span>
                }
              >
                <span className="whitespace-nowrap pt-0.5 text-[11.5px] tabular-nums text-fg-faint">
                  {timeAgo(event.createdAt)}
                </span>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      )}
    </ReviewPageShell>
  );
}
