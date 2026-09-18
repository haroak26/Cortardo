import { useMemo, useState } from 'react';
import { Check, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/button';
import { Badge, EmptyState, ListSkeleton } from '@/components/ds';
import { TextInput, Textarea } from '@/components/text-input';
import { ReviewPageShell } from '@/components/review/bits';
import { SettingsCard, SettingsRow } from '@/components/settings-ui';
import { BotStatusFilter, RepoScopeSelect, type BotStatusFilterValue } from '@/components/bot/bot-ui';
import { timeAgo } from '@/lib/mock-review-data';
import { useWorkspace } from '@/contexts/workspace-context';
import { useBotRules, useCreateRule, useDeleteRule, useUpdateRule, type ApiRule } from '@/hooks/use-bot-memory';

function RuleMeta({ rule }: { rule: ApiRule }) {
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-2">
      {rule.glob && (
        <span className="rounded-[6px] bg-surface-hover px-1.5 py-0.5 font-mono text-[11.5px] text-fg-soft">
          {rule.glob}
        </span>
      )}
      <span className="text-[11.5px] text-fg-muted">{rule.scope}</span>
      <span className="text-[11.5px] text-fg-faint">· added {timeAgo(rule.createdAt)}</span>
    </span>
  );
}

export default function BotRulesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [status, setStatus] = useState<BotStatusFilterValue>('all');
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

  const filtered = useMemo(
    () =>
      rules.filter((rule) => {
        if (status === 'active' && !rule.enabled) return false;
        if (status === 'paused' && rule.enabled) return false;
        return true;
      }),
    [rules, status],
  );

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
        <>
          <Button
            design="pill"
            icon={Plus}
            className="hover:!bg-primary active:!bg-primary"
            onClick={() => (showForm ? resetForm() : setShowForm(true))}
          >
            Add Rule
          </Button>
          <BotStatusFilter value={status} onChange={setStatus} />
        </>
      }
    >
      {showForm && (
        <SettingsCard className="mb-4 overflow-visible">
          <div className="space-y-3 py-[12px]">
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
                className="font-mono text-[13px] md:text-[13px]"
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
        </SettingsCard>
      )}

      {error && <p className="mb-4 text-[13px] text-destructive">{(error as Error).message}</p>}

      {isLoading ? (
        <ListSkeleton rows={4} className="[&>*]:px-0" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={rules.length === 0 ? 'No rules yet' : 'No matching rules'}
          description={
            rules.length === 0
              ? 'Add a rule to steer what the bot looks for in every review.'
              : 'Try a different status filter.'
          }
          actions={
            rules.length === 0 ? (
              <Button design="pill" icon={Plus} onClick={() => setShowForm(true)}>
                Add Rule
              </Button>
            ) : undefined
          }
        />
      ) : (
        <SettingsCard className="overflow-visible">
          {filtered.map((rule) => {
            if (editingId === rule.id) {
              return (
                <div key={rule.id} className="space-y-3 py-[12px]">
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
                      className="font-mono text-[13px] md:text-[13px]"
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
              );
            }
            return (
              <SettingsRow
                key={rule.id}
                label={
                  <span className="min-w-0">
                    <span className="block leading-snug">{rule.instruction}</span>
                    <RuleMeta rule={rule} />
                  </span>
                }
              >
                <span className="flex items-center gap-1.5">
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
                </span>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      )}
    </ReviewPageShell>
  );
}
