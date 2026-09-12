import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { PrimarySection, HugeIconData } from './types';
import {
  UserGroupIcon, Settings01Icon, UserIcon,
  CreditCardIcon, GridIcon, Logout01Icon, InboxIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useUser, useLogout } from '@/hooks/use-user';
import { useWorkspace } from '@/contexts/workspace-context';

export const ALL_SECTIONS: PrimarySection[] = [
  { id: 'design',    label: 'Design',    icon: GridIcon,      href: '/canvas/new' },
  { id: 'projects',  label: 'Projects',  icon: InboxIcon,     href: '/home/projects' },
  { id: 'team',      label: 'Team',      icon: UserGroupIcon, href: '/workspace/team' },
  { id: 'settings',  label: 'Settings',  icon: Settings01Icon,href: '/workspace/settings' },
];

export const ADMIN_SECTIONS: PrimarySection[] = [];

const ICON_SIZE = 15;

export function getActivePrimaryId(location: string): string {
  if (location.startsWith('/canvas/')) return 'design';
  if (location.startsWith('/home/projects')) return 'projects';
  if (location.startsWith('/workspace/team')) return 'team';
  if (location.startsWith('/workspace')) return 'settings';
  if (location.startsWith('/account')) return 'account';
  return 'design';
}

function TabIcon({ isActive, icon }: { isActive: boolean; icon: HugeIconData }) {
  return (
    <div className={cn(
      'group flex items-center justify-center h-[32px] w-[32px] rounded-[10px] transition-all cursor-pointer',
      isActive
        ? 'bg-[hsl(var(--surface-active))] border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
        : 'hover:bg-[hsl(var(--surface-active))] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
    )}>
      <HugeiconsIcon
        icon={icon}
        size={ICON_SIZE}
        strokeWidth={isActive ? 2 : 1.5}
        className={cn(
          "transition-colors duration-100",
          isActive ? "text-foreground" : "text-fg-subtle group-hover:text-foreground"
        )}
      />
    </div>
  );
}

