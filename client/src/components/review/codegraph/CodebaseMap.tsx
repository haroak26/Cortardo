import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { NavigationTwoIcon } from '@hugeicons/core-free-icons';
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
  /** Keep the globe still instead of auto-rotating. */
  autoRotate?: boolean;
  /** Disable drag, zoom and hover — for static previews. */
  interactive?: boolean;
}

interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
}

interface ProjectedNode {
  file: CodeGraphFile;
  id: string;
  x: number;
  y: number;
  depth: number;
  screenRadius: number;
  status: GraphFileStatus;
}

interface EdgeLine {
  source: string;
  target: string;
  sourceIndex: number;
  targetIndex: number;
  synthetic: boolean;
  kind: string;
}

interface Palette {
  idle: string;
  searching: string;
  affected: string;
  editing: string;
  fixed: string;
  brand: string;
}

const DEFAULT_PALETTE: Palette = {
  idle: '204 42% 40%',
  searching: '211 90% 55%',
  affected: '0 72% 55%',
  editing: '45 95% 52%',
  fixed: '152 60% 45%',
  brand: '204 42% 40%',
};

const DEFAULT_CAMERA: Camera = { yaw: -0.55, pitch: 0.28, zoom: 1 };
const AUTO_ROTATE_PER_FRAME = 0.00075;
const DRAG_SENSITIVITY = 0.0042;
const PITCH_SENSITIVITY = 0.0034;
const INERTIA_DECAY = 0.93;
const DOT_CORE = 1.9;
const HOVER_RADIUS = 14;

