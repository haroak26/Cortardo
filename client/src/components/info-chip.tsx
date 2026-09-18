import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const HOVER_DELAY_MS = 250;

/**
 * InfoChip — the small hover hint used on sidebar tabs, icon buttons and
 * other compact controls. A brand-charcoal badge with white text and a
 * rounded downward beak.
 *
 *   <InfoChip>Pause review</InfoChip>
 */
export function InfoChip({
  children,
  className,
  style,
  role,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  role?: string;
}) {
  return (
    <span
      role={role}
      style={style}
      className={cn(
        'inline-flex flex-col items-center drop-shadow-md select-none pointer-events-none',
        className,
      )}
    >
      <span className="relative z-10 whitespace-nowrap rounded-[7px] bg-brand-charcoal px-2 py-[5px] text-[11.5px] font-medium leading-none text-white">
        {children}
      </span>
      <span
        aria-hidden="true"
        className="relative -mt-[4px] h-[7px] w-[7px] rotate-45 rounded-[2px] bg-brand-charcoal"
      />
    </span>
  );
}

/**
 * InfoChipHover — wraps a trigger and reveals the chip above it after a
 * short hover delay. Rendered in a portal so the chip is never clipped by
 * scroll containers and always points at its trigger.
 *
 *   <InfoChipHover label="Settings">
 *     <button …>…</button>
 *   </InfoChipHover>
 */
export function InfoChipHover({
  label,
  children,
  className,
  chipClassName,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  chipClassName?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = () => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPosition({ top: rect.top - 7, left: rect.left + rect.width / 2 });
    }, HOVER_DELAY_MS);
  };

  const hide = () => {
    clearTimer();
    setPosition(null);
  };

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [position]);

  return (
    <span
      ref={anchorRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {position &&
        createPortal(
          <InfoChip
            role="tooltip"
            className={cn('fixed z-[100] -translate-x-1/2 -translate-y-full', chipClassName)}
            style={{ top: position.top, left: position.left }}
          >
            {label}
          </InfoChip>,
          document.body,
        )}
    </span>
  );
}
