import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface OpenDropdownProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  /** Whether the dropdown is currently open. */
  open?: boolean;
  /** Toggle handler for the trigger. */
  onClick?: () => void;
  /** Small text shown above the value. */
  label?: React.ReactNode;
  /** Primary text shown in the trigger. */
  value?: React.ReactNode;
  placeholder?: string;
  /** Custom trigger content — replaces `label`/`value`. */
  children?: React.ReactNode;
  /** Show the chevron on the right (default true). */
  chevron?: boolean;
}

/**
 * The standard button to open a dropdown. Pages with bespoke triggers can keep
 * their own; everywhere else this keeps every dropdown opener consistent.
 */
export const OpenDropdown = React.forwardRef<HTMLButtonElement, OpenDropdownProps>(
  (
    { open = false, onClick, label, value, placeholder = 'Select…', children, chevron = true, className, disabled, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'group flex w-full min-w-[170px] cursor-pointer select-none items-center justify-between gap-2 rounded-[8px] bg-surface-hover px-2 py-1.5 text-left transition-colors duration-100',
          'hover:outline hover:outline-1 hover:outline-[hsl(var(--border-strong))]',
          open && 'outline outline-1 outline-[hsl(var(--border-strong))]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          disabled && 'pointer-events-none opacity-50',
          className,
        )}
        {...props}
      >
        {children !== undefined ? (
          children
        ) : (
          <span className="min-w-0 flex-1">
            {label && (
              <span className="block truncate text-[10.5px] font-medium text-fg-muted">{label}</span>
            )}
            <span className="block truncate text-[12.5px] font-medium text-fg-soft">
              {value ?? placeholder}
            </span>
          </span>
        )}
        {chevron && (
          <ChevronDown
            size={13}
            className={cn(
              'shrink-0 text-fg-muted transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        )}
      </button>
    );
  },
);
OpenDropdown.displayName = 'OpenDropdown';

/** Invisible click-catcher so clicking anywhere outside closes the dropdown. */
export function OpenDropdownBackdrop({ onClick }: { onClick: () => void }) {
  return <div className="fixed inset-0 z-20" onClick={onClick} aria-hidden="true" />;
}

/** The dropdown surface, styled like the workspace switcher menu. */
export function OpenDropdownMenu({
  align = 'left',
  side = 'bottom',
  className,
  children,
}: {
  align?: 'left' | 'right';
  side?: 'bottom' | 'top';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="menu"
      className={cn(
        'absolute z-30 flex min-w-[170px] flex-col gap-1 rounded-[14px] border border-border bg-background p-1 shadow-md',
        side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
        align === 'right' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function OpenDropdownItem({
  selected = false,
  onClick,
  className,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-[8px] border-none px-2 py-1.5 text-left text-[12.5px] font-medium transition-colors duration-100',
        selected ? 'bg-surface-hover text-foreground' : 'text-fg-soft hover:bg-surface-hover',
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check size={13} className="shrink-0 text-fg-muted" />}
    </button>
  );
}
