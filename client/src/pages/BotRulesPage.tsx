import { useMemo, useState } from 'react';
import { Check, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/button';
import { Badge, EmptyState, ListSkeleton, PillFilter } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import { TextInput, Textarea } from '@/components/text-input';
import { ReviewPageShell } from '@/components/review/bits';
import { BotSearch, BotStat, RepoScopeSelect } from '@/components/bot/bot-ui';
import { timeAgo } from '@/lib/mock-review-data';
import { useWorkspace } from '@/contexts/workspace-context';
import { useBotRules, useCreateRule, useDeleteRule, useUpdateRule, type ApiRule } from '@/hooks/use-bot-memory';

type StatusFilter = 'all' | 'active' | 'paused';

function RuleMeta({ rule }: { rule: ApiRule }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-1.5">
      {rule.glob && (
        <span className="rounded-[6px] bg-surface-hover px-1.5 py-0.5 font-mono text-[11.5px] text-fg-soft">
          {rule.glob}
        </span>
      )}
      <span className="text-[11.5px] text-fg-muted">{rule.scope}</span>
      <span className="text-[11.5px] text-fg-faint">· added {timeAgo(rule.createdAt)}</span>
    </div>
  );
}

export default function BotRulesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [glob, setGlob] = useState('');
  const [repositoryId, setRepositoryId] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [editGlob, setEditGlob] = useState('');
  const [editRepositoryId, setEditRepositoryId] = useState('');

  const { data: rules = [], isLoading, error } = useBotRules(activeWorkspaceId);
  const createRule = useCreateRule(activeWorkspaceId);
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();

  const counts = useMemo(
    () => ({
      total: rules.length,
      active: rules.filter((rule) => rule.enabled).length,
      paused: rules.filter((rule) => !rule.enabled).length,
    }),
    [rules],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rules.filter((rule) => {
      if (status === 'active' && !rule.enabled) return false;
      if (status === 'paused' && rule.enabled) return false;
      if (!query) return true;
      return (
        rule.instruction.toLowerCase().includes(query) ||
        (rule.glob ?? '').toLowerCase().includes(query) ||
        rule.scope.toLowerCase().includes(query)
      );
    });
  }, [rules, search, status]);

  const resetForm = () => {
    setInstruction('');
    setGlob('');
    setRepositoryId('');
    setShowForm(false);
  };

  const submit = () => {
    if (instruction.trim().length < 3) return;
    createRule.mutate(
      {
        instruction: instruction.trim(),
        glob: glob.trim() || null,
        repositoryId: repositoryId || null,
      },
      { onSuccess: resetForm },
    );
  };

  const startEdit = (rule: ApiRule) => {
    setEditingId(rule.id);
    setEditInstruction(rule.instruction);
    setEditGlob(rule.glob ?? '');
    setEditRepositoryId(rule.repositoryId ?? '');
  };

  const saveEdit = () => {
    if (!editingId || editInstruction.trim().length < 3) return;
    updateRule.mutate(
      {
        id: editingId,
        instruction: editInstruction.trim(),
        glob: editGlob.trim() || null,
        repositoryId: editRepositoryId || null,
      },
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <ReviewPageShell
      title="Rules"
      description="Standing instructions the bot applies to every review it runs."
      actions={
        <Button size="sm" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          <Plus size={15} />
          New rule
        </Button>
      }
    >
      {showForm && (
        <FramedCard className="mb-5">
          <div className="space-y-3 p-4">
            <Textarea
              autoFocus
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="e.g. All queries must use bound parameters. Flag string interpolation in SQL."
              aria-label="Rule instruction"
              rows={2}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <TextInput
                value={glob}
                onChange={(event) => setGlob(event.target.value)}
                placeholder="Glob (optional), e.g. src/**/*.ts"
                aria-label="Rule glob"
                className="font-mono text-[13px]"
              />
              <RepoScopeSelect value={repositoryId} onChange={setRepositoryId} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-fg-muted">
                Scoped rules only apply to the selected repository.
              </p>
              <Button
                size="sm"
                onClick={submit}
                isLoading={createRule.isPending}
                disabled={instruction.trim().length < 3}
              >
                Add rule
              </Button>
            </div>
            {createRule.error && <p className="text-[12px] text-destructive">{(createRule.error as Error).message}</p>}
          </div>
        </FramedCard>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-6">
          <BotStat label="Rules" value={counts.total} />
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

      <BotSearch value={search} onChange={setSearch} placeholder="Search rules…" className="mb-5" />

      {error && <p className="mb-4 text-[13px] text-destructive">{(error as Error).message}</p>}

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={rules.length === 0 ? 'No rules yet' : 'No matching rules'}
          description={
            rules.length === 0
              ? 'Add a rule to steer what the bot looks for in every review.'
              : 'Try a different search or status filter.'
          }
          actions={
            rules.length === 0 ? (
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus size={15} />
                New rule
              </Button>
            ) : undefined
          }
        />
      ) : (
        <FramedCard>
          <ul>
            {filtered.map((rule) => {
              const editing = editingId === rule.id;
              return (
                <li key={rule.id} className="border-b border-border-subtle last:border-b-0">
                  {editing ? (
                    <div className="space-y-3 px-4 py-4">
                      <Textarea
                        autoFocus
                        value={editInstruction}
                        onChange={(event) => setEditInstruction(event.target.value)}
                        aria-label="Edit rule instruction"
                        rows={2}
                      />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <TextInput
                          value={editGlob}
                          onChange={(event) => setEditGlob(event.target.value)}
                          placeholder="Glob (optional)"
                          aria-label="Edit rule glob"
                          className="font-mono text-[13px]"
                        />
                        <RepoScopeSelect value={editRepositoryId} onChange={setEditRepositoryId} />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="xs" onClick={saveEdit} isLoading={updateRule.isPending}>
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
                        <p className="text-[13.5px] leading-snug text-foreground">{rule.instruction}</p>
                        <RuleMeta rule={rule} />
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => updateRule.mutate({ id: rule.id, enabled: !rule.enabled })}
                          className="cursor-pointer border-none bg-transparent p-0"
                          aria-label={rule.enabled ? 'Pause rule' : 'Enable rule'}
                        >
                          <Badge tone={rule.enabled ? 'success' : 'neutral'}>{rule.enabled ? 'Active' : 'Paused'}</Badge>
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(rule)}
                          className="cursor-pointer rounded-[6px] border-none bg-transparent p-1 text-fg-faint transition-colors hover:text-foreground"
                          aria-label="Edit rule"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule.mutate(rule.id)}
                          className="cursor-pointer rounded-[6px] border-none bg-transparent p-1 text-fg-faint transition-colors hover:text-destructive"
                          aria-label="Delete rule"
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
