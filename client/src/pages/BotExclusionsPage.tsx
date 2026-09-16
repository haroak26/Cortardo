import { useMemo, useState } from 'react';
import { Check, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/button';
import { Badge, EmptyState, ListSkeleton, PillFilter } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import { TextInput } from '@/components/text-input';
import { ReviewPageShell } from '@/components/review/bits';
import { BotSearch, BotStat, RepoScopeSelect } from '@/components/bot/bot-ui';
import { timeAgo } from '@/lib/mock-review-data';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useBotExclusions,
  useCreateExclusion,
  useDeleteExclusion,
  useUpdateExclusion,
  type ApiExclusion,
} from '@/hooks/use-bot-memory';

type StatusFilter = 'all' | 'active' | 'paused';

const SUGGESTIONS = ['dist/**', '**/*.snap', '**/*.min.js', 'vendor/**'];

export default function BotExclusionsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [pattern, setPattern] = useState('');
  const [note, setNote] = useState('');
  const [repositoryId, setRepositoryId] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editRepositoryId, setEditRepositoryId] = useState('');

  const { data: exclusions = [], isLoading, error } = useBotExclusions(activeWorkspaceId);
  const createExclusion = useCreateExclusion(activeWorkspaceId);
  const updateExclusion = useUpdateExclusion();
  const deleteExclusion = useDeleteExclusion();

  const counts = useMemo(
    () => ({
      total: exclusions.length,
      active: exclusions.filter((exclusion) => exclusion.enabled).length,
      paused: exclusions.filter((exclusion) => !exclusion.enabled).length,
    }),
    [exclusions],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return exclusions.filter((exclusion) => {
      if (status === 'active' && !exclusion.enabled) return false;
      if (status === 'paused' && exclusion.enabled) return false;
      if (!query) return true;
      return (
        exclusion.pattern.toLowerCase().includes(query) ||
        (exclusion.note ?? '').toLowerCase().includes(query)
      );
    });
  }, [exclusions, search, status]);

  const resetForm = () => {
    setPattern('');
    setNote('');
    setRepositoryId('');
    setShowForm(false);
  };

  const submit = () => {
    if (!pattern.trim()) return;
    createExclusion.mutate(
      { pattern: pattern.trim(), note: note.trim() || null, repositoryId: repositoryId || null },
      { onSuccess: resetForm },
    );
  };

  const startEdit = (exclusion: ApiExclusion) => {
    setEditingId(exclusion.id);
    setEditPattern(exclusion.pattern);
    setEditNote(exclusion.note ?? '');
    setEditRepositoryId(exclusion.repositoryId ?? '');
  };

  const saveEdit = () => {
    if (!editingId || !editPattern.trim()) return;
    updateExclusion.mutate(
      {
        id: editingId,
        pattern: editPattern.trim(),
        note: editNote.trim() || null,
        repositoryId: editRepositoryId || null,
      },
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <ReviewPageShell
      title="Exclusions"
      description="Paths the bot never reviews. Matching files are skipped before a run starts."
      actions={
        <Button size="sm" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          <Plus size={15} />
          Add exclusion
        </Button>
      }
    >
      {showForm && (
        <FramedCard className="mb-5">
          <div className="space-y-3 p-4">
            <TextInput
              autoFocus
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="Glob pattern, e.g. src/generated/** or **/*.snap"
              aria-label="Exclusion pattern"
              className="font-mono text-[13px]"
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <TextInput
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why is this excluded? (optional)"
                aria-label="Exclusion note"
              />
              <RepoScopeSelect value={repositoryId} onChange={setRepositoryId} />
            </div>
            {exclusions.length === 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-fg-muted">Common:</span>
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setPattern(suggestion)}
                    className="cursor-pointer rounded-[6px] border-none bg-surface-hover px-1.5 py-0.5 font-mono text-[11.5px] text-fg-soft transition-colors hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-end">
              <Button
                size="sm"
                onClick={submit}
                isLoading={createExclusion.isPending}
                disabled={!pattern.trim()}
              >
                Add exclusion
              </Button>
            </div>
            {createExclusion.error && (
              <p className="text-[12px] text-destructive">{(createExclusion.error as Error).message}</p>
            )}
          </div>
        </FramedCard>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-6">
          <BotStat label="Exclusions" value={counts.total} />
          <BotStat label="Active" value={counts.active} tone="success" />
          <BotStat label="Paused" value={counts.paused} tone="muted" />
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

      <BotSearch value={search} onChange={setSearch} placeholder="Search exclusions…" className="mb-5" />

      {error && <p className="mb-4 text-[13px] text-destructive">{(error as Error).message}</p>}

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={EyeOff}
          title={exclusions.length === 0 ? 'Nothing excluded' : 'No matching exclusions'}
          description={
            exclusions.length === 0
              ? 'Add glob patterns to keep generated code, vendored files or fixtures out of reviews.'
              : 'Try a different search or status filter.'
          }
          actions={
            exclusions.length === 0 ? (
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus size={15} />
                Add exclusion
              </Button>
            ) : undefined
          }
        />
      ) : (
        <FramedCard>
          <ul>
            {filtered.map((exclusion) => {
              const editing = editingId === exclusion.id;
              return (
                <li key={exclusion.id} className="border-b border-border-subtle last:border-b-0">
                  {editing ? (
                    <div className="space-y-3 px-4 py-4">
                      <TextInput
                        autoFocus
                        value={editPattern}
                        onChange={(event) => setEditPattern(event.target.value)}
                        aria-label="Edit exclusion pattern"
                        className="font-mono text-[13px]"
                      />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <TextInput
                          value={editNote}
                          onChange={(event) => setEditNote(event.target.value)}
                          placeholder="Note (optional)"
                          aria-label="Edit exclusion note"
                        />
                        <RepoScopeSelect value={editRepositoryId} onChange={setEditRepositoryId} />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="xs" onClick={saveEdit} isLoading={updateExclusion.isPending}>
                          <Check size={13} />
                          Save
                        </Button>
                        <Button size="xs" design="ghost" onClick={() => setEditingId(null)}>
                          <X size={13} />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      <div className="min-w-0 flex-1">
                        <span className="inline-block rounded-[6px] bg-surface-hover px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                          {exclusion.pattern}
                        </span>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span className="text-[11.5px] text-fg-muted">{exclusion.scope}</span>
                          {exclusion.note && (
                            <span className="text-[11.5px] text-fg-faint">· {exclusion.note}</span>
                          )}
                          <span className="text-[11.5px] text-fg-faint">· added {timeAgo(exclusion.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => updateExclusion.mutate({ id: exclusion.id, enabled: !exclusion.enabled })}
                          className="cursor-pointer border-none bg-transparent p-0"
                          aria-label={exclusion.enabled ? 'Pause exclusion' : 'Enable exclusion'}
                        >
                          <Badge tone={exclusion.enabled ? 'success' : 'neutral'}>
                            {exclusion.enabled ? 'Active' : 'Paused'}
                          </Badge>
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(exclusion)}
                          className="cursor-pointer rounded-[6px] border-none bg-transparent p-1 text-fg-faint transition-colors hover:text-foreground"
                          aria-label="Edit exclusion"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteExclusion.mutate(exclusion.id)}
                          className="cursor-pointer rounded-[6px] border-none bg-transparent p-1 text-fg-faint transition-colors hover:text-destructive"
                          aria-label="Delete exclusion"
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
