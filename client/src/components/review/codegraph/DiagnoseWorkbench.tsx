import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { buildGraphLayout } from '@/lib/codegraph-layout';
import { buildMockCodeGraph, getDiagnosisScenario } from '@/lib/mock-codegraph-data';
import { useDiagnosisPlayback } from '@/hooks/use-diagnosis-playback';
import { MarkedVDivider } from '@/components/review/bits';
import { CodebaseMap } from './CodebaseMap';
import { DiagnosisRail } from './DiagnosisRail';

export interface DiagnoseWorkbenchProps {
  repository: string;
  className?: string;
}

/** Landscape diagnosis surface: codebase map on the left, findings on the right. */
export function DiagnoseWorkbench({ repository, className }: DiagnoseWorkbenchProps) {
  const graph = useMemo(() => buildMockCodeGraph(repository), [repository]);
  const scenario = useMemo(() => getDiagnosisScenario(repository), [repository]);
  const layout = useMemo(() => buildGraphLayout(graph.files, graph.connections), [graph]);
  const playback = useDiagnosisPlayback(scenario);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    autoSelectedRef.current = false;
    setSelectedId(null);
  }, [repository]);

  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (playback.phase === 'scanning' || playback.phase === 'idle') return;
    autoSelectedRef.current = true;
    setSelectedId((current) => current ?? scenario.rootFileId);
  }, [playback.phase, scenario.rootFileId]);

  return (
    <div className={cn('flex min-h-0 flex-col bg-background', className)}>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[300px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
          <CodebaseMap
            layout={layout}
            statuses={playback.statuses}
            rootId={scenario.rootFileId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <MarkedVDivider className="z-20 hidden lg:block" />
        <aside className="w-full shrink-0 border-t border-border-subtle bg-background lg:w-[300px] lg:overflow-y-auto lg:border-t-0">
          <DiagnosisRail
            scenario={scenario}
            layout={layout}
            statuses={playback.statuses}
            phase={playback.phase}
            counts={playback.counts}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
      </div>
    </div>
  );
}
