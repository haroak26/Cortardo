import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from '@/lib/utils';
import { Compass01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { CodeGraphFile, GraphFileStatus } from '@/lib/mock-codegraph-data';
import type { GraphLayout } from '@/lib/codegraph-layout';

export const GRAPH_STATUS_META: Record<GraphFileStatus, { label: string; color: string }> = {
  idle: { label: 'Indexed', color: 'hsl(var(--surface-deep))' },
  searching: { label: 'Searching', color: 'hsl(211 90% 55%)' },
  affected: { label: 'Impacted', color: 'hsl(var(--danger))' },
  editing: { label: 'Editing', color: 'hsl(45 95% 52%)' },
  fixed: { label: 'Fix ready', color: 'hsl(var(--success))' },
};

export interface CodebaseMapProps {
  layout: GraphLayout;
  statuses: Record<string, GraphFileStatus>;
  rootId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}

interface DotState {
  id: string;
  /** Circle centre, relative to the card. */
  left: number;
  anchorTop: number;
  anchorBottom: number;
  placement: 'top' | 'bottom';
}

interface Dot {
  file: CodeGraphFile;
  x: number;
  y: number;
  left: number;
  top: number;
}

interface Connector {
  key: string;
  source: string;
  target: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PanState {
  id: number;
  x: number;
  y: number;
  panX: number;
  panY: number;
  moved: boolean;
}

const TIP_MARGIN = 6;
const DOT_SIZE = 8;
const MIN_STEP = 11;
const MAX_STEP = 26;
/** Extra real import edges are only drawn between nearby dots. */
const MAX_EXTRA_DISTANCE = 1.5;

function ringCapacity(ring: number): number {
  return ring === 0 ? 1 : 6 * ring;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** File dots packed into a concentric circular grid — one dot per file,
    chained in graph-walk order with additional real import edges, and
    pannable since large repositories need more room. Folders are shown on
    hover/selection. */
export function CodebaseMap({
  layout,
  statuses,
  rootId,
  selectedId,
  onSelect,
  className,
}: CodebaseMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanState | null>(null);
  const centreTimerRef = useRef<number | null>(null);
  const [tip, setTip] = useState<DotState | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [centring, setCentring] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setTip(null);
  }, [layout]);

  const { dots, lines, canvas, radius } = useMemo(() => {
    const files = layout.nodes;
    if (size.width === 0 || size.height === 0 || files.length === 0) {
      return { dots: [] as Dot[], lines: [] as Connector[], canvas: 0, radius: 0 };
    }

    const slots: { file: CodeGraphFile; ring: number; angle: number }[] = [];
    let ring = 0;
    let index = 0;
    let baseAngle = 0;
    while (index < files.length) {
      const capacity = ringCapacity(ring);
      for (let slot = 0; slot < capacity && index < files.length; slot += 1, index += 1) {
        const angle = ring === 0 ? 0 : baseAngle + (slot / capacity) * Math.PI * 2;
        slots.push({ file: files[index], ring, angle });
      }
      if (slots.length > 0) baseAngle = slots[slots.length - 1].angle;
      ring += 1;
    }

    const maxRing = ring - 1;
    const maxRadius = Math.max(
      Math.min(size.width, size.height) / 2 - DOT_SIZE / 2 - 18,
      MIN_STEP,
    );
    const step =
      maxRing === 0
        ? 0
        : Math.min(MAX_STEP, Math.max(MIN_STEP, maxRadius / maxRing));
    const canvas = Math.max(
      size.width,
      size.height,
      maxRing * step + DOT_SIZE + 48,
    );
    const centre = canvas / 2;

    const dots = slots.map(({ file, ring: r, angle }) => {
      const radius = r * step;
      const x = centre + Math.cos(angle) * radius;
      const y = centre + Math.sin(angle) * radius;
      return { file, x, y, left: x - DOT_SIZE / 2, top: y - DOT_SIZE / 2 };
    });

    const byDot = new Map(dots.map((dot) => [dot.file.id, dot]));
    const seen = new Set<string>();
    const lines: Connector[] = [];
    for (let i = 0; i < dots.length - 1; i += 1) {
      const from = dots[i];
      const to = dots[i + 1];
      seen.add(pairKey(from.file.id, to.file.id));
      lines.push({
        key: pairKey(from.file.id, to.file.id),
        source: from.file.id,
        target: to.file.id,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      });
    }

    const maxDistance = step * MAX_EXTRA_DISTANCE;
    for (const edge of layout.edges) {
      const from = byDot.get(edge.source);
      const to = byDot.get(edge.target);
      if (!from || !to) continue;
      const key = pairKey(edge.source, edge.target);
      if (seen.has(key)) continue;
      if (Math.hypot(from.x - to.x, from.y - to.y) > maxDistance) continue;
      seen.add(key);
      lines.push({
        key,
        source: edge.source,
        target: edge.target,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      });
    }

    return { dots, lines, canvas, radius: maxRing * step };
  }, [layout, size]);

  const tipFile = tip ? layout.byId.get(tip.id) : undefined;

  const showTip = (file: CodeGraphFile, element: HTMLElement) => {
    if (panRef.current) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const anchorTop = rect.top - wrapRect.top;
    const anchorBottom = rect.bottom - wrapRect.top;
    setTip({
      id: file.id,
      left: rect.left + rect.width / 2 - wrapRect.left,
      anchorTop,
      anchorBottom,
      placement: anchorTop < 34 ? 'bottom' : 'top',
    });
  };

  const centerMap = () => {
    setTip(null);
    setCentring(true);
    setPan({ x: 0, y: 0 });
    if (centreTimerRef.current !== null) window.clearTimeout(centreTimerRef.current);
    centreTimerRef.current = window.setTimeout(() => {
      centreTimerRef.current = null;
      setCentring(false);
    }, 360);
  };

  useEffect(
    () => () => {
      if (centreTimerRef.current !== null) window.clearTimeout(centreTimerRef.current);
    },
    [],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (centreTimerRef.current !== null) {
      window.clearTimeout(centreTimerRef.current);
      centreTimerRef.current = null;
    }
    setCentring(false);
    panRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
    setTip(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    const limitX = Math.max(radius, size.width / 2);
    const limitY = Math.max(radius, size.height / 2);
    setPan({
      x: clamp(drag.panX + dx, -limitX, limitX),
      y: clamp(drag.panY + dy, -limitY, limitY),
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    panRef.current = null;
    if (!drag.moved) onSelect(null);
  };

  const handlePointerCancel = () => {
    panRef.current = null;
  };

  useLayoutEffect(() => {
    if (!tip) return;
    const wrap = wrapRef.current;
    const element = tipRef.current;
    if (!wrap || !element) return;
    const minLeft = element.offsetWidth / 2 + TIP_MARGIN;
    const maxLeft = Math.max(wrap.clientWidth - minLeft, minLeft);
    const left = Math.min(Math.max(tip.left, minLeft), maxLeft);
    let placement = tip.placement;
    if (placement === 'top' && tip.anchorTop - element.offsetHeight - TIP_MARGIN < 0) {
      placement = 'bottom';
    } else if (
      placement === 'bottom' &&
      tip.anchorBottom + element.offsetHeight + TIP_MARGIN > wrap.clientHeight
    ) {
      placement = 'top';
    }
    if (left !== tip.left || placement !== tip.placement) {
      setTip({ ...tip, left, placement });
    }
  }, [tip]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        'relative h-full min-h-0 w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        className="absolute"
        style={{
          left: (size.width - canvas) / 2,
          top: (size.height - canvas) / 2,
          width: canvas,
          height: canvas,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
          transition: centring ? 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)' : 'none',
        }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {lines.map((line) => {
            const activeId = tip?.id ?? selectedId;
            const emphasized = line.source === activeId || line.target === activeId;
            return (
              <line
                key={line.key}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={GRAPH_STATUS_META[statuses[line.source] ?? 'idle'].color}
                strokeWidth={emphasized ? 2 : 1.25}
                strokeLinecap="round"
                opacity={1}
              />
            );
          })}
        </svg>
        {dots.map(({ file, left, top }) => {
          const status = statuses[file.id] ?? 'idle';
          const raised = (file.id === rootId && status !== 'idle') || file.id === selectedId;
          return (
            <button
              key={file.id}
              type="button"
              aria-label={file.path}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(file.id);
              }}
              onMouseEnter={(event) => showTip(file, event.currentTarget)}
              onMouseLeave={() => setTip(null)}
              onFocus={(event) => showTip(file, event.currentTarget)}
              onBlur={() => setTip(null)}
              className={cn(
                'absolute cursor-pointer rounded-full border-none p-0 outline-none',
                raised && 'z-10',
                status === 'editing' && 'map-block-editing',
              )}
              style={{
                left,
                top,
                width: DOT_SIZE,
                height: DOT_SIZE,
                background: GRAPH_STATUS_META[status].color,
              }}
            />
          );
        })}
      </div>

      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          centerMap();
        }}
        className="absolute bottom-2 right-2 z-20 flex h-7 w-7 items-center justify-center rounded-[8px] bg-background/80 text-fg-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        aria-label="Center codebase map"
        title="Center map"
      >
        <HugeiconsIcon icon={Compass01Icon} size={15} />
      </button>

      {tip && tipFile && (
        <div
          ref={tipRef}
          className={cn(
            'pointer-events-none absolute z-30 -translate-x-1/2',
            tip.placement === 'top' ? '-translate-y-full pb-1.5' : 'pt-1.5',
          )}
          style={{ left: tip.left, top: tip.placement === 'top' ? tip.anchorTop : tip.anchorBottom }}
        >
          <span className="block whitespace-nowrap rounded-[6px] bg-foreground px-2 py-1 font-mono text-[10.5px] font-medium text-background">
            {tipFile.path}
          </span>
        </div>
      )}
    </div>
  );
}
