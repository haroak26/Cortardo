import { cn } from '@/lib/utils';
import type { DiagnosisScenario, GraphFileStatus } from '@/lib/mock-codegraph-data';
import type { GraphLayout } from '@/lib/codegraph-layout';
import type { DiagnosisPhase } from '@/hooks/use-diagnosis-playback';
import { GRAPH_STATUS_META } from './CodebaseMap';

const PHASE_ORDER: DiagnosisPhase[] = ['scanning', 'tracing', 'fixing', 'done'];

interface PhaseStep {
  id: DiagnosisPhase;
  label: string;
  description: string;
  color: string;
  count: number;
  unit: string;
}

function statusDot(status: GraphFileStatus) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: GRAPH_STATUS_META[status].color }}
      aria-hidden="true"
    />
  );
}

export interface DiagnosisRailProps {
  scenario: DiagnosisScenario;
  layout: GraphLayout;
  statuses: Record<string, GraphFileStatus>;
  phase: DiagnosisPhase;
  counts: { searched: number; affected: number; editing: number; fixed: number };
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}

export function DiagnosisRail({
  scenario,
  layout,
  statuses,
  phase,
  counts,
  selectedId,
  onSelect,
  className,
}: DiagnosisRailProps) {
  const selected = selectedId ? layout.byId.get(selectedId) : undefined;
  const selectedNote =
    scenario.affected.find((entry) => entry.fileId === selectedId) ??
    scenario.fixed.find((entry) => entry.fileId === selectedId);

  const steps: PhaseStep[] = [
    {
      id: 'scanning',
      label: 'Scanning dependencies',
      description: 'Walking imports across the repository',
      color: 'hsl(var(--blue))',
      count: counts.searched,
      unit: 'files searched',
    },
    {
      id: 'tracing',
      label: 'Tracing impact',
      description: 'Following call paths from the root cause',
      color: 'hsl(var(--danger))',
      count: counts.affected,
      unit: 'files impacted',
    },
    {
      id: 'fixing',
      label: 'Generating fixes',
      description: 'Writing patches for the impacted files',
      color: 'hsl(var(--success))',
      count: counts.fixed,
      unit: 'fixes ready',
    },
  ];
  const activeIndex = PHASE_ORDER.indexOf(phase);

  const neighbours = selectedId
    ? [...(layout.neighbours.get(selectedId) ?? [])].sort()
    : [];

  return (
    <div className={cn('flex flex-col', className)}>
      {selected && (
        <div className="border-b border-border-subtle p-4">
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold text-foreground">{selected.name}</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-fg-muted">{selected.path}</p>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              {statusDot(statuses[selected.id] ?? 'idle')}
              {GRAPH_STATUS_META[statuses[selected.id] ?? 'idle'].label}
            </span>
            <span>{selected.language}</span>
            <span className="tabular-nums">{selected.loc} LOC</span>
            <span>{neighbours.length} connections</span>
          </div>

          {selectedNote && 'note' in selectedNote && (
            <p className="mt-3 text-[12.5px] leading-relaxed text-fg-soft">{selectedNote.note}</p>
          )}

          {selectedNote && 'patch' in selectedNote && (
            <div className="mt-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-success">
                Generated fix
              </p>
              <pre className="mt-1.5 overflow-x-auto rounded-[8px] border border-success/25 bg-success/5 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                <code>{selectedNote.patch}</code>
              </pre>
            </div>
          )}

          {neighbours.length > 0 && (
            <div className="mt-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-faint">
                Connected files
              </p>
              <div className="mt-1.5 flex flex-col">
                {neighbours.map((id) => {
                  const node = layout.byId.get(id);
                  if (!node) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelect(id)}
                      className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left transition-colors hover:bg-surface-hover/70"
                    >
                      {statusDot(statuses[id] ?? 'idle')}
                      <span className="truncate font-mono text-[11px] text-fg-muted">
                        {node.path}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!selected && (
        <div className="border-b border-border-subtle p-4">
          <h2 className="text-[14px] font-semibold leading-snug text-foreground">
            {scenario.title}
          </h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">{scenario.summary}</p>
        </div>
      )}

      {/* Playback phases */}
      <div className="border-b border-border-subtle p-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-faint">
          Diagnosis
        </p>
        <ol className="mt-3 space-y-3">
          {steps.map((step, index) => {
            const stepIndex = PHASE_ORDER.indexOf(step.id);
            const done = activeIndex > stepIndex || phase === 'done';
            const active = !done && activeIndex === stepIndex;
            return (
              <li key={step.id} className="flex items-start gap-3">
                <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold tabular-nums transition-colors',
                      active && 'live-blink',
                    )}
                    style={{
                      borderColor: done || active ? step.color : 'hsl(var(--border-strong))',
                      background: done ? step.color : 'transparent',
                      color: done ? '#fff' : active ? step.color : 'hsl(var(--fg-faint))',
                    }}
                  >
                    {index + 1}
                  </span>
                  {index < steps.length - 1 && (
                    <span
                      className="absolute left-1/2 top-full h-[13px] w-px -translate-x-1/2"
                      style={{ background: done ? step.color : 'hsl(var(--border))' }}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={cn(
                        'text-[12.5px] font-medium',
                        active || done ? 'text-foreground' : 'text-fg-muted',
                      )}
                    >
                      {step.label}
                    </p>
                    <span
                      className="shrink-0 text-[11px] tabular-nums"
                      style={{ color: active || done ? step.color : 'hsl(var(--fg-faint))' }}
                    >
                      {step.count}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-fg-muted">{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Impacted files */}
      <div className="border-b border-border-subtle p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-faint">
            Impacted files
          </p>
          <span className="text-[11px] tabular-nums text-danger">{counts.affected}</span>
        </div>
        <ul className="mt-2">
          {scenario.affected.map((entry) => {
            const node = layout.byId.get(entry.fileId);
            const status = statuses[entry.fileId] ?? 'idle';
            return (
              <li key={entry.fileId}>
                <button
                  type="button"
                  onClick={() => onSelect(entry.fileId)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-[6px] px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover/70',
                    selectedId === entry.fileId && 'bg-surface-hover',
                  )}
                >
                  <span className="mt-[5px]">{statusDot(status)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[11.5px] text-foreground">
                        {node?.path ?? entry.fileId}
                      </span>
                      {entry.root && (
                        <span className="shrink-0 rounded-[4px] bg-danger/15 px-1 py-px text-[9px] font-bold uppercase text-danger">
                          root
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-fg-muted">
                      {entry.note}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Fixes */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-faint">
            Fixes generated
          </p>
          <span className="text-[11px] tabular-nums text-success">{counts.fixed}</span>
        </div>
        <ul className="mt-2">
          {scenario.fixed.map((entry) => {
            const node = layout.byId.get(entry.fileId);
            const status = statuses[entry.fileId] ?? 'idle';
            return (
              <li key={entry.fileId}>
                <button
                  type="button"
                  onClick={() => onSelect(entry.fileId)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-[6px] px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover/70',
                    selectedId === entry.fileId && 'bg-surface-hover',
                  )}
                >
                  <span className="mt-[5px]">{statusDot(status)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11.5px] text-foreground">
                      {node?.path ?? entry.fileId}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-fg-muted">
                      {entry.note}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
