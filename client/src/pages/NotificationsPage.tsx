import { useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  Bot,
  CheckCheck,
  GitPullRequest,
  ShieldAlert,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { ReviewPageShell } from '@/components/review/bits';
import { Button } from '@/components/button';
import { FramedCard } from '@/components/framed-card';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { notifications as seed, timeAgo, type NotificationKind } from '@/lib/mock-review-data';

type FilterId = 'all' | 'unread';

const KIND_META: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  review: { icon: GitPullRequest, tone: 'text-brand' },
  finding: { icon: ShieldAlert, tone: 'text-danger' },
  bot: { icon: Bot, tone: 'text-info' },
  team: { icon: Users, tone: 'text-success' },
  system: { icon: Sparkles, tone: 'text-warning' },
};

export default function NotificationsPage() {
  const { toast } = useToast();
  const [items, setItems] = useState(() => seed.map((item) => ({ ...item })));
  const [filter, setFilter] = useState<FilterId>('all');

  const unread = items.filter((item) => !item.read).length;

  const filtered = useMemo(
    () => (filter === 'unread' ? items.filter((item) => !item.read) : items),
    [items, filter],
  );

  const markAllRead = () => {
    setItems((prev) => prev.map((item) => ({ ...item, read: true })));
    toast({ title: 'All notifications marked as read' });
  };

  const markRead = (id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)));
  };

  return (
    <ReviewPageShell
      title="Notifications"
      description="Review results, findings, and workspace updates."
      actions={
        <Button size="sm" design="secondary" onClick={markAllRead} disabled={unread === 0}>
          <CheckCheck size={15} />
          Mark all read
        </Button>
      }
    >
      <div className="mb-5 flex items-center gap-1">
        {(['all', 'unread'] as const).map((option) => {
          const active = option === filter;
          const label = option === 'all' ? 'All' : `Unread${unread > 0 ? ` (${unread})` : ''}`;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              aria-pressed={active}
              className={cn(
                'h-[30px] rounded-[10px] px-3 text-[12.5px] font-medium transition-colors border-none cursor-pointer',
                active
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-transparent text-fg-muted hover:bg-surface-hover hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BellOff size={32} className="mb-3 text-fg-faint" strokeWidth={1.5} />
          <p className="text-[14px] font-medium text-foreground">You're all caught up</p>
          <p className="text-[12px] text-fg-muted mt-1">New activity will show up here.</p>
        </div>
      ) : (
        <FramedCard>
          <ul>
            {filtered.map((item) => {
              const meta = KIND_META[item.kind];
              const Icon = meta.icon;
              return (
                <li key={item.id} className="border-b border-border-subtle last:border-b-0">
                  <button
                    type="button"
                    onClick={() => markRead(item.id)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-hover/50',
                      !item.read && 'bg-brand/[0.03]',
                    )}
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-hover">
                      <Icon size={14} className={meta.tone} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium leading-snug text-foreground">
                        {item.title}
                      </p>
                      <p className="mt-1 text-[12.5px] leading-snug text-fg-muted">{item.body}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                      {!item.read && <span className="h-2 w-2 rounded-full bg-brand" />}
                      <span className="whitespace-nowrap text-[11.5px] tabular-nums text-fg-faint">
                        {timeAgo(item.createdAt)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </FramedCard>
      )}

      <div className="mt-4 flex items-center gap-2 text-[12.5px] text-fg-muted">
        <Bell size={14} className="text-fg-faint shrink-0" />
        Notification email preferences live in your account settings.
      </div>
    </ReviewPageShell>
  );
}
