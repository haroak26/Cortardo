import { useRef, useState, type ReactNode } from "react";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * The canvas surface for mobile. Today it hosts a placeholder "screen card"
 * (the real render surface will drop in as `children` later), but the pan/zoom
 * gesture foundation is fully implemented so the future surface is immediately
 * touch-friendly — the thing competitors consistently get wrong.
 *
 * Zoom is controlled by the parent (the editor toolbar drives `zoom`/`onZoomChange`)
 * so the toolbar's zoom buttons actually scale this surface.
 */
export function CanvasViewport({
  children,
  zoom,
  onZoomChange,
}: {
  children?: ReactNode;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastSingle = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef<{ lastDist: number; startOffset: { x: number; y: number }; startScale: number } | null>(null);

  const fit = () => {
    onZoomChange(1);
    setOffset({ x: 0, y: 0 });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinch.current = { lastDist: dist, startOffset: offset, startScale: zoom };
      lastSingle.current = null;
    } else if (pointers.current.size === 1) {
      lastSingle.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const size = pointers.current.size;

    if (size === 1 && lastSingle.current) {
      const dx = e.clientX - lastSingle.current.x;
      const dy = e.clientY - lastSingle.current.y;
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
      lastSingle.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (size === 2 && pinch.current) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const newScale = clampScale(pinch.current.startScale * (dist / pinch.current.lastDist));
      const px = (mid.x - cx - pinch.current.startOffset.x) / pinch.current.startScale;
      const py = (mid.y - cy - pinch.current.startOffset.y) / pinch.current.startScale;
      onZoomChange(newScale);
      setOffset({ x: mid.x - cx - px * newScale, y: mid.y - cy - py * newScale });
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      const remaining = [...pointers.current.values()][0];
      lastSingle.current = remaining;
      pinch.current = null;
    } else if (pointers.current.size === 0) {
      lastSingle.current = null;
      pinch.current = null;
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 overflow-hidden bg-[hsl(var(--surface-hover))] touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={endPointer}
      onDoubleClick={fit}
    >
      <div
        className="absolute inset-0 flex items-center justify-center will-change-transform"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
      >
        {children}
      </div>
    </div>
  );
}
