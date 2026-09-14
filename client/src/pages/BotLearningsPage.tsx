import { useState } from 'react';
import { GraduationCap, Plus, Search, ThumbsUp, ThumbsDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/button';
import { Badge } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import { ReviewPageShell } from '@/components/review/bits';
import { timeAgo } from '@/lib/mock-review-data';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useBotLearnings,
  useCreateLearning,
  useDeleteLearning,
  useUpdateLearning,
} from '@/hooks/use-bot-memory';

export default function BotLearningsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');

  const { data: learnings = [], isLoading, error } = useBotLearnings(activeWorkspaceId);
  const createLearning = useCreateLearning(activeWorkspaceId);
  const updateLearning = useUpdateLearning();
  const deleteLearning = useDeleteLearning();

  const filtered = learnings.filter(
    (entry) =>
      entry.text.toLowerCase().includes(search.toLowerCase()) ||
      entry.scope.toLowerCase().includes(search.toLowerCase()),
  );

  const submit = () => {
    if (text.trim().length < 3) return;
    createLearning.mutate(
      { text: text.trim() },
      {
        onSuccess: () => {
          setText('');
          setShowForm(false);
        },
      },
    );
  };

  return (
    <ReviewPageShell
      title="Learnings"
      description="What the bot has learned from your team's feedback on past findings."
      actions={
        <Button size="sm" onClick={() => setShowForm((value) => !value)}>
          <Plus size={15} />
          Teach the bot
        </Button>
      }
    >
      {showForm && (
        <FramedCard>
          <div className="p-4 space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. The team considers round-trip currency tests authoritative. Do not flag arithmetic in test fixtures."
              aria-label="Learning text"
              rows={3}
              className="w-full p-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none resize-none"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={submit} disabled={createLearning.isPending || text.trim().length < 3}>
                {createLearning.isPending ? 'Saving…' : 'Save learning'}
              </Button>
            </div>
            {createLearning.error && (
              <p className="text-[12px] text-destructive">{(createLearning.error as Error).message}</p>
            )}
          </div>
        </FramedCard>
      )}

      <div className="relative mb-6 mt-6">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search learnings..."
          aria-label="Search learnings"
          className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
        />
      </div>

      {error && <p className="text-[13px] text-destructive mb-4">{(error as Error).message}</p>}

      {isLoading ? (
        <p className="text-[13px] text-fg-muted">Loading learnings…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <GraduationCap size={32} className="text-fg-faint mb-3" strokeWidth={1.5} />
          <p className="text-[14px] font-medium text-foreground">Nothing learned yet</p>
          <p className="text-[12px] text-fg-muted mt-1">
            Dismiss a finding and the bot will skip patterns like it from now on.
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
                    <button
                      type="button"
                      onClick={() => updateLearning.mutate({ id: entry.id, active: !entry.active })}
                      className="border-none bg-transparent cursor-pointer"
                      aria-label={entry.active ? 'Pause learning' : 'Activate learning'}
                    >
                      <Badge tone={entry.active ? 'success' : 'neutral'}>{entry.active ? 'Active' : 'Paused'}</Badge>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteLearning.mutate(entry.id)}
                      className="text-fg-faint hover:text-destructive transition-colors border-none bg-transparent cursor-pointer"
                      aria-label="Delete learning"
                    >
                      <Trash2 size={14} />
                    </button>
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
