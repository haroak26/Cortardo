import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagnosisScenario, GraphFileStatus } from '@/lib/mock-codegraph-data';

export type DiagnosisPhase = 'idle' | 'scanning' | 'tracing' | 'fixing' | 'done';

interface PlaybackEvent {
  t: number;
  fileId: string;
  status: GraphFileStatus;
}

interface PlaybackScript {
  events: PlaybackEvent[];
  duration: number;
  scanStart: number;
  impactStart: number;
  fixStart: number;
  phaseAt: (elapsed: number) => DiagnosisPhase;
}

interface PlaybackState {
  statuses: Record<string, GraphFileStatus>;
  phase: DiagnosisPhase;
  progress: number;
}

export interface DiagnosisPlayback extends PlaybackState {
  counts: { searched: number; affected: number; editing: number; fixed: number };
  duration: number;
  isPlaying: boolean;
  replay: () => void;
  finish: () => void;
}

function buildScript(scenario: DiagnosisScenario): PlaybackScript {
  const events: PlaybackEvent[] = [];
  const scanStart = 450;
  const scanCount = Math.max(scenario.searchOrder.length, 1);
  scenario.searchOrder.forEach((fileId, index) => {
    events.push({ t: scanStart + (index / scanCount) * scenario.phaseMs.scan, fileId, status: 'searching' });
  });

  const impactStart = scanStart + scenario.phaseMs.scan + 320;
  const affectedCount = Math.max(scenario.affected.length, 1);
  scenario.affected.forEach((entry, index) => {
    events.push({
      t: impactStart + (index / affectedCount) * scenario.phaseMs.impact,
      fileId: entry.fileId,
      status: 'affected',
    });
  });

  const fixStart = impactStart + scenario.phaseMs.impact + 280;
  const fixedCount = Math.max(scenario.fixed.length, 1);
  const fixSlot = scenario.phaseMs.fix / fixedCount;
  const editDuration = Math.max(320, Math.min(900, fixSlot * 1.6));
  scenario.fixed.forEach((entry, index) => {
    const start = fixStart + index * fixSlot;
    events.push({ t: start, fileId: entry.fileId, status: 'editing' });
    events.push({ t: start + editDuration, fileId: entry.fileId, status: 'fixed' });
  });

  events.sort((a, b) => a.t - b.t);
  const doneAt = events.reduce((max, event) => Math.max(max, event.t), 0) + 240;

  const phaseAt = (elapsed: number): DiagnosisPhase => {
    if (elapsed >= doneAt) return 'done';
    if (elapsed >= fixStart) return 'fixing';
    if (elapsed >= impactStart) return 'tracing';
    return 'scanning';
  };

  return { events, duration: doneAt, scanStart, impactStart, fixStart, phaseAt };
}

function applyAll(script: PlaybackScript): Record<string, GraphFileStatus> {
  const statuses: Record<string, GraphFileStatus> = {};
  for (const event of script.events) statuses[event.fileId] = event.status;
  return statuses;
}

/** Plays a diagnosis scenario on the mock graph: blue sweep → red impact → green fixes. */
export function useDiagnosisPlayback(scenario: DiagnosisScenario | null): DiagnosisPlayback {
  const script = useMemo(() => (scenario ? buildScript(scenario) : null), [scenario]);
  const [state, setState] = useState<PlaybackState>({ statuses: {}, phase: 'idle', progress: 0 });
  const [runId, setRunId] = useState(0);
  const rafRef = useRef<number>();
  const finishRequested = useRef(false);

  useEffect(() => {
    if (!script) return;
    if (finishRequested.current) {
      finishRequested.current = false;
      setState({ statuses: applyAll(script), phase: 'done', progress: 1 });
      return;
    }

    let cancelled = false;
    const statuses: Record<string, GraphFileStatus> = {};
    let cursor = 0;
    let lastProgress = -1;
    const startedAt = performance.now();

    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = now - startedAt;
      let applied = false;
      while (cursor < script.events.length && script.events[cursor].t <= elapsed) {
        const event = script.events[cursor++];
        statuses[event.fileId] = event.status;
        applied = true;
      }
      const progress = Math.min(1, elapsed / script.duration);
      if (applied || progress - lastProgress > 0.02 || elapsed >= script.duration) {
        lastProgress = progress;
        setState({ statuses: { ...statuses }, phase: script.phaseAt(elapsed), progress });
      }
      if (elapsed < script.duration) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [script, runId]);

  useEffect(() => {
    setState({ statuses: {}, phase: 'idle', progress: 0 });
  }, [scenario]);

  const replay = useCallback(() => {
    finishRequested.current = false;
    setRunId((id) => id + 1);
  }, []);

  const finish = useCallback(() => {
    finishRequested.current = true;
    setRunId((id) => id + 1);
  }, []);

  const counts = useMemo(() => {
    let searched = 0;
    let affected = 0;
    let editing = 0;
    let fixed = 0;
    for (const status of Object.values(state.statuses)) {
      if (status === 'searching') searched += 1;
      else if (status === 'affected') affected += 1;
      else if (status === 'editing') editing += 1;
      else if (status === 'fixed') fixed += 1;
    }
    return { searched, affected, editing, fixed };
  }, [state.statuses]);

  return {
    ...state,
    counts,
    duration: script?.duration ?? 0,
    isPlaying: state.phase !== 'idle' && state.phase !== 'done',
    replay,
    finish,
  };
}
