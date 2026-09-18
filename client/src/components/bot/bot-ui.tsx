import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { TextInput } from '@/components/text-input';
import { Button } from '@/components/button';
import {
  OpenDropdown,
  OpenDropdownBackdrop,
  OpenDropdownItem,
  OpenDropdownMenu,
} from '@/components/open-dropdown';
import { useRepositories } from '@/hooks/use-github';
import { useWorkspace } from '@/contexts/workspace-context';
import { BOT_AUTONOMY_LEVELS, type BotAutonomyLevel } from '@shared/bot';
import { cn } from '@/lib/utils';

/** Search input styled for the bot list pages. */
export function BotSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9"
      />
    </div>
  );
}

/** Repository scope picker: "All repositories" or a single connected repo. */
export function RepoScopeSelect({
  value,
  onChange,
  includeAll,
  className,
}: {
  /** Repository id, or '' for all repositories. */
  value: string;
  onChange: (repositoryId: string) => void;
  /** Show the "All repositories" option (false when a scope is required). */
  includeAll?: boolean;
  className?: string;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const { data: repositories = [] } = useRepositories(activeWorkspaceId);
  const [open, setOpen] = useState(false);
  const selected = repositories.find((repository) => repository.id === value);
  const options = [
    ...(includeAll !== false ? [{ value: '', label: 'All repositories' }] : []),
    ...repositories.map((repository) => ({ value: repository.id, label: repository.fullName })),
  ];
  return (
    <div className={cn('relative w-full shrink-0 sm:w-[220px]', className)}>
      <OpenDropdown
        open={open}
        onClick={() => setOpen((current) => !current)}
        value={selected?.fullName}
        placeholder="All repositories"
        aria-label="Repository scope"
      />
      {open && (
        <>
          <OpenDropdownBackdrop onClick={() => setOpen(false)} />
          <OpenDropdownMenu align="right" className="max-h-[260px] min-w-[200px] overflow-y-auto">
            {options.map((option) => (
              <OpenDropdownItem
                key={option.value || 'all'}
                selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </OpenDropdownItem>
            ))}
          </OpenDropdownMenu>
        </>
      )}
    </div>
  );
}

/** Small labelled stat used at the top of the bot list pages. */
export function BotStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'success' | 'muted' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-faint">{label}</span>
      <span
        className={cn(
          'text-[18px] font-semibold leading-none tabular-nums',
          tone === 'success' ? 'text-success' : tone === 'muted' ? 'text-fg-muted' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export type BotStatusFilterValue = 'all' | 'active' | 'paused';

const STATUS_FILTER_OPTIONS: { value: BotStatusFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
];

/** Pill filter dropdown for the bot list pages, matching the Manage Team page. */
export function BotStatusFilter({
  value,
  onChange,
}: {
  value: BotStatusFilterValue;
  onChange: (value: BotStatusFilterValue) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <Button
        design="pill-secondary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="Filter by status"
      >
        Filter
        {value !== 'all' && (
          <span aria-hidden="true" className="h-[5px] w-[5px] shrink-0 rounded-full bg-brand" />
        )}
      </Button>
      {open && (
        <>
          <OpenDropdownBackdrop onClick={() => setOpen(false)} />
          <OpenDropdownMenu align="right" className="min-w-[150px]">
            {STATUS_FILTER_OPTIONS.map((option) => (
              <OpenDropdownItem
                key={option.value}
                selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </OpenDropdownItem>
            ))}
          </OpenDropdownMenu>
        </>
      )}
    </div>
  );
}

export const BOT_AUTONOMY_LABELS: Record<BotAutonomyLevel, string> = {
  manual: 'Manual',
  assisted: 'Assisted',
  autonomous: 'Autonomous',
};

const AUTONOMY_ANCHORS: Record<BotAutonomyLevel, number> = {
  manual: 0,
  assisted: 1,
  autonomous: 2,
};

const WAVE_BAR_COUNT = 35;
const WAVE_MAX_ANCHOR = WAVE_BAR_COUNT - 1;

/** Wave-style autonomy picker: the selected level is the tallest bar, the
    neighbouring bars taper off, and dragging sweeps the wave across the track.
    The wave stays where it is dropped, even between levels, while the value
    snaps to the closest level. */
export function AutonomyWave({
  value,
  onChange,
}: {
  value: BotAutonomyLevel;
  onChange: (value: BotAutonomyLevel) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pendingXRef = useRef<number | null>(null);
  const peakRef = useRef<number | null>(null);
  const lastCommittedRef = useRef<BotAutonomyLevel | null>(null);
  const [peak, setPeak] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const selectedIndex = BOT_AUTONOMY_LEVELS.indexOf(value);
  const anchorIndex = Math.round(
    (AUTONOMY_ANCHORS[value] / (BOT_AUTONOMY_LEVELS.length - 1)) * WAVE_MAX_ANCHOR,
  );
  const displayPeak = peak ?? anchorIndex;

  useEffect(() => {
    if (lastCommittedRef.current === value) return;
    peakRef.current = null;
    setPeak(null);
  }, [value]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const peakFromClientX = (clientX: number) => {
    const rect = rectRef.current ?? trackRef.current?.getBoundingClientRect() ?? null;
    if (!rect || rect.width === 0) return 0;
    const position = ((clientX - rect.left) / rect.width) * WAVE_MAX_ANCHOR;
    return Math.max(0, Math.min(WAVE_MAX_ANCHOR, position));
  };

  const applyPeak = (position: number) => {
    peakRef.current = position;
    setPeak((previous) => (previous === position ? previous : position));
  };

  /* Coalesce pointer moves into one update per frame so the wave tracks the
     pointer instead of queueing a render per event. */
  const queuePeak = (clientX: number) => {
    pendingXRef.current = clientX;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const x = pendingXRef.current;
      pendingXRef.current = null;
      if (x === null || !draggingRef.current) return;
      applyPeak(peakFromClientX(x));
    });
  };

  const levelFromPeak = (position: number) => {
    const anchor = Math.round((position / WAVE_MAX_ANCHOR) * (BOT_AUTONOMY_LEVELS.length - 1));
    const clamped = Math.max(0, Math.min(BOT_AUTONOMY_LEVELS.length - 1, anchor));
    return BOT_AUTONOMY_LEVELS[clamped];
  };

  const commit = (position: number) => {
    const level = levelFromPeak(position);
    if (!level) return;
    lastCommittedRef.current = level;
    if (level !== value) onChange(level);
  };

  const nudge = (direction: 1 | -1) => {
    const next = Math.max(0, Math.min(BOT_AUTONOMY_LEVELS.length - 1, selectedIndex + direction));
    const level = BOT_AUTONOMY_LEVELS[next];
    if (!level) return;
    lastCommittedRef.current = level;
    peakRef.current = null;
    setPeak(null);
    if (level !== value) onChange(level);
  };

  const displayLevel = levelFromPeak(displayPeak);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Bot autonomy"
        aria-valuemin={1}
        aria-valuemax={BOT_AUTONOMY_LEVELS.length}
        aria-valuenow={selectedIndex + 1}
        aria-valuetext={BOT_AUTONOMY_LABELS[value]}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            nudge(-1);
          }
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            nudge(1);
          }
        }}
        onPointerDown={(event) => {
          draggingRef.current = true;
          setDragging(true);
          rectRef.current = event.currentTarget.getBoundingClientRect();
          event.currentTarget.setPointerCapture(event.pointerId);
          applyPeak(peakFromClientX(event.clientX));
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          queuePeak(event.clientX);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          setDragging(false);
          if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
          }
          pendingXRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          const position = peakRef.current ?? peakFromClientX(event.clientX);
          applyPeak(position);
          commit(position);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragging(false);
          rectRef.current = null;
          peakRef.current = null;
          setPeak(null);
        }}
        className="inline-flex h-8 shrink-0 cursor-pointer touch-none select-none items-end gap-[2px] rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:gap-[3px]"
      >
        {Array.from({ length: WAVE_BAR_COUNT }, (_, index) => {
          const distance = Math.abs(index - displayPeak);
          const height = Math.max(10, Math.round(100 * Math.exp(-(distance * distance) / 10)));
          return (
            <span
              key={index}
              aria-hidden="true"
              className={cn(
                'w-[3px] rounded-full sm:w-[4px]',
                dragging
                  ? 'transition-none'
                  : 'transition-[height,background-color] duration-150 ease-out',
                distance < 0.5 ? 'bg-brand' : 'bg-surface-hover-strong',
              )}
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
      <div className="flex w-full items-baseline justify-between">
        {BOT_AUTONOMY_LEVELS.map((level) => (
          <span
            key={level}
            className={cn(
              'text-[10px] font-medium leading-none transition-colors duration-150',
              level === displayLevel ? 'text-foreground' : 'text-fg-faint',
            )}
          >
            {BOT_AUTONOMY_LABELS[level]}
          </span>
        ))}
      </div>
    </div>
  );
}

const METER_HEIGHTS = ['h-3', 'h-6', 'h-9'];

/** Compact read-only level meter used on the autonomy metric cards. */
export function AutonomyMeter({ value }: { value: BotAutonomyLevel }) {
  const selectedIndex = BOT_AUTONOMY_LEVELS.indexOf(value);
  return (
    <span
      role="img"
      aria-label={`Autonomy: ${BOT_AUTONOMY_LABELS[value]}`}
      className="flex h-9 items-end gap-1.5"
    >
      {BOT_AUTONOMY_LEVELS.map((level, index) => (
        <span
          key={level}
          aria-hidden="true"
          className={cn(
            'w-2.5 rounded-full transition-colors duration-200',
            METER_HEIGHTS[index],
            index <= selectedIndex ? 'bg-brand' : 'bg-surface-hover-strong',
          )}
        />
      ))}
    </span>
  );
}
