import { useState } from 'react';
import { GraduationCap, Search, ThumbsUp, ThumbsDown } from 'lucide-react';
import { FramedCard } from '@/components/framed-card';
import { ReviewPageShell } from '@/components/review/bits';
import { learnings, timeAgo } from '@/lib/mock-review-data';

export default function BotLearningsPage() {
  const [search, setSearch] = useState('');

  const filtered = learnings.filter(
    (entry) =>
      entry.text.toLowerCase().includes(search.toLowerCase()) ||
      entry.scope.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <ReviewPageShell
      title="Learnings"
      description="What the bot has learned from your team's feedback on past findings."
    >
      <div className="relative mb-6">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search learnings..."
          aria-label="Search learnings"
          className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <GraduationCap size={32} className="text-fg-faint mb-3" strokeWidth={1.5} />
          <p className="text-[14px] font-medium text-foreground">Nothing learned yet</p>
          <p className="text-[12px] text-fg-muted mt-1">
            Accept or dismiss findings and the bot will adapt to your codebase.
          </p>
        </div>
      ) : (
        <FramedCard>
          <ul>
            {filtered.map((entry) => (
              <li key={entry.id} className="border-b border-border-subtle last:border-b-0">
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] text-foreground leading-snug">{entry.text}</p>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-[11.5px] text-fg-muted">
                      <span>{entry.scope}</span>
                      <span className="text-fg-faint">· {entry.source}</span>
                      <span className="text-fg-faint">· learned {timeAgo(entry.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 pt-0.5">
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-success tabular-nums">
                      <ThumbsUp size={11} />
                      {entry.accepted}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-fg-muted tabular-nums">
                      <ThumbsDown size={11} />
                      {entry.rejected}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </FramedCard>
      )}
    </ReviewPageShell>
  );
}
