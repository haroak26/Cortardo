import { useState } from 'react';
import { ListChecks, Plus, Search } from 'lucide-react';
import { Button } from '@/components/button';
import { Badge } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import { ReviewPageShell } from '@/components/review/bits';
import { rules, timeAgo } from '@/lib/mock-review-data';

export default function BotRulesPage() {
  const [search, setSearch] = useState('');

  const filtered = rules.filter(
    (rule) =>
      rule.instruction.toLowerCase().includes(search.toLowerCase()) ||
      (rule.glob ?? '').toLowerCase().includes(search.toLowerCase()) ||
      rule.scope.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <ReviewPageShell
      title="Rules"
      description="Instructions the bot applies to every review it runs."
      actions={
        <Button size="sm">
          <Plus size={15} />
          New rule
        </Button>
      }
    >
      <div className="relative mb-6">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rules..."
          aria-label="Search rules"
          className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ListChecks size={32} className="text-fg-faint mb-3" strokeWidth={1.5} />
          <p className="text-[14px] font-medium text-foreground">No rules yet</p>
          <p className="text-[12px] text-fg-muted mt-1">Add a rule to steer what the bot looks for.</p>
        </div>
      ) : (
        <FramedCard>
          <ul>
            {filtered.map((rule) => (
              <li key={rule.id} className="border-b border-border-subtle last:border-b-0">
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] text-foreground leading-snug">{rule.instruction}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {rule.glob && (
                        <span className="text-[11.5px] font-mono text-fg-soft bg-surface-hover rounded-[6px] px-1.5 py-0.5">
                          {rule.glob}
                        </span>
                      )}
                      <span className="text-[11.5px] text-fg-muted">{rule.scope}</span>
                      <span className="text-[11.5px] text-fg-faint">· added {timeAgo(rule.createdAt)}</span>
                    </div>
                  </div>
                  <Badge tone={rule.enabled ? 'success' : 'neutral'}>{rule.enabled ? 'Active' : 'Paused'}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </FramedCard>
      )}
    </ReviewPageShell>
  );
}