export function PrimaryRail({
  activeId,
  isAdmin,
}: {
  activeId: string;
  isAdmin: boolean;
}) {
  const [location] = useLocation();
  const { data: user } = useUser();
  const logout = useLogout();
  const { activeWorkspace } = useWorkspace();
  const currentActive = activeId || getActivePrimaryId(location);
  const [, navigate] = useLocation();


  const primarySections = [...ALL_SECTIONS, ...(isAdmin ? ADMIN_SECTIONS : [])];
  const sections = primarySections;
  const lowerSections: PrimarySection[] = [];

  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [accountMenuPos, setAccountMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const [tooltipLabel, setTooltipLabel] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout>>();

  const showTooltip = (label: string, e: React.MouseEvent) => {
    clearTimeout(tooltipTimeout.current);
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ top: rect.top + rect.height / 2 - 14, left: rect.right + 8 });
    setTooltipLabel(label);
  };

  const hideTooltip = () => {
    tooltipTimeout.current = setTimeout(() => {
      setTooltipLabel(null);
      setTooltipPos(null);
    }, 80);
  };

  useEffect(() => {
    if (!accountDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (accountDropdownOpen && accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [accountDropdownOpen]);

  const handleAccountClick = () => {
    if (accountRef.current) {
      const r = accountRef.current.getBoundingClientRect();
      setAccountMenuPos({ bottom: r.top - 8, left: r.left + r.width });
    }
    setAccountDropdownOpen(prev => !prev);
  };

  return (
    <div className="w-[52px] h-full min-h-0 bg-background border-r border-[hsl(var(--surface-hover))] flex flex-col items-center pt-3 pb-3 shrink-0 overflow-x-hidden overscroll-none">
      <Link href="/canvas/new" className="mb-4 shrink-0 flex items-center justify-center w-[32px] h-[32px]">
        <img src="/CortardoSymbol.svg?v=1" alt="Cortardo" width={32} className="w-8 h-auto shrink-0" />
      </Link>

      <div className="flex-1 min-h-0 flex flex-col items-center gap-1 w-full px-2 overflow-y-auto scrollbar-none">
        {sections.map((section) => (
          <Link key={section.id} href={section.href}>
            <div onMouseEnter={(e) => showTooltip(section.label, e)} onMouseLeave={hideTooltip}>
              <TabIcon isActive={currentActive === section.id} icon={section.icon} />
            </div>
          </Link>
        ))}
        
      </div>

      {/* Lower utility navigation + Account — always at bottom */}
      <div className="shrink-0 flex flex-col items-center gap-1 w-full px-2 mt-auto pb-2 bg-background">
        {lowerSections.map((section) => (
          <Link key={section.id} href={section.href}>
            <div onMouseEnter={(e) => showTooltip(section.label, e)} onMouseLeave={hideTooltip}>
              <TabIcon isActive={currentActive === section.id} icon={section.icon} />
            </div>
          </Link>
        ))}
        <div className="w-full px-3">
          <div className="h-px bg-[hsl(var(--surface-hover))]" />
        </div>
        <div ref={accountRef} onClick={handleAccountClick} onMouseEnter={(e) => showTooltip('Account', e)} onMouseLeave={hideTooltip}>
          <TabIcon isActive={currentActive === 'account'} icon={UserIcon} />
        </div>
      </div>

      {/* Custom tooltip */}
      {tooltipLabel && tooltipPos && createPortal(
        <div
          className="fixed z-[9999] px-2.5 py-1.5 rounded-lg bg-foreground text-background text-[11px] font-semibold whitespace-nowrap shadow-lg pointer-events-none"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          {tooltipLabel}
        </div>,
        document.body
      )}

      {accountDropdownOpen && accountMenuPos && createPortal(
        <div
          className="fixed z-50"
          style={{ bottom: window.innerHeight - accountMenuPos.bottom, left: accountMenuPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-[190px] bg-background border border-border rounded-[12px] p-1.5 shadow-xl animate-in fade-in duration-150">
            <Link
              href="/account/profile"
              onClick={() => { setAccountDropdownOpen(false); }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-[13px] font-semibold text-fg-muted hover:text-foreground hover:bg-[hsl(var(--surface-hover)/0.6)] transition-all duration-100 ease-out"
            >
              <HugeiconsIcon icon={ UserIcon } size={16}  />
              Profile
            </Link>
            <Link
              href="/account/billing"
              onClick={() => { setAccountDropdownOpen(false); }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-[13px] font-semibold text-fg-muted hover:text-foreground hover:bg-[hsl(var(--surface-hover)/0.6)] transition-all duration-100 ease-out"
            >
              <HugeiconsIcon icon={ CreditCardIcon } size={16}  />
              Billing
            </Link>
            <Link
              href="/workspace/settings"
              onClick={() => { setAccountDropdownOpen(false); }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-[13px] font-semibold text-fg-muted hover:text-foreground hover:bg-[hsl(var(--surface-hover)/0.6)] transition-all duration-100 ease-out"
            >
              <HugeiconsIcon icon={ GridIcon } size={16}  />
              Workspace
            </Link>
            <Link
              href="/account"
              onClick={() => { setAccountDropdownOpen(false); }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-[13px] font-semibold text-fg-muted hover:text-foreground hover:bg-[hsl(var(--surface-hover)/0.6)] transition-all duration-100 ease-out"
            >
              <HugeiconsIcon icon={ Settings01Icon } size={16}  />
              Account
            </Link>
            <div className="my-1 mx-1 h-px bg-[hsl(var(--surface-hover))]" />
            <button
              onClick={() => { setAccountDropdownOpen(false); logout.mutate(); }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[10px] text-[13px] font-semibold text-fg-muted hover:text-danger hover:bg-danger/5 transition-all duration-100 ease-out border-none bg-transparent cursor-pointer"
            >
              <HugeiconsIcon icon={ Logout01Icon } size={16}  />
              Sign out
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
