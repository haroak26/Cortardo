import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, Search, X, ChevronRight, Check, Plus, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";

type DivProps = React.HTMLAttributes<HTMLDivElement>;
export type ListSectionProps = { label: string; className?: string };

import { AppPage, PageHeader, AppBody, AppBodyPadded } from './layout';

export function ListSection({ label, className }: ListSectionProps) {
  return (
    <div className={cn("px-4 sm:px-6 pt-4 pb-1", className)}>
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-brand">
        {label}
      </span>
      <div className="h-px bg-border mt-1.5" />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   4.3) PILL FILTER — unified pill-shaped filter button
   ────────────────────────────────────────────────────────────────────────── */

export interface PillFilterProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function PillFilter({ active, className, children, ...props }: PillFilterProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1 h-[30px] px-3 rounded-full text-[12.5px] font-medium leading-none border cursor-pointer transition-all duration-150 whitespace-nowrap",
        active
          ? "bg-amber-muted border-amber-border text-amber"
          : "bg-transparent text-fg-muted border-border/60 hover:bg-amber-muted hover:border-amber-border hover:text-amber",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   5) ROWS — thin dividers between row-like content
   ────────────────────────────────────────────────────────────────────────── */

export interface FieldRowProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  align?: "center" | "start";
  className?: string;
}

export function FieldRow({ label, hint, children, align = "center", className }: FieldRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-4 border-b border-border last:border-b-0",
        "sm:flex-row sm:justify-between sm:gap-6",
        align === "start" ? "sm:items-start" : "sm:items-center",
        className,
      )}
    >
      <div className="min-w-0 sm:flex-1">
        <p className="text-[13.5px] font-medium text-foreground leading-snug">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] text-fg-muted leading-snug">{hint}</p>}
      </div>
      {children !== undefined && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end sm:shrink-0">
          {children}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   6) BADGES
   ────────────────────────────────────────────────────────────────────────── */

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
}

export function Badge({ tone = "neutral", size = "sm", className, children, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cn(
        size === "sm" ? "lds-badge-sm" : "lds-badge-md",
        `lds-badge-${tone}`,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** "NEW / Platform / Beta" pill used on marketing & sometimes in-app. */
export function Eyebrow({
  label,
  children,
  className,
}: {
  label: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-1 py-1 pr-4 rounded-full select-none",
        "bg-surface-subtle",
        className,
      )}
    >
      <span className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase",
        label === "NEW" ? "bg-brand text-brand-foreground" : "text-brand",
      )}>
        {label}
      </span>
      {children && (
        <span className="text-[13px] font-medium text-fg-muted">{children}</span>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   7) EMPTY STATE
   ────────────────────────────────────────────────────────────────────────── */

export interface EmptyStateProps {
  icon?: React.ElementType;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  iconColor?: string;
  iconBg?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
  iconColor,
  iconBg,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 py-16 px-6",
        className,
      )}
    >
      {Icon && (
        <div
          className="flex items-center justify-center w-11 h-11 rounded-full"
          style={{
            background: iconBg ?? 'hsl(var(--surface-hover))',
            color: iconColor ?? 'hsl(var(--fg-subtle))',
          }}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      )}
      <div className="space-y-1 max-w-sm">
        <p className="text-[14px] font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-[12.5px] text-fg-muted leading-[1.6]">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 pt-2">{actions}</div>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   8) STAT — flat stat block (no card border)
   ────────────────────────────────────────────────────────────────────────── */

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: BadgeTone;
  className?: string;
}

