import React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DotMatrixValue, dotMatrixText } from "./dot-matrix";

/* ──────────────────────────────────────────────────────────────────────────
   METRIC CARD — the standard card surface for dashboards.
   Rounded like the settings cards, no corner markers, and the same 12px
   padding on every side. Values made of digits render as a 5×7 dot matrix
   unless dotMatrix is disabled. Extended cards (charts, tables, lists) use
   the same shell with textPosition="top" and their content as children.
   ────────────────────────────────────────────────────────────────────────── */

export type MetricTone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";

const TONE_TEXT: Record<MetricTone, string> = {
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-fg-muted",
};

const DELTA_RE = /^([+-]\d+)\s+(.+)$/;

export interface MetricCardProps {
  /** Card heading. Sits at the bottom of the card by default, at the top with textPosition="top". */
  label?: React.ReactNode;
  /** Metric value. Renderable strings/numbers become a 5×7 dot matrix when dotMatrix is on. */
  value?: React.ReactNode;
  /** Subtext under the label. Strings like "+14 in the last 7 days" render as a delta. */
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: MetricTone;
  /** Where the label and hint sit relative to the value. Default "bottom". */
  textPosition?: "bottom" | "top";
  /** Render the value as a dot matrix. Default true; only applies to renderable values. */
  dotMatrix?: boolean;
  className?: string;
  /** Body content — lists, charts, tables — shown between the value and the label. */
  children?: React.ReactNode;
}

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "brand",
  textPosition = "bottom",
  dotMatrix = true,
  className,
  children,
}: MetricCardProps) {
  const delta = typeof hint === "string" ? DELTA_RE.exec(hint) : null;
  const positive = delta?.[1].startsWith("+") ?? true;
  const dots = dotMatrix ? dotMatrixText(value) : null;

  const valueNode =
    dots !== null ? (
      <DotMatrixValue value={dots} />
    ) : value !== undefined && value !== null ? (
      <p className="text-[36px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {value}
      </p>
    ) : null;

  const labelNode =
    label !== undefined && label !== null ? (
      <p className="truncate text-[13.5px] font-medium leading-snug text-fg-muted">{label}</p>
    ) : null;

  const hintNode =
    hint !== undefined && hint !== null ? (
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] font-[450] leading-snug text-fg-warm/80">
        {delta ? (
          <>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 font-semibold tabular-nums",
                positive ? "text-success" : "text-danger",
              )}
            >
              {positive ? <ArrowUpRight size={13} strokeWidth={2.5} /> : <ArrowDownRight size={13} strokeWidth={2.5} />}
              {delta[1].replace(/^[+-]/, "")}
            </span>
            <span className="truncate">{delta[2]}</span>
          </>
        ) : (
          <span className="truncate">{hint}</span>
        )}
      </div>
    ) : null;

  const iconNode = Icon ? (
    <Icon size={15} strokeWidth={2} className={cn("shrink-0 opacity-80", TONE_TEXT[tone])} />
  ) : null;

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-[12px] border border-[hsl(var(--surface-hover))] bg-background p-3",
        className,
      )}
    >
      {textPosition === "top" ? (
        <>
          {(labelNode || iconNode) && (
            <div className="flex items-start justify-between gap-3">
              {/* -mt-1 pulls the text up by its line-height lead so the visual
                  gap above the header matches the 12px left/right padding. */}
              <div className="-mt-1 min-w-0">
                {labelNode}
                {hintNode}
              </div>
              {iconNode}
            </div>
          )}
          {valueNode && <div className="mt-6">{valueNode}</div>}
          {children && <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>}
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            {valueNode}
            {iconNode}
          </div>
          {children && <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>}
          {(labelNode || hintNode) && (
            <div className="mt-auto min-w-0 pt-6">
              {labelNode}
              {hintNode}
            </div>
          )}
        </>
      )}
    </div>
  );
}
