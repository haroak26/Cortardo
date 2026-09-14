import React from 'react';
import { Badge } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import { cn } from '@/lib/utils';
import { SEVERITY_ORDER, SEVERITY_META, type SeverityCounts, type SeverityKey } from '@/lib/mock-review-data';

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const RUN_STATUS_META: Record<string, { label: string; tone: BadgeTone; color: string; pulse?: boolean }> = {
  queued: { label: 'Queued', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  preparing: { label: 'Preparing', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  indexing: { label: 'Indexing', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  planning: { label: 'Planning', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  reviewing: { label: 'Reviewing', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  verifying: { label: 'Verifying', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  sandboxing: { label: 'Sandboxing', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  fixing: { label: 'Fixing', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  publishing: { label: 'Publishing', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  summarizing: { label: 'Summarizing', tone: 'brand', color: 'hsl(var(--brand))', pulse: true },
  done: { label: 'Completed', tone: 'success', color: 'hsl(var(--success))' },
  error: { label: 'Failed', tone: 'danger', color: 'hsl(var(--danger))' },
  cancelled: { label: 'Cancelled', tone: 'neutral', color: 'hsl(var(--fg-faint))' },
};

export function runStatus(status: string) {
  return RUN_STATUS_META[status] ?? { label: status, tone: 'neutral' as BadgeTone, color: 'hsl(var(--fg-faint))' };
}

export const FINDING_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'warning' },
  fixed: { label: 'Fixed', tone: 'success' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

export function SeverityDot({ severity, size = 8 }: { severity: string; size?: number }) {
  const meta = SEVERITY_META[severity as SeverityKey] ?? SEVERITY_META.info;
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, background: meta.color }}
      title={meta.label}
      aria-label={meta.label}
    />
  );
}

export function RunStatusDot({ status }: { status: string }) {
  const meta = runStatus(status);
  return (
    <span
      className="inline-block w-[8px] h-[8px] rounded-full shrink-0"
      style={{ background: meta.color }}
      title={meta.label}
      aria-hidden="true"
    />
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const meta = runStatus(status);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** Compact severity tally, showing the most serious one or two buckets. */
export function SeverityChips({ severity, max = 2 }: { severity: SeverityCounts; max?: number }) {
  const rows = SEVERITY_ORDER.filter((key) => severity[key] > 0).slice(0, max);
  if (rows.length === 0) {
    return <span className="text-[12px] text-fg-faint whitespace-nowrap">No findings</span>;
  }
  return (
    <>
      {rows.map((key) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium whitespace-nowrap"
          style={{ color: SEVERITY_META[key].color }}
        >
          <SeverityDot severity={key} />
          {severity[key]}
        </span>
      ))}
    </>
  );
}

/** Horizontal severity distribution bars with counts. */
export function SeverityBars({ severity, className }: { severity: SeverityCounts; className?: string }) {
  const max = Math.max(1, ...SEVERITY_ORDER.map((key) => severity[key]));
  return (
    <div className={className}>
      {SEVERITY_ORDER.map((key) => {
        const count = severity[key];
        return (
          <div key={key} className="flex items-center gap-3 py-1.5">
            <span className="w-[58px] shrink-0 text-[12px] text-fg-muted">{SEVERITY_META[key].label}</span>
            <div className="flex-1 h-[6px] rounded-full bg-surface-hover overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${Math.round((count / max) * 100)}%`, background: SEVERITY_META[key].color }}
              />
            </div>
            <span className="w-[24px] shrink-0 text-right text-[12px] text-foreground tabular-nums">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Shared page shell matching the app pages (title + actions + padded body). */
export function ReviewPageShell({
  title,
  description,
  actions,
  children,
  maxWidth = 'max-w-5xl',
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;
  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className={`flex-1 px-4 sm:px-6 md:px-8 pt-10 pb-4 sm:pt-14 sm:pb-6 ${maxWidth} mx-auto w-full`}>
        {hasHeader && (
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="min-w-0">
              {title && (
                <h1 className="font-sans text-[15px] font-medium leading-tight text-foreground truncate">
                  {title}
                </h1>
              )}
              {description && (
                <p className="mt-0.5 text-[12px] font-[450] leading-snug text-fg-warm">
                  {description}
                </p>
              )}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** A framed surface used for dashboard panels. */
export function Panel({
  title,
  meta,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <FramedCard className={className}>
      {(title || meta) && (
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
          {title && <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>}
          {meta && <div className="shrink-0">{meta}</div>}
        </div>
      )}
      <div className={bodyClassName ?? 'px-4 sm:px-5 pb-4'}>{children}</div>
    </FramedCard>
  );
}

/** Hairline divider with a small square centred on each end. */
export function MarkedDivider({ className }: { className?: string }) {
  const square =
    'pointer-events-none absolute top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-[2px] border border-border/70 bg-background';
  return (
    <div className={cn('relative h-px bg-border/70', className)}>
      <span aria-hidden="true" className={cn(square, '-left-[3.5px]')} />
      <span aria-hidden="true" className={cn(square, '-right-[3.5px]')} />
    </div>
  );
}

/** Vertical hairline divider with a small square centred on each end. */
export function MarkedVDivider({ className }: { className?: string }) {
  const square =
    'pointer-events-none absolute left-1/2 h-[7px] w-[7px] -translate-x-1/2 rounded-[2px] border border-border/70 bg-background';
  return (
    <div className={cn('relative w-px shrink-0 bg-border/70', className)}>
      <span aria-hidden="true" className={cn(square, 'top-0 -translate-y-1/2')} />
      <span aria-hidden="true" className={cn(square, 'bottom-0 translate-y-1/2')} />
    </div>
  );
}
