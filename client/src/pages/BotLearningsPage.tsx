import { useMemo, useState } from 'react';
import { Check, GraduationCap, Pencil, Plus, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import { Button } from '@/components/button';
import { Badge, EmptyState, ListSkeleton, PillFilter } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import { Textarea } from '@/components/text-input';
import { ReviewPageShell } from '@/components/review/bits';
import { BotSearch, BotStat, RepoScopeSelect } from '@/components/bot/bot-ui';
import { timeAgo } from '@/lib/mock-review-data';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useBotLearnings,
  useCreateLearning,
  useDeleteLearning,
  useUpdateLearning,
  type ApiLearning,
} from '@/hooks/use-bot-memory';

type StatusFilter = 'all' | 'active' | 'paused';

const SOURCE_META: Record<ApiLearning['source'], { label: string; tone: 'neutral' | 'brand' | 'info' }> = {
  feedback: { label: 'From feedback', tone: 'info' },
  rule: { label: 'From rule', tone: 'brand' },
  manual: { label: 'Taught manually', tone: 'neutral' },
};

export default function BotLearningsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState('');
  const [repositoryId, setRepositoryId] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editRepositoryId, setEditRepositoryId] = useState('');

  const { data: learnings = [], isLoading, error } = useBotLearnings(activeWorkspaceId);
  const createLearning = useCreateLearning(activeWorkspaceId);
  const updateLearning = useUpdateLearning();
  const deleteLearning = useDeleteLearning();

  const counts = useMemo(
    () => ({
      total: learnings.length,
      active: learnings.filter((entry) => entry.active).length,
      accepted: learnings.reduce((sum, entry) => sum + entry.accepted, 0),
      rejected: learnings.reduce((sum, entry) => sum + entry.rejected, 0),
    }),
    [learnings],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return learnings.filter((entry) => {
      if (status === 'active' && !entry.active) return false;
      if (status === 'paused' && entry.active) return false;
      if (!query) return true;
      return entry.text.toLowerCase().includes(query) || entry.scope.toLowerCase().includes(query);
    });
  }, [learnings, search, status]);

  const resetForm = () => {
    setText('');
    setRepositoryId('');
    setShowForm(false);
  };

  const submit = () => {
    if (text.trim().length < 3) return;
    createLearning.mutate(
      { text: text.trim(), repositoryId: repositoryId || null },
      { onSuccess: resetForm },
    );
  };

  const startEdit = (entry: ApiLearning) => {
    setEditingId(entry.id);
    setEditText(entry.text);
    setEditRepositoryId(entry.repositoryId ?? '');
  };

  const saveEdit = () => {
    if (!editingId || editText.trim().length < 3) return;
    updateLearning.mutate(
      { id: editingId, text: editText.trim(), repositoryId: editRepositoryId || null },
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <ReviewPageShell
      title="Learnings"
      description="What the bot has learned from your team's feedback on past findings."
      actions={
        <Button size="sm" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          <Plus size={15} />
          Teach the bot
        </Button>
      }
    >
      {showForm && (
        <FramedCard className="mb-5">
          <div className="space-y-3 p-4">
            <Textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="e.g. The team considers round-trip currency tests authoritative. Do not flag arithmetic in test fixtures."
              aria-label="Learning text"
              rows={3}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <RepoScopeSelect value={repositoryId} onChange={setRepositoryId} />
              <Button
                size="sm"
                onClick={submit}
                isLoading={createLearning.isPending}
                disabled={text.trim().length < 3}
              >
                Save learning
              </Button>
            </div>
            {createLearning.error && (
              <p className="text-[12px] text-destructive">{(createLearning.error as Error).message}</p>
            )}
          </div>
        </FramedCard>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-6">
          <BotStat label="Learnings" value={counts.total} />
          <BotStat label="Active" value={counts.active} tone="success" />
          <BotStat label="Upvotes" value={counts.accepted} tone="success" />
          <BotStat label="Downvotes" value={counts.rejected} tone="muted" />
        </div>
        <div className="flex items-center gap-2">
          <PillFilter active={status === 'all'} onClick={() => setStatus('all')}>
            All
          </PillFilter>
          <PillFilter active={status === 'active'} onClick={() => setStatus('active')}>
            Active
          </PillFilter>
          <PillFilter active={status === 'paused'} onClick={() => setStatus('paused')}>
            Paused
          </PillFilter>
        </div>
      </div>

      <BotSearch value={search} onChange={setSearch} placeholder="Search learnings…" className="mb-5" />

      {error && <p className="mb-4 text-[13px] text-destructive">{(error as Error).message}</p>}

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={learnings.length === 0 ? 'Nothing learned yet' : 'No matching learnings'}
          description={
            learnings.length === 0
              ? 'Teach the bot directly, or dismiss a finding and the bot will skip patterns like it from now on.'
              : 'Try a different search or status filter.'
          }
          actions={
            learnings.length === 0 ? (
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus size={15} />
                Teach the bot
              </Button>
            ) : undefined
          }
        />
      ) : (
        <FramedCard>
          <ul>
            {filtered.map((entry) => {
              const editing = editingId === entry.id;
              const source = SOURCE_META[entry.source] ?? SOURCE_META.manual;
              return (
                <li key={entry.id} className="border-b border-border-subtle last:border-b-0">
                  {editing ? (
                    <div className="space-y-3 px-4 py-4">
                      <Textarea
                        autoFocus
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        aria-label="Edit learning"
                        rows={3}
                      />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <RepoScopeSelect value={editRepositoryId} onChange={setEditRepositoryId} />
                        <div className="flex items-center gap-2">
                          <Button size="xs" onClick={saveEdit} isLoading={updateLearning.isPending}>
                            <Check size={13} />
                            Save
                          </Button>
                          <Button size="xs" design="ghost" onClick={() => setEditingId(null)}>
                            <X size={13} />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] leading-snug text-foreground">{entry.text}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Badge tone={source.tone}>{source.label}</Badge>
                          <span className="text-[11.5px] text-fg-muted">{entry.scope}</span>
                          <span className="text-[11.5px] text-fg-faint">· learned {timeAgo(entry.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 pt-0.5">
                        <span
                          className="inline-flex items-center gap-1 text-[11.5px] tabular-nums text-success"
                          title={`${entry.accepted} accepted`}
                        >
                          <ThumbsUp size={11} />
                          {entry.accepted}
                        </span>
                        <span
                          className="inline-flex items-center gap-1 text-[11.5px] tabular-nums text-fg-muted"
                          title={`${entry.rejected} rejected`}
                        >
                          <ThumbsDown size={11} />
                          {entry.rejected}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateLearning.mutate({ id: entry.id, active: !entry.active })}
                          className="cursor-pointer border-none bg-transparent p-0"
                          aria-label={entry.active ? 'Pause learning' : 'Activate learning'}
                        >
                          <Badge tone={entry.active ? 'success' : 'neutral'}>
                            {entry.active ? 'Active' : 'Paused'}
                          </Badge>
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(entry)}
                          className="cursor-pointer rounded-[6px] border-none bg-transparent p-1 text-fg-faint transition-colors hover:text-foreground"
                          aria-label="Edit learning"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteLearning.mutate(entry.id)}
                          className="cursor-pointer rounded-[6px] border-none bg-transparent p-1 text-fg-faint transition-colors hover:text-destructive"
                          aria-label="Delete learning"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </FramedCard>
      )}
    </ReviewPageShell>
  );
}
