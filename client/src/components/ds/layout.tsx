import React from "react";


import { cn } from "@/lib/utils";
import { Button } from "@/components/button";

/* ──────────────────────────────────────────────────────────────────────────
   Inline helpers
   ────────────────────────────────────────────────────────────────────────── */

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/* ──────────────────────────────────────────────────────────────────────────
   1) IN-APP PAGE SHELL
   Every dashboard/app page renders inside <AppLayout>; then the body is:
     <AppPage>
       <AppTopbar title="Open Tickets" actions={...} />
       <AppBody>  (or <AppBodyPadded>)
         ...content
       </AppBody>
     </AppPage>
   ────────────────────────────────────────────────────────────────────────── */

export function AppPage({ className, ...props }: DivProps) {
  return (
    <div
      {...props}
      className={cn("flex h-full min-h-0 flex-col bg-page page-enter", className)}
    />
  );
}

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ElementType;
  iconColor?: string;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  className?: string;
}

/**
 * Unified page header — the single header bar for every in-app page.
 *
 * Layout:
 *   [Menu] │ [Title]                          [actions]
 *
 * On mobile the menu button slides to the left with a floating vertical divider.
 * All authenticated app pages use this one component.
 */
export function PageHeader({ title, subtitle, icon: Icon, iconColor, actions, leading, className }: PageHeaderProps) {
  return (
    <header className={cn("lds-app-topbar", className)}>
      <div className="lds-app-topbar-row">
        <div className="flex min-w-0 items-center">
          <div className="flex min-w-0 items-center gap-2 flex-1">
            {leading}
            <span className="lds-app-title truncate">{title}</span>
            {subtitle && (
              <span className="text-[12.5px] text-fg-subtle truncate">{subtitle}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      </div>
      <div className="lds-app-topbar-divider" />
    </header>
  );
}

/** @deprecated — use PageHeader instead. Kept for backward compatibility. */
export const AppTopbar = PageHeader;

/** Scrollable body for an in-app page. No inner padding — use <AppBodyPadded> for the default padded layout. */
export function AppBody({ className, ...props }: DivProps) {
  return (
    <div
      {...props}
      className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden", className)}
    />
  );
}

/** Default padded body: 16/24px padding on mobile, 24/32px on desktop, centred 1060px max width. */
export function AppBodyPadded({ className, children, ...props }: DivProps) {
  return (
    <AppBody {...props} className={className}>
      <div className="mx-auto w-full max-w-[1060px] px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-8">
        {children}
      </div>
    </AppBody>
  );
}

/** Narrow 720px body, used for settings and text-heavy pages. */
export function AppBodyNarrow({ className, children, ...props }: DivProps) {
  return (
    <AppBody {...props} className={className}>
      <div className="mx-auto w-full max-w-[720px] px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8">
        {children}
      </div>
    </AppBody>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   1.5) CONTENT PANEL — bordered container used by every in-app page
   Every page should render inside <AppPage>, then wrap content in:
     <ContentPanel header={<PageHeader ... />}>
       ...content...
     </ContentPanel>
   For two-panel layouts (inbox, etc.):
     <ContentPanel.SplitPanels
       left={<LeftPanel />}
       right={<RightPanel />}
     />
   ────────────────────────────────────────────────────────────────────────── */

export interface ContentPanelProps {
  header?: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
  maxWidth?: "narrow" | "wide" | "full";
  className?: string;
  children?: React.ReactNode;
}

export function ContentPanel({ header, title, actions, maxWidth = "full", className, children }: ContentPanelProps) {
  return (
    <div className="flex flex-1 min-h-0">
      <div className={cn("flex-1 min-w-0 bg-background border-x border-t border-border/60 rounded-tl-[16px] flex flex-col overflow-hidden", className)}>
        {header ?? (title ? (
          <div className="flex items-center justify-between px-4 md:pt-1 md:pb-1.5 border-b border-border/40 shrink-0 md:min-h-[32px] max-md:min-h-[52px]">
            <span className="text-[14px] font-medium text-foreground">{title}</span>
            {actions && <div className="flex items-center gap-0.5 shrink-0">{actions}</div>}
          </div>
        ) : null)}
        <div className={cn(
          "flex-1 min-h-0 overflow-y-auto overflow-x-hidden mx-auto w-full",
          maxWidth === "narrow" && "max-w-[720px] px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8",
          maxWidth === "wide" && "max-w-[1060px] px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8",
          maxWidth === "full" && "p-0",
        )}>
          {children}
        </div>
      </div>
    </div>
  );
}

export interface SplitContentPanelsProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftSize?: number;
  rightSize?: number;
  className?: string;
}

export function SplitContentPanels({ left, right, leftSize = 30, rightSize = 70, className }: SplitContentPanelsProps) {
  return (
    <div className={cn("flex flex-1 min-h-0 md:overflow-hidden overflow-x-auto", className)}>
      <div className={cn("w-[300px] shrink-0 bg-background border border-border/60 rounded-tl-[16px] flex-col overflow-hidden")}
      >
        {left}
      </div>
      <div className={cn("flex-1 min-w-0 bg-background flex-col overflow-hidden border-t border-border/60")}
      >
        {right}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   2) MODAL CARD — floating card with light blur backdrop
   ────────────────────────────────────────────────────────────────────────── */

export function ModalCard({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background rounded-2xl border border-border w-full max-w-md mx-4 px-3 py-2">
        {title && (
          <div className="flex items-center justify-between mb-0.5">
            <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
            <button onClick={onClose} className="flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-foreground hover:bg-surface-hover transition-colors bg-none border-none cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   3) PAGE HEADING (inside AppBodyPadded)
   ────────────────────────────────────────────────────────────────────────── */

export interface PageHeadingProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeading({ title, description, actions, className }: PageHeadingProps) {
  return (
    <div className={cn("flex items-start justify-between gap-6 pb-7 mb-6 border-b border-[hsl(var(--border))]", className)}>
      <div className="min-w-0 flex-1">
        <h1 className="lds-page-title">{title}</h1>
        {description && (
          <p className="mt-2 text-[13px] text-fg-muted font-medium leading-[1.6]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   4) SECTION
   ────────────────────────────────────────────────────────────────────────── */

export interface SectionProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/** Horizontal section block with optional title/description + actions. */
export function Section({ title, description, actions, className, children }: SectionProps) {
  return (
    <section className={cn("py-8 first:pt-0 border-b border-[hsl(var(--border))] last:border-b-0", className)}>
      {(title || description || actions) && (
        <header className="flex items-start justify-between gap-6 pb-5">
          <div className="min-w-0">
            {title && <h2 className="lds-section-title">{title}</h2>}
            {description && (
              <p className="mt-1.5 text-[13px] text-fg-muted font-medium leading-[1.6]">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   4.1) CARD — deprecated. Use Section + divider rows or ListSection instead.
   Kept for backward compatibility; will be removed in a future version.
   ────────────────────────────────────────────────────────────────────────── */

export interface CardProps extends DivProps {
  muted?: boolean;
}

/** @deprecated Use Section or ListSection + rows instead. Cards are being phased out. */
export function Card({ muted, className, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn(
        muted ? "lds-card-muted" : "lds-card",
        "transition-[border-color] duration-200 ease-out",
        className,
      )}
    />
  );
}

/** @deprecated */
export function CardHeader({ className, ...props }: DivProps) {
  return (
    <div
      {...props}
      className={cn("flex items-center justify-between gap-3 px-5 py-4 border-b border-border", className)}
    />
  );
}

/** @deprecated */
export function CardBody({ className, ...props }: DivProps) {
  return <div {...props} className={cn("px-5 py-5", className)} />;
}

/** @deprecated */
export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      {...props}
      className={cn("flex items-center justify-end gap-2 px-5 py-3 border-t border-border", className)}
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   4.2) LIST SECTION — a section header for grouped rows ("Today", "Yesterday")
   ────────────────────────────────────────────────────────────────────────── */

export interface ListSectionProps {
  label: string;
  className?: string;
}