/** Flat stat block. No border, no background — just content in a grid cell. */
export function StatCard({ label, value, hint, icon: Icon, tone = "brand", className }: StatCardProps) {
  return (
    <div className={cn("flex flex-col gap-2 py-3", className)}>
      <div className="flex items-center justify-between">
        <span className="lds-section-label">{label}</span>
        {Icon && (
          <span
            className={cn(
              "inline-flex items-center justify-center w-7 h-7 rounded-[8px]",
              tone === "brand" && "bg-brand/10 text-brand",
              tone === "success" && "bg-success/10 text-success",
              tone === "warning" && "bg-warning/10 text-warning",
              tone === "danger" && "bg-danger/10 text-danger",
              tone === "info" && "bg-info/10 text-info",
              tone === "neutral" && "bg-surface-hover text-fg-muted",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        )}
      </div>
      <div>
        <p className="text-[24px] leading-none font-semibold tracking-tight text-foreground">{value}</p>
        {hint && <p className="mt-2 text-[12.5px] text-fg-muted">{hint}</p>}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   9) DATA TABLE — the single table pattern used across the app
   ────────────────────────────────────────────────────────────────────────── */

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  align?: "left" | "right" | "center";
  width?: number | string;
  render: (row: T, index: number) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
  activeRowKey?: string;
  empty?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  activeRowKey,
  empty,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width, textAlign: c.align ?? "left" }}
                className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-fg-subtle whitespace-nowrap"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = getRowKey(row, i);
            const active = key === activeRowKey;
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={cn(
                  "border-b border-border-subtle last:border-b-0 transition-colors",
                  onRowClick && "cursor-pointer",
                  active ? "bg-brand/5" : "hover:bg-surface-hover/60",
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{ textAlign: c.align ?? "left" }}
                    className="px-4 py-3 text-[13px] text-foreground align-middle"
                  >
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   10) TOOLBAR — for in-page filter / search rows
   ────────────────────────────────────────────────────────────────────────── */

export function Toolbar({ className, ...props }: DivProps) {
  return (
    <div
      {...props}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border",
        className,
      )}
    />
  );
}

export function ToolbarGroup({ className, ...props }: DivProps) {
  return <div {...props} className={cn("flex items-center gap-2", className)} />;
}

/* ──────────────────────────────────────────────────────────────────────────
   11) FILTER CHIP — one-line tab/filter selector
   ────────────────────────────────────────────────────────────────────────── */

export interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}
export function FilterChip({ active, className, children, ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-[30px] px-3 rounded-[10px] text-[12.5px] font-medium border transition-all duration-150 ease-out",
        active
          ? "bg-amber-muted border-amber-border text-amber"
          : "bg-background text-fg-muted border-transparent hover:bg-amber-muted hover:border-amber-border hover:text-amber",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function OptionsSelector<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1", className)}>
      {options.map(opt => (
        <FilterChip key={opt.value} active={opt.value === value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </FilterChip>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   12) DROPDOWN — unified select/option component
   White card with light grey outline. Selected option has a light grey
   rounded highlight with a gap from the card edge.
   ────────────────────────────────────────────────────────────────────────── */

export interface DropdownOption<T = string> {
  value: T;
  label: React.ReactNode;
  description?: string;
  disabled?: boolean;
  divider?: boolean;
  sectionHeader?: string;
}

export interface DropdownProps<T = string> {
  value: T;
  onChange: (value: T) => void;
  options: DropdownOption<T>[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  /** Custom render for the trigger button */
  renderTrigger?: (selected: DropdownOption<T> | undefined, open: boolean) => React.ReactNode;
  /** Enable search filtering inside the dropdown */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Show chevron arrow in trigger button (default true) */
  showChevron?: boolean;
  /** Align the dropdown menu */
  menuAlign?: "right" | "center" | "left";
  /** Side the dropdown opens from (default bottom) */
  menuSide?: "bottom" | "top";
  /** Render menu in a portal to avoid overflow clipping (default false) */
  portaled?: boolean;
}

export function Dropdown<T = string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  triggerClassName,
  renderTrigger,
  searchable,
  searchPlaceholder = "Search…",
  showChevron = true,
  menuAlign = "right",
  menuSide = "bottom",
  portaled = false,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuPos, setMenuPos] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  useEffect(() => {
    if (!open) { setSearchQuery(''); setMenuPos(null); }
  }, [open]);

  const filtered = searchable && searchQuery
    ? options.filter(o =>
        String(o.label).toLowerCase().includes(searchQuery.toLowerCase()) ||
        (o.description && o.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : options;

  const renderMenuItems = () => (
    <>
      {searchable && (
        <div className="relative mb-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
          <TextInput
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            variant="ghost"
            
            className="pl-8 pr-3 border border-border"
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
      {filtered.length === 0 && (
        <div className="px-3 py-6 text-center text-[13px] text-fg-muted">No options</div>
      )}
      <div className="max-h-56 overflow-y-auto space-y-0.5">
        {filtered.map((opt, idx) => {
          if (opt.divider) {
            return <div key={String(opt.value)} className="h-px bg-border/60 mx-2 my-4" />;
          }
          const isSelected = opt.value === value;
          const showHeader = opt.sectionHeader && (idx === 0 || filtered[idx - 1]?.sectionHeader !== opt.sectionHeader);
          return (
            <div key={String(opt.value)}>
              {showHeader && (
                <div className="px-2.5 py-2 text-[11px] font-semibold text-fg-muted border-b border-border/40 mx-0 mb-1">
                  {opt.sectionHeader}
                </div>
              )}
              <button
                type="button"
                disabled={opt.disabled}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[14px] text-left text-[13px] font-medium",
                  "transition-all duration-100 ease-out disabled:opacity-40 disabled:cursor-not-allowed",
                  isSelected
                    ? "bg-[hsl(var(--surface-hover))] text-foreground"
                    : "text-fg-muted hover:text-foreground hover:bg-[hsl(var(--surface-hover)/0.6)]",
                )}
              >
                {opt.label}
                {opt.description && (
                  <span className="text-[11px] text-fg-subtle ml-auto">{opt.description}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open && portaled) {
            requestAnimationFrame(() => {
              if (triggerRef.current) {
                const r = triggerRef.current.getBoundingClientRect();
                setMenuPos({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
              }
            });
          }
        }}
        className={
          triggerClassName || (
            open
              ? "inline-flex items-center justify-between gap-2 w-full cursor-pointer h-8 px-3 text-sm rounded-[14px] bg-background border border-[hsl(var(--border-strong))] text-foreground transition-all duration-200 ease-out"
              : "inline-flex items-center justify-between gap-2 w-full cursor-pointer h-8 px-3 text-sm rounded-[14px] bg-background border border-[hsl(var(--border))] text-foreground transition-all duration-200 ease-out"
          )
        }
      >
        {renderTrigger
          ? renderTrigger(selected, open)
          : <span className={selected ? "text-foreground" : "text-[hsl(var(--fg-subtle))]"}>{selected ? selected.label : placeholder}</span>
        }
        {showChevron && (
          <ChevronDown
            className="h-4 w-4 text-fg-muted shrink-0"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease' }}
          />
        )}
      </button>

      {open && (portaled && menuPos ? createPortal(
        <div
          style={{
            position: 'fixed',
            ...(menuSide === "top"
              ? { bottom: window.innerHeight - menuPos.top + 6 }
              : { top: menuPos.bottom + 6 }),
            left: menuAlign === 'right' ? menuPos.left + menuPos.width : menuPos.left,
            zIndex: 50,
          }}
          className={cn(
            "min-w-[220px] max-w-[320px]",
            menuAlign === "center" ? "-translate-x-1/2" : "",
            "bg-background border border-border rounded-[20px] p-1.5 space-y-0.5",
            "animate-in fade-in zoom-in-95 duration-150",
          )}
        >
          {renderMenuItems()}
        </div>,
        document.body
      ) : (
        <div
          className={cn(
            "absolute z-50 min-w-[220px] max-w-[320px]",
            menuSide === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            menuAlign === "center" ? "left-1/2 -translate-x-1/2" : menuAlign === "left" ? "left-0" : "right-0",
            "bg-background border border-border rounded-[20px] p-1.5 space-y-0.5",
            "animate-in fade-in zoom-in-95 duration-150",
          )}
        >
          {renderMenuItems()}
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   13) STATUS BADGE — unified status indicator with icon + color
   Replaces ad-hoc inline status badges across Tickets, Contacts, and Reviews.
   ────────────────────────────────────────────────────────────────────────── */

export interface StatusBadgeProps {
  icon?: React.ElementType;
  color: string;
  label: string;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({ icon: Icon, color, label, size = "sm", className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold tracking-wide shrink-0",
        size === "sm" ? "px-2 py-0.5 rounded-md text-[11px]" : "px-2.5 py-1 rounded-lg text-[12px]",
        className,
      )}
      style={{ background: `${color}15`, color }}
    >
      {Icon && <Icon size={size === "sm" ? 10 : 12} strokeWidth={2} />}
      {label}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   14) PAGE TOOLBAR — standardized page filter/search/action bar
   Use below PageHeader for filter controls, search, and primary actions.
   ────────────────────────────────────────────────────────────────────────── */

export function PageToolbar({ className, ...props }: DivProps) {
  return (
    <div
      {...props}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-2.5 border-b border-border shrink-0 bg-background",
        className,
      )}
    />
  );
}

export function PageToolbarGroup({ className, ...props }: DivProps) {
  return <div {...props} className={cn("flex items-center gap-1.5 flex-wrap", className)} />;
}

/* ──────────────────────────────────────────────────────────────────────────
   15) LIST ITEM — standardized list row
   Single source of truth for every clickable row in list pages.
   ────────────────────────────────────────────────────────────────────────── */

export interface ListItemProps {
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  avatar?: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  suffix?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function ListItem({
  icon: Icon,
  iconColor,
  iconBg,
  avatar,
  label,
  description,
  meta,
  suffix,
  selected,
  onClick,
  className,
  children,
}: ListItemProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "lds-row-interactive flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border-subtle last:border-b-0",
        onClick && "cursor-pointer",
        selected && "bg-surface-hover",
        className,
      )}
    >
      {(Icon || avatar) && (
        <div className="shrink-0">
          {avatar ?? (Icon && (
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
              style={{
                background: iconBg ?? `${iconColor ?? "#4682B4"}15`,
                color: iconColor ?? "#4682B4",
              }}
            >
              <Icon size={15} strokeWidth={1.75} />
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-foreground truncate">{label}</div>
        {description && (
          <div className="text-[12.5px] text-fg-muted truncate mt-0.5">{description}</div>
        )}
      </div>

      {(meta || suffix || children || onClick) && (
        <div className="flex items-center gap-2 shrink-0">
          {children}
          {meta && <span className="text-[12px] text-fg-faint whitespace-nowrap">{meta}</span>}
          {suffix}
          {onClick && <ChevronRight size={13} className="text-fg-faint" />}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   16) LIST SKELETON / TABLE SKELETON — loading placeholders
   ────────────────────────────────────────────────────────────────────────── */

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn(className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border-subtle last:border-b-0 animate-pulse"
        >
          <div className="w-8 h-8 rounded-lg bg-surface-hover shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-3.5 w-36 bg-surface-hover rounded" />
            <div className="h-2.5 w-56 bg-surface-hover rounded" />
          </div>
          <div className="h-2.5 w-10 bg-surface-hover rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 4, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <div className="flex border-b border-border px-4 py-2.5 gap-4 animate-pulse">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="h-3 w-16 bg-surface-hover rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center px-4 py-3 gap-4 border-b border-border-subtle last:border-b-0 animate-pulse">
          {Array.from({ length: columns }).map((_, j) => (
            <div key={j} className="h-3 bg-surface-hover rounded" style={{ width: j === 0 ? 140 : 80 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   17) SLIDEOVER PANEL — right-side detail panel for master-detail layouts
   ────────────────────────────────────────────────────────────────────────── */

export function SlideoverPanel({
  open,
  onClose,
  title,
  width = 320,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div
      className={cn("flex flex-col h-full bg-background border-l border-border shrink-0 overflow-hidden animate-[slideInRight_0.2s_ease-out]", className)}
      style={{ width }}
    >
      <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
        <span className="text-[13px] font-semibold text-foreground truncate">{title}</span>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-6 h-6 rounded-md text-fg-subtle hover:text-foreground hover:bg-surface-hover transition-colors bg-none border-none cursor-pointer shrink-0"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   18) BULK ACTION BAR — selection bar that appears when rows are checked
   ────────────────────────────────────────────────────────────────────────── */

export function BulkActionBar({
  count,
  onClear,
  children,
  className,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 bg-brand/5 border-b border-brand-border shrink-0",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-medium text-brand">{count} selected</span>
        <button
          onClick={onClear}
          className="text-[12px] font-medium text-brand/60 hover:text-brand transition-colors bg-none border-none cursor-pointer p-0"
        >
          Clear
        </button>
      </div>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   19) PAGE TEMPLATES — standardized page composition patterns
   Every app page should use one of these three templates.
   ────────────────────────────────────────────────────────────────────────── */

export interface ListPageProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ElementType;
  iconColor?: string;
  headerActions?: React.ReactNode;
  toolbar?: React.ReactNode;
  bulkBar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export function ListPage({
  title,
  subtitle,
  icon,
  iconColor,
  headerActions,
  toolbar,
  bulkBar,
  children,
  className,
  headerClassName,
}: ListPageProps) {
  return (
    <AppPage className={className}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        iconColor={iconColor}
        actions={headerActions}
        className={headerClassName}
      />
      {bulkBar}
      {toolbar}
      <AppBody>{children}</AppBody>
    </AppPage>
  );
}

export interface ListDetailPageProps {
  title: React.ReactNode;
  icon?: React.ElementType;
  iconColor?: string;
  headerActions?: React.ReactNode;
  toolbar?: React.ReactNode;
  bulkBar?: React.ReactNode;
  list: React.ReactNode;
  detail?: React.ReactNode;
  detailWidth?: number;
  className?: string;
}

export function ListDetailPage({
  title,
  icon,
  iconColor,
  headerActions,
  toolbar,
  bulkBar,
  list,
  detail,
  detailWidth,
  className,
}: ListDetailPageProps) {
  return (
    <AppPage className={className}>
      <PageHeader title={title} icon={icon} iconColor={iconColor} actions={headerActions} />
      {bulkBar}
      {toolbar}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <AppBody>{list}</AppBody>
        </div>
        {detail && (
          <SlideoverPanel
            open={true}
            onClose={() => {}}
            title=""
            width={detailWidth}
          >
            {detail}
          </SlideoverPanel>
        )}
      </div>
    </AppPage>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   21) TAG CHIP — colored pill for email tags
   ────────────────────────────────────────────────────────────────────────── */

export interface TagChipProps {
  name: string;
  color?: string;
  size?: "sm" | "md";
  onRemove?: () => void;
  className?: string;
}

export function TagChip({ name, color = "#4682B4", size = "sm", onRemove, className }: TagChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium shrink-0 select-none",
        size === "sm" ? "h-[18px] px-1.5 py-[1px] rounded-[6px] text-[10.5px] leading-none" : "px-2 py-[3px] rounded-[8px] text-[12px]",
        className,
      )}
      style={{ background: `color-mix(in srgb, ${color} 15%, white)`, color }}
    >
      <span
        className="shrink-0 rounded-full"
        style={{ width: size === "sm" ? 5 : 6, height: size === "sm" ? 5 : 6, background: color }}
      />
      {name}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          type="button"
          className="flex items-center justify-center border-none bg-transparent cursor-pointer p-0 rounded-full opacity-50 hover:opacity-100 transition-opacity"
          style={{ color }}
        >
          <X size={size === "sm" ? 10 : 11} strokeWidth={2} />
        </button>
      )}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   22) TAG PICKER — dropdown for selecting/creating tags
   ────────────────────────────────────────────────────────────────────────── */

export interface TagPickerTag {
  id: string;
  name: string;
  color: string;
}

export function TagPicker({
  open,
  onClose,
  tags,
  selectedIds,
  onToggle,
  onTagCreated,
  onTagUpdated,
  onClear,
  spaceId,
  className,
  tagApiPrefix,
  tagApiIdPrefix,
}: {
  open: boolean;
  onClose: () => void;
  tags: TagPickerTag[];
  selectedIds: string[];
  onToggle: (tagId: string) => void;
  onTagCreated?: (tag: TagPickerTag) => void;
  onTagUpdated?: (tag: TagPickerTag) => void;
  onClear?: () => void;
  spaceId?: string;
  className?: string;
  tagApiPrefix?: string;
  tagApiIdPrefix?: string;
}) {
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#4682B4');
  const [creating, setCreating] = useState(false);
  const [editingTag, setEditingTag] = useState<TagPickerTag | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    if (open) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [open, onClose]);

  useEffect(() => {
    if (!open) { setSearch(''); setNewName(''); setCreating(false); }
  }, [open]);

  const colorOptions = ['#4682B4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#e879f9', '#22d3ee', '#fb923c', '#a78bfa'];

  const filtered = tags.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  const randomColor = () => colorOptions[Math.floor(Math.random() * colorOptions.length)];

  const handleQuickCreate = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onTagCreated?.(existing);
      setSearch('');
      return;
    }
    const color = randomColor();
    if (spaceId) {
      try {
        const res = await fetch(`${tagApiPrefix ?? `/api/spaces/${spaceId}/tags`}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed, color }),
        });
        if (res.ok) {
          const tag = await res.json();
          onTagCreated?.(tag);
          setSearch('');
          return;
        }
      } catch {}
    }
    onTagCreated?.({ id: `new-${Date.now()}`, name: trimmed, color });
    setSearch('');
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const existing = tags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onTagCreated?.(existing);
      setNewName('');
      setCreating(false);
      return;
    }
    if (spaceId) {
      try {
        const res = await fetch(`${tagApiPrefix ?? `/api/spaces/${spaceId}/tags`}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed, color: newColor }),
        });
        if (res.ok) {
          const tag = await res.json();
          onTagCreated?.(tag);
          setNewName('');
          setCreating(false);
          return;
        }
      } catch {}
    }
    const fakeId = `new-${Date.now()}`;
    onTagCreated?.({ id: fakeId, name: trimmed, color: newColor });
    setNewName('');
    setCreating(false);
  };

  const handleStartEdit = (tag: TagPickerTag) => {
    setEditingTag(tag);
    setNewName(tag.name);
    setNewColor(tag.color);
    setCreating(true);
  };

  const handleUpdate = async () => {
    const trimmed = newName.trim();
    if (!trimmed || !editingTag) return;
    try {
      const res = await fetch(`${tagApiIdPrefix ?? `/api/tags/`}${editingTag.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, color: newColor }),
      });
      if (res.ok) {
        const tag = await res.json();
        onTagUpdated?.(tag);
        setNewName('');
        setNewColor('#4682B4');
        setCreating(false);
        setEditingTag(null);
      }
    } catch {}
  };

  if (!open) return null;

  return (
    <div ref={ref} className={cn("absolute z-50 right-0 top-full mt-1.5 min-w-[220px] max-w-[320px] bg-background border border-border rounded-[20px] p-1.5 space-y-0.5", className)}>
      <div className="relative mb-1">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
        <TextInput
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tags..."
          variant="ghost"
          size="sm"
          className="pl-8 pr-3 border border-border"
          autoFocus
          onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter' && filtered.length === 0 && search.trim()) { e.preventDefault(); handleQuickCreate(search); } }}
        />
      </div>

      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filtered.map(tag => (
          <button
            key={tag.id}
            type="button"
            onClick={() => onToggle(tag.id)}
            className="group flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-left text-[13px] font-medium transition-all hover:bg-surface-hover text-foreground bg-none border-none cursor-pointer"
          >
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: tag.color }}
            />
            <span className="flex-1 truncate">{tag.name}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); handleStartEdit(tag); }}
              className="flex items-center justify-center border-none bg-none cursor-pointer p-0.5 rounded text-fg-faint hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              <Pencil size={11} strokeWidth={2} />
            </button>
            {selectedIds.includes(tag.id) && (
              <Check size={12} strokeWidth={2.5} className="text-brand shrink-0" />
            )}
          </button>
        ))}
        {filtered.length === 0 && search && (
          <button
            type="button"
            onClick={() => handleQuickCreate(search)}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-left text-[12px] text-foreground hover:bg-surface-hover transition-colors bg-none border-none cursor-pointer font-medium"
          >
            <Plus size={12} strokeWidth={2} />
            Create &ldquo;{search}&rdquo;
          </button>
        )}
      </div>

      {/* Clear tags */}
      {selectedIds.length > 0 && !creating && onClear && (
        <button
          type="button"
          onClick={() => { onClear(); onClose(); }}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-left text-[12px] text-danger hover:bg-danger/5 transition-colors bg-none border-none cursor-pointer"
        >
          <X size={12} strokeWidth={2} />
          Clear Filter
        </button>
      )}

      {/* Create tag */}
      {creating ? (
        <div className="border-t border-border mt-1.5 pt-1.5 space-y-2">
          <TextInput
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Add tag..."
            variant="ghost"
            size="sm"
            className="px-2.5 border border-border"
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            autoFocus
          />
          <div className="grid grid-cols-4 gap-2 place-items-center">
            {colorOptions.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className={cn(
                  "rounded-full transition-all duration-200 ease-out bg-none cursor-pointer hover:scale-125",
                  newColor === c && "scale-125",
                )}
                style={{
                  width: 20,
                  height: 20,
                  background: c,
                }}
              />
            ))}
          </div>
          <div className="flex items-center justify-end gap-1 pt-1">
            <button
              type="button"
              onClick={() => { setCreating(false); setEditingTag(null); setNewName(''); setNewColor('#4682B4'); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-[12px] font-medium text-fg-muted hover:text-foreground hover:bg-surface-hover transition-colors bg-none border-none cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={editingTag ? handleUpdate : handleCreate}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-[12px] font-medium text-foreground bg-surface-hover hover:bg-border transition-colors bg-none border-none cursor-pointer"
            >
              {editingTag ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      ) : !(filtered.length === 0 && search) && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-left text-[12px] text-fg-muted hover:text-foreground hover:bg-surface-hover transition-colors bg-none border-none cursor-pointer"
        >
          <Plus size={12} strokeWidth={2} />
          Create tag
        </button>
      )}
    </div>
  );
}

export interface DataDashboardPageProps {
  title: React.ReactNode;
  icon?: React.ElementType;
  iconColor?: string;
  headerActions?: React.ReactNode;
  stats?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function DataDashboardPage({
  title,
  icon,
  iconColor,
  headerActions,
  stats,
  children,
  className,
}: DataDashboardPageProps) {
  return (
    <AppPage className={className}>
      <PageHeader title={title} icon={icon} iconColor={iconColor} actions={headerActions} />
      <AppBodyPadded>
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pb-7 mb-7 border-b border-border">
            {stats}
          </div>
        )}
        {children}
      </AppBodyPadded>
    </AppPage>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   20) MARKETING PRIMITIVES (public pages)
   ────────────────────────────────────────────────────────────────────────── */

export function MarketingSection({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("w-full border-t border-border py-20 md:py-28", className)}>
      <div className="lds-marketing-section">{children}</div>
    </section>
  );
}

export function MarketingSectionHead({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-lg space-y-3", className)}>
      {eyebrow && <p className="lds-eyebrow">{eyebrow}</p>}
      <h2 className="lds-h1">{title}</h2>
      {description && <p className="lds-body text-[14px] leading-[1.7]">{description}</p>}
    </div>
  );
}

export function MarketingHero({
  eyebrow,
  eyebrowLabel,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode;
  eyebrowLabel?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="pt-20 pb-16 md:pt-24 md:pb-20">
      <div className="lds-marketing-section">
        <div className="max-w-3xl">
          {(eyebrow || eyebrowLabel) && (
            <div className="mb-7">
              {eyebrowLabel ? <Eyebrow label={eyebrowLabel}>{eyebrow}</Eyebrow> : eyebrow}
            </div>
          )}
          <h1 className="lds-display">{title}</h1>
          {description && (
            <p className="mt-6 max-w-[520px] lds-body text-[14px]">{description}</p>
          )}
          {actions && <div className="mt-10 flex flex-wrap items-center gap-3">{actions}</div>}
        </div>
      </div>
    </section>
  );
}

export function MarketingCTA({
  title,
  description,
  actions,
  footnote,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <MarketingSection>
      <div className="flex flex-col items-center text-center space-y-7 max-w-lg mx-auto">
        <h2 className="lds-h1 text-[40px]">{title}</h2>
        {description && <p className="lds-body text-[14px]">{description}</p>}
        {actions && <div className="flex items-center gap-3">{actions}</div>}
        {footnote && <div className="flex flex-wrap items-center justify-center gap-5">{footnote}</div>}
      </div>
    </MarketingSection>
  );
}

/** Split 2-column feature list (used on Landing + Features pages). */
export function FeatureGrid({
  items,
  columns = 2,
}: {
  items: { icon: LucideIcon; title: string; description: string; iconClassName?: string }[];
  columns?: 2 | 3;
}) {
  const cols =
    columns === 3
      ? "md:grid-cols-3 md:divide-x"
      : "md:grid-cols-2 md:divide-x";
  return (
    <div className={cn("grid grid-cols-1 divide-y md:divide-y-0 divide-border", cols)}>
      {items.map(({ icon: Icon, title, description, iconClassName }, i) => (
        <div
          key={title}
          className={cn(
            "flex gap-5 py-8",
            columns === 2 && i % 2 === 0 && "md:pr-10",
            columns === 2 && i % 2 === 1 && "md:pl-10",
            columns === 3 && i % 3 === 0 && "md:pr-8",
            columns === 3 && i % 3 === 1 && "md:px-8",
            columns === 3 && i % 3 === 2 && "md:pl-8",
          )}
        >
          <Icon className={cn("h-[18px] w-[18px] shrink-0 mt-0.5 text-brand", iconClassName)} strokeWidth={1.75} />
          <div className="space-y-1.5">
            <h3 className="text-[15px] font-semibold text-foreground tracking-[-0.01em]">{title}</h3>
            <p className="text-[13px] leading-[1.65] text-fg-muted font-medium">{description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
