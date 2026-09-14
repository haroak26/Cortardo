import { useState } from 'react';
import { ListChecks, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/button';
import { Badge } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import { ReviewPageShell } from '@/components/review/bits';
import { timeAgo } from '@/lib/mock-review-data';
import { useWorkspace } from '@/contexts/workspace-context';
import { useBotRules, useCreateRule, useDeleteRule, useUpdateRule } from '@/hooks/use-bot-memory';

export default function BotRulesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [glob, setGlob] = useState('');

  const { data: rules = [], isLoading, error } = useBotRules(activeWorkspaceId);
  const createRule = useCreateRule(activeWorkspaceId);
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();

  const filtered = rules.filter(
    (rule) =>
      rule.instruction.toLowerCase().includes(search.toLowerCase()) ||
      (rule.glob ?? '').toLowerCase().includes(search.toLowerCase()) ||
      rule.scope.toLowerCase().includes(search.toLowerCase()),
  );

  const submit = () => {
    if (instruction.trim().length < 3) return;
    createRule.mutate(
      { instruction: instruction.trim(), glob: glob.trim() || null },
      {
        onSuccess: () => {
          setInstruction('');
          setGlob('');
          setShowForm(false);
        },
      },
    );
  };

  return (
    <ReviewPageShell
      title="Rules"
      description="Instructions the bot applies to every review it runs."
      actions={
        <Button size="sm" onClick={() => setShowForm((value) => !value)}>
          <Plus size={15} />
          New rule
        </Button>
      }
    >
      {showForm && (
        <FramedCard>
          <div className="p-4 space-y-3">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. All queries must use bound parameters. Flag string interpolation in SQL."
              aria-label="Rule instruction"
              className="w-full h-[36px] px-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
            />
            <div className="flex items-center gap-3">
              <input
                value={glob}
                onChange={(e) => setGlob(e.target.value)}
                placeholder="Glob (optional), e.g. src/**/*.ts"
                aria-label="Rule glob"
                className="flex-1 h-[34px] px-3 rounded-[10px] text-[13px] font-mono text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
              />
              <Button size="sm" onClick={submit} disabled={createRule.isPending || instruction.trim().length < 3}>
                {createRule.isPending ? 'Adding…' : 'Add rule'}
              </Button>
            </div>
            {createRule.error && (
              <p className="text-[12px] text-destructive">{(createRule.error as Error).message}</p>
            )}
          </div>
        </FramedCard>
      )}

      <div className="relative mb-6 mt-6">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rules..."
          aria-label="Search rules"
          className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
        />
      </div>

      {error && <p className="text-[13px] text-destructive mb-4">{(error as Error).message}</p>}

      {isLoading ? (
        <p className="text-[13px] text-fg-muted">Loading rules…</p>
      ) : filtered.length === 0 ? (
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
                  <button
                    type="button"
                    onClick={() => updateRule.mutate({ id: rule.id, enabled: !rule.enabled })}
                    className="border-none bg-transparent cursor-pointer"
                    aria-label={rule.enabled ? 'Pause rule' : 'Enable rule'}
                  >
                    <Badge tone={rule.enabled ? 'success' : 'neutral'}>{rule.enabled ? 'Active' : 'Paused'}</Badge>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRule.mutate(rule.id)}
                    className="text-fg-faint hover:text-destructive transition-colors border-none bg-transparent cursor-pointer pt-0.5"
                    aria-label="Delete rule"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </FramedCard>
      )}
    </ReviewPageShell>
  );
}