function tokenColor(token: string | undefined, alpha: number, fallback: string): string {
  const value = (token || '').trim() || fallback;
  return `hsl(${value} / ${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Canvas globe of clustered files. Straight lines follow the real graph. */
export function CodebaseMap({
  layout,
  statuses,
  rootId,
  selectedId,
  onSelect,
  className,
  autoRotate = true,
  interactive = true,
}: CodebaseMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipElRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const velocityRef = useRef({ yaw: 0, pitch: 0 });
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const tipIdRef = useRef<string | null>(null);
  const centreAnimRef = useRef<{ from: Camera; start: number } | null>(null);
  const projectedRef = useRef<ProjectedNode[]>([]);
  const paletteRef = useRef<Palette>({ ...DEFAULT_PALETTE });

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tipId, setTipId] = useState<string | null>(null);
  const [paletteVersion, setPaletteVersion] = useState(0);
  const staticView = !interactive && !autoRotate;

  const geometry = useMemo(() => {
    const nodes = layout.nodes.map((file) => ({
      file,
      position: layout.positions.get(file.id) ?? { x: 0, y: 0, z: 0 },
      degree: layout.neighbours.get(file.id)?.size ?? 0,
    }));
    const indexOf = new Map(nodes.map((node, index) => [node.file.id, index]));

    const lines: EdgeLine[] = [];
    for (const edge of layout.edges) {
      const sourceIndex = indexOf.get(edge.source);
      const targetIndex = indexOf.get(edge.target);
      if (sourceIndex === undefined || targetIndex === undefined) continue;
      lines.push({
        source: edge.source,
        target: edge.target,
        sourceIndex,
        targetIndex,
        synthetic: Boolean(edge.synthetic),
        kind: edge.kind,
      });
    }

    return { nodes, lines };
  }, [layout]);

  const geometryRef = useRef(geometry);
  const propsRef = useRef({ statuses, rootId, selectedId, onSelect, layout });
  geometryRef.current = geometry;
  propsRef.current = { statuses, rootId, selectedId, onSelect, layout };

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const refresh = () => {
      const styles = getComputedStyle(document.documentElement);
      const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
      paletteRef.current = {
        idle: read('--brand', DEFAULT_PALETTE.idle),
        searching: read('--info', DEFAULT_PALETTE.searching),
        affected: read('--danger', DEFAULT_PALETTE.affected),
        editing: read('--warning', DEFAULT_PALETTE.editing),
        fixed: read('--success', DEFAULT_PALETTE.fixed),
        brand: read('--brand', DEFAULT_PALETTE.brand),
      };
      setPaletteVersion((version) => version + 1);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, []);

  const renderRef = useRef<(time: number) => void>(() => {});
  renderRef.current = (time: number) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || size.width === 0 || size.height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetWidth = Math.round(size.width * dpr);
    const targetHeight = Math.round(size.height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const { nodes, lines } = geometryRef.current;
    const { statuses: statusMap, rootId: root, selectedId: selected } = propsRef.current;
    const palette = paletteRef.current;
    const colors: Record<GraphFileStatus, string> = {
      idle: tokenColor(palette.idle, 0.85, DEFAULT_PALETTE.idle),
      searching: tokenColor(palette.searching, 0.95, DEFAULT_PALETTE.searching),
      affected: tokenColor(palette.affected, 0.95, DEFAULT_PALETTE.affected),
      editing: tokenColor(palette.editing, 0.95, DEFAULT_PALETTE.editing),
      fixed: tokenColor(palette.fixed, 0.95, DEFAULT_PALETTE.fixed),
    };

    const width = size.width;
    const height = size.height;
    const centreX = width / 2;
    const centreY = height / 2;
    const camera = cameraRef.current;

    if (centreAnimRef.current) {
      const { from, start } = centreAnimRef.current;
      const progress = clamp((time - start) / 560, 0, 1);
      const eased = easeOutCubic(progress);
      camera.yaw = from.yaw + (DEFAULT_CAMERA.yaw - from.yaw) * eased;
      camera.pitch = from.pitch + (DEFAULT_CAMERA.pitch - from.pitch) * eased;
      camera.zoom = from.zoom + (DEFAULT_CAMERA.zoom - from.zoom) * eased;
      if (progress >= 1) centreAnimRef.current = null;
    }

    const cosYaw = Math.cos(camera.yaw);
    const sinYaw = Math.sin(camera.yaw);
    const cosPitch = Math.cos(camera.pitch);
    const sinPitch = Math.sin(camera.pitch);
    const fit = Math.min(width, height) * 0.49;
    // Orthographic projection keeps the globe silhouette identical while it
    // rotates, so dragging never appears to change the shape.
    const focal = fit * camera.zoom;

    const project = (x: number, y: number, z: number): [number, number, number] => {
      const x1 = x * cosYaw - z * sinYaw;
      const z1 = x * sinYaw + z * cosYaw;
      const y2 = y * cosPitch - z1 * sinPitch;
      const z2 = y * sinPitch + z1 * cosPitch;
      return [centreX + x1 * focal, centreY + y2 * focal, z2];
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const projected: ProjectedNode[] = new Array(nodes.length);
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const [sx, sy, depth] = project(node.position.x, node.position.y, node.position.z);
      const status = statusMap[node.file.id] ?? 'idle';
      const pulse = status === 'searching' || status === 'editing' ? 1 + 0.16 * Math.sin(time / 240) : 1;
      const screenRadius = (DOT_CORE + Math.min(1.6, node.degree * 0.16)) * camera.zoom * pulse;
      projected[i] = {
        file: node.file,
        id: node.file.id,
        x: sx,
        y: sy,
        depth,
        screenRadius: Math.max(1.1, screenRadius),
        status,
      };
    }
    projectedRef.current = projected;

    const hoveredId = hoverRef.current;
    const highlightId = selected ?? hoveredId;

    const edgeEntries = lines.map((line, index) => {
      const a = projected[line.sourceIndex];
      const b = projected[line.targetIndex];
      return {
        index,
        depth: (a.depth + b.depth) / 2,
        highlighted:
          highlightId !== null && (line.source === highlightId || line.target === highlightId),
      };
    });
    edgeEntries.sort((a, b) => {
      if (a.highlighted !== b.highlighted) return a.highlighted ? 1 : -1;
      return a.depth - b.depth;
    });

    for (const entry of edgeEntries) {
      const line = lines[entry.index];
      const a = projected[line.sourceIndex];
      const b = projected[line.targetIndex];
      const depthAlpha = clamp(0.1 + 0.7 * ((entry.depth + 1.15) / 2.3), 0.08, 0.85);
      const screenLength = Math.hypot(a.x - b.x, a.y - b.y);
      const lengthFade = clamp(1 - screenLength / (fit * 1.9), 0.06, 1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = colors[a.status] ?? colors.idle;
      if (entry.highlighted) {
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([]);
      } else if (line.synthetic) {
        ctx.globalAlpha = depthAlpha * lengthFade * 0.3;
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 3]);
      } else {
        const kindFade = line.kind === 'calls' ? 0.8 : line.kind === 'types' ? 0.72 : 1;
        ctx.globalAlpha = depthAlpha * kindFade * lengthFade * 0.85;
        ctx.lineWidth = 0.9;
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const nodeEntries = projected
      .map((node, index) => ({ index, depth: node.depth }))
      .sort((a, b) => a.depth - b.depth);

    for (const { index } of nodeEntries) {
      const node = projected[index];
      const depthAlpha = clamp(0.22 + 0.78 * ((node.depth + 1.1) / 2.2), 0.2, 1);
      const color = colors[node.status] ?? colors.idle;
      const isHovered = node.id === hoveredId;
      const isSelected = node.id === selected;
      const isRoot = node.id === root && node.status !== 'idle';
      const emphasis = isSelected ? 1.7 : isHovered ? 1.45 : isRoot ? 1.25 : 1;
      const radius = node.screenRadius * emphasis;

      ctx.globalAlpha = depthAlpha;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const tipEl = tipElRef.current;
    const tipIdCurrent = tipIdRef.current;
    if (tipEl && tipIdCurrent) {
      const node = projected.find((candidate) => candidate.id === tipIdCurrent);
      if (node) {
        tipEl.style.transform = `translate(${node.x}px, ${Math.max(node.y - 12, 8)}px) translate(-50%, -100%)`;
      }
    }
  };

  useEffect(() => {
    if (staticView) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const delta = clamp(now - last, 0, 64) / 16;
      last = now;
      const velocity = velocityRef.current;
      if (!dragRef.current && !centreAnimRef.current) {
        if (Math.abs(velocity.yaw) > 0.00008 || Math.abs(velocity.pitch) > 0.00008) {
          cameraRef.current.yaw += velocity.yaw * delta;
          cameraRef.current.pitch = clamp(cameraRef.current.pitch + velocity.pitch * delta, -1.3, 1.3);
          velocity.yaw *= Math.pow(INERTIA_DECAY, delta);
          velocity.pitch *= Math.pow(INERTIA_DECAY, delta);
        } else {
          velocity.yaw = 0;
          velocity.pitch = 0;
          if (autoRotate) cameraRef.current.yaw += AUTO_ROTATE_PER_FRAME * delta;
        }
      }
      renderRef.current(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [staticView, autoRotate]);

  useEffect(() => {
    if (!staticView) return;
    const raf = requestAnimationFrame(() => renderRef.current(performance.now()));
    return () => cancelAnimationFrame(raf);
  }, [staticView, size, geometry, paletteVersion]);

  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraRef.current.zoom = clamp(cameraRef.current.zoom * (1 - event.deltaY * 0.0009), 0.6, 2.2);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [interactive]);

  const hitTest = (mx: number, my: number): ProjectedNode | null => {
    let nearest: ProjectedNode | null = null;
    let nearestDistance = HOVER_RADIUS;
    for (const node of projectedRef.current) {
      const distance = Math.hypot(node.x - mx, node.y - my);
      if (distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    }
    return nearest;
  };

  const applyHover = (node: ProjectedNode | null) => {
    const nextId = node?.id ?? null;
    if (nextId === hoverRef.current) return;
    hoverRef.current = nextId;
    tipIdRef.current = nextId;
    setTipId(nextId);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    centreAnimRef.current = null;
    velocityRef.current = { yaw: 0, pitch: 0 };
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drag = dragRef.current;
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (drag.moved) {
        const yawDelta = dx * DRAG_SENSITIVITY;
        const pitchDelta = dy * PITCH_SENSITIVITY;
        cameraRef.current.yaw += yawDelta;
        cameraRef.current.pitch = clamp(cameraRef.current.pitch + pitchDelta, -1.3, 1.3);
        velocityRef.current.yaw = yawDelta;
        velocityRef.current.pitch = pitchDelta;
        applyHover(null);
        return;
      }
    }
    const rect = canvas.getBoundingClientRect();
    applyHover(hitTest(event.clientX - rect.left, event.clientY - rect.top));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const node = hitTest(event.clientX - rect.left, event.clientY - rect.top);
      propsRef.current.onSelect(node?.id ?? null);
    }
  };

  const handlePointerLeave = () => {
    applyHover(null);
  };

  const centreMap = () => {
    applyHover(null);
    velocityRef.current = { yaw: 0, pitch: 0 };
    centreAnimRef.current = { from: { ...cameraRef.current }, start: performance.now() };
  };

  const tipFile = tipId ? layout.byId.get(tipId) : undefined;

  return (
    <div ref={wrapRef} className={cn('relative h-full min-h-0 w-full touch-none select-none overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        className={cn('h-full w-full', interactive && 'cursor-grab active:cursor-grabbing')}
        style={{ width: '100%', height: '100%' }}
        onPointerDown={interactive ? handlePointerDown : undefined}
        onPointerMove={interactive ? handlePointerMove : undefined}
        onPointerUp={interactive ? handlePointerUp : undefined}
        onPointerCancel={
          interactive
            ? () => {
                dragRef.current = null;
              }
            : undefined
        }
        onPointerLeave={interactive ? handlePointerLeave : undefined}
      />

      {interactive && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            centreMap();
          }}
          className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-[8px] bg-background/80 text-fg-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          aria-label="Reset view"
          title="Reset view"
        >
          <HugeiconsIcon icon={NavigationTwoIcon} size={15} />
        </button>
      )}

      {tipId && tipFile && (
        <div ref={tipElRef} className="pointer-events-none absolute left-0 top-0 z-30">
          <span className="block whitespace-nowrap rounded-[6px] bg-foreground px-2 py-1 font-mono text-[10.5px] font-medium text-background">
            {tipFile.path}
          </span>
          <span className="mt-0.5 block whitespace-nowrap rounded-[6px] bg-foreground/85 px-2 py-0.5 text-[10px] text-background">
            {tipFile.language} · {tipFile.kind} · {tipFile.loc} lines
          </span>
        </div>
      )}
    </div>
  );
}
