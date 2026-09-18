import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, EyeOff, Plus, X } from 'lucide-react';
import { Button } from '@/components/button';
import { EmptyState, ListSkeleton } from '@/components/ds';
import { TextInput } from '@/components/text-input';
import { TinyToggle } from '@/components/ui/tiny-toggle';
import { ReviewPageShell } from '@/components/review/bits';
import { SettingsCard, SettingsRow } from '@/components/settings-ui';
import { BotStatusFilter, RepoScopeSelect, type BotStatusFilterValue } from '@/components/bot/bot-ui';
import { InfoChipHover } from '@/components/info-chip';
import { timeAgo } from '@/lib/mock-review-data';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useBotExclusions,
  useCreateExclusion,
  useDeleteExclusion,
  useUpdateExclusion,
  type ApiExclusion,
} from '@/hooks/use-bot-memory';

export default function BotExclusionsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [status, setStatus] = useState<BotStatusFilterValue>('all');
  const [showForm, setShowForm] = useState(false);
  const [pattern, setPattern] = useState('');
  const [note, setNote] = useState('');
  const [repositoryId, setRepositoryId] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editRepositoryId, setEditRepositoryId] = useState('');
  const formRef = useRef<HTMLDivElement | null>(null);

  const { data: exclusions = [], isLoading, error } = useBotExclusions(activeWorkspaceId);
  const createExclusion = useCreateExclusion(activeWorkspaceId);
  const updateExclusion = useUpdateExclusion();
  const deleteExclusion = useDeleteExclusion();

  const filtered = useMemo(
    () =>
      exclusions.filter((exclusion) => {
        if (status === 'active' && !exclusion.enabled) return false;
        if (status === 'paused' && exclusion.enabled) return false;
        return true;
      }),
    [exclusions, status],
  );

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

  useEffect(() => {
    if (!showForm) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !formRef.current || formRef.current.contains(target)) return;
      if (!pattern.trim() && !note.trim()) resetForm();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, pattern, note]);

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
        <>
          <Button
            design="pill"
            icon={Plus}
            className="hover:!bg-primary active:!bg-primary"
            onClick={() => (showForm ? resetForm() : setShowForm(true))}
          >
            Add Exclusion
          </Button>
          <BotStatusFilter value={status} onChange={setStatus} />
        </>
      }
    >
      {showForm && (
        <div ref={formRef}>
          <SettingsCard className="mb-4 rounded-[22px] overflow-visible">
          <div className="space-y-3 py-[12px]">
            <TextInput
              autoFocus
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="e.g. **/generated/** or *.lock"
              aria-label="Exclusion pattern"
              className="font-mono text-[13px] md:text-[13px]"
            />
            <TextInput
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional — reason for excluding these files"
              aria-label="Exclusion note"
              className="text-[13px] md:text-[13px]"
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <p className="max-w-[340px] text-[11.5px] leading-snug text-fg-warm">
                Matching files are skipped in every review. Use{' '}
                <code className="rounded-[4px] bg-surface-hover px-1 py-0.5 font-mono text-[10.5px]">*</code>{' '}
                for one folder level and{' '}
                <code className="rounded-[4px] bg-surface-hover px-1 py-0.5 font-mono text-[10.5px]">**</code>{' '}
                for any depth.
              </p>
              <div className="flex shrink-0 items-center justify-end gap-2">
                <Button
                  design="pill"
                  onClick={submit}
                  isLoading={createExclusion.isPending}
                  disabled={!pattern.trim()}
                >
                  Add
                </Button>
                <RepoScopeSelect
                  value={repositoryId}
                  onChange={setRepositoryId}
                  className="sm:w-[150px]"
                />
              </div>
            </div>
            {createExclusion.error && (
              <p className="text-[12px] text-destructive">{(createExclusion.error as Error).message}</p>
            )}
          </div>
        </SettingsCard>
        </div>
      )}

      {error && <p className="mb-4 text-[13px] text-destructive">{(error as Error).message}</p>}

      {isLoading ? (
        <ListSkeleton rows={4} className="[&>*]:px-0" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={EyeOff}
          title={exclusions.length === 0 ? 'Nothing excluded' : 'No matching exclusions'}
          description={
            exclusions.length === 0
              ? 'Add glob patterns to keep generated code, vendored files or fixtures out of reviews.'
              : 'Try a different status filter.'
          }
          actions={
            exclusions.length === 0 ? (
              <Button design="pill" icon={Plus} onClick={() => setShowForm(true)}>
                Add Exclusion
              </Button>
            ) : undefined
          }
        />
      ) : (
        <SettingsCard className="overflow-visible">
          {filtered.map((exclusion) => {
            if (editingId === exclusion.id) {
              return (
                <div key={exclusion.id} className="space-y-3 py-[12px]">
                  <TextInput
                    autoFocus
                    value={editPattern}
                    onChange={(event) => setEditPattern(event.target.value)}
                    aria-label="Edit exclusion pattern"
                    className="font-mono text-[13px] md:text-[13px]"
                  />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <TextInput
                      value={editNote}
                      onChange={(event) => setEditNote(event.target.value)}
                      placeholder="Optional — reason for excluding these files"
                      aria-label="Edit exclusion note"
                      className="text-[13px] md:text-[13px]"
                    />
                    <RepoScopeSelect value={editRepositoryId} onChange={setEditRepositoryId} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      size="xs"
                      design="ghost"
                      className="text-destructive"
                      onClick={() => deleteExclusion.mutate(exclusion.id)}
                    >
                      Delete
                    </Button>
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
                </div>
              );
            }
            return (
              <SettingsRow
                key={exclusion.id}
                label={
                  <span className="min-w-0">
                    <span className="inline-flex h-[22px] items-center rounded-[6px] bg-surface-hover px-1.5 font-mono text-[12px] leading-none text-foreground">
                      {exclusion.pattern}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-[11.5px] text-fg-muted">{exclusion.scope}</span>
                      {exclusion.note && (
                        <span className="text-[11.5px] text-fg-faint">· {exclusion.note}</span>
                      )}
                      <span className="text-[11.5px] text-fg-faint">· added {timeAgo(exclusion.createdAt)}</span>
                    </span>
                  </span>
                }
              >
                <span className="flex items-center gap-2">
                  <InfoChipHover label={exclusion.enabled ? 'Active' : 'Paused'}>
                    <TinyToggle
                      checked={exclusion.enabled}
                      onCheckedChange={(checked) =>
                        updateExclusion.mutate({ id: exclusion.id, enabled: checked })
                      }
                      aria-label={exclusion.enabled ? 'Pause exclusion' : 'Enable exclusion'}
                    />
                  </InfoChipHover>
                  <Button design="pill-secondary" size="xs" onClick={() => startEdit(exclusion)}>
                    Edit
                  </Button>
                </span>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      )}
    </ReviewPageShell>
  );
}
