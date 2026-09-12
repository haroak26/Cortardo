import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import {
  Home09Icon, MessageMultiple01Icon, Shield01Icon, Blockchain07Icon,
  Book02Icon, GraduationCapIcon, UserGroupIcon, UserAdd01Icon, UserIcon, SmartPhone01Icon,
  CreditCardIcon, Coins01Icon, Chart01Icon, Key01Icon,
  Alert01Icon, ArrowRight01Icon, ArrowLeft01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from "@hugeicons/react";
import { useWorkspace } from '@/contexts/workspace-context';
import { usePlan } from '@/hooks/use-user';

function initials(name: string | null | undefined): string {
  const str = (name || '?').trim();
  const parts = str.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return str[0].toUpperCase();
}

type Tab = {
  id: string;
  label: string;
  icon: typeof Home09Icon;
  href: string | null;
};

const WORKSPACE_TABS: Tab[] = [
  { id: 'home',         label: 'Home',         icon: Home09Icon,            href: '/workspace/home' },
];

const REVIEW_TABS: Tab[] = [
  { id: 'reviews',   label: 'Reviews',   icon: MessageMultiple01Icon, href: '/review/reviews' },
  { id: 'security',  label: 'Security',  icon: Blockchain07Icon,      href: '/review/security' },
];

const BOT_TABS: Tab[] = [
  { id: 'rules',      label: 'Rules',      icon: Book02Icon,    href: '/bot/rules' },
  { id: 'learnings',  label: 'Learnings',  icon: GraduationCapIcon, href: '/bot/learnings' },
];

const TEAM_TABS: Tab[] = [
  { id: 'manage',  label: 'Manage',  icon: UserGroupIcon,   href: '/team/manage' },
  { id: 'invite',  label: 'Invite',  icon: UserAdd01Icon, href: null },
];

const ACCOUNT_NAV: { label: string; tabs: Tab[] }[] = [
  {
    label: 'Account',
    tabs: [
      { id: 'account-profile', label: 'Profile', href: '/account/profile', icon: UserIcon },
      { id: 'account-sessions', label: 'Sessions', href: '/account/sessions', icon: SmartPhone01Icon },
    ],
  },
  {
    label: 'Billing',
    tabs: [
      { id: 'account-billing', label: 'Billing', href: '/account/billing', icon: CreditCardIcon },
      { id: 'account-credits', label: 'Credits', href: '/account/credits', icon: Coins01Icon },
      { id: 'account-usage', label: 'Usage', href: '/account/usage', icon: Chart01Icon },
    ],
  },
  {
    label: 'Security & Auth',
    tabs: [
      { id: 'account-security', label: 'Security', href: '/account/security', icon: Shield01Icon },
      { id: 'account-auth', label: 'Authentication', href: '/account/authentication', icon: Key01Icon },
    ],
  },
  {
    label: 'Danger Zone',
    tabs: [
      { id: 'account-actions', label: 'Danger Zone', href: '/account/actions', icon: Alert01Icon },
    ],
  },
];

function useActiveTab(): string {
  const [location] = useLocation();
  if (location === '/workspace/home') return 'home';
  if (location.startsWith('/review/reviews')) return 'reviews';
  if (location.startsWith('/review/security')) return 'security';
  if (location.startsWith('/bot/rules')) return 'rules';
  if (location.startsWith('/bot/learnings')) return 'learnings';
  if (location.startsWith('/bot')) return 'rules';
  if (location.startsWith('/team')) return 'manage';
  if (location.startsWith('/workspace')) return 'home';
  if (location.startsWith('/account/profile')) return 'account-profile';
  if (location.startsWith('/account/security-auth')) return 'account-security';
  if (location.startsWith('/account/security')) return 'account-security';
  if (location.startsWith('/account/authentication')) return 'account-auth';
  if (location.startsWith('/account/sessions')) return 'account-sessions';
  if (location.startsWith('/account/billing')) return 'account-billing';
  if (location.startsWith('/account/credits')) return 'account-credits';
  if (location.startsWith('/account/usage')) return 'account-usage';
  if (location.startsWith('/account/actions')) return 'account-actions';
  if (location.startsWith('/account')) return 'account-profile';
  return 'home';
}

function NavGroup({ first, children }: { first?: boolean; children: React.ReactNode }) {
  return (
    <div className={first ? undefined : 'mt-3'}>
      {!first && <div className="h-px bg-[hsl(var(--surface-hover))] -mx-2" />}
      <div className="pt-3">
        {children}
      </div>
    </div>
  );
}

function TabRow({ tabs, activeTab, onNavigate, onAction }: { tabs: Tab[]; activeTab: string; onNavigate?: () => void; onAction?: (tabId: string) => void }) {
  return (
    <div className="flex flex-col space-y-1">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        const content = (
          <>
            {Icon && (
              <HugeiconsIcon
                icon={Icon}
                size={16}
                strokeWidth={2}
                className={cn(
                  "shrink-0 transition-colors duration-100",
                  isActive ? "text-fg-strong" : "text-fg-muted group-hover:text-foreground"
                )}
              />
            )}
            <span
              className={cn(
                'truncate leading-snug transition-colors duration-100',
                isActive
                  ? 'font-medium text-fg-strong'
                  : 'font-medium text-fg-muted group-hover:text-foreground'
              )}
            >
              {tab.label}
            </span>
          </>
        );
        const classes = cn(
          'group flex items-center gap-2 h-[32px] px-2.5 rounded-[10px] text-[13px] cursor-pointer select-none transition-colors duration-100',
          isActive ? 'bg-surface-hover' : 'hover:bg-surface-hover'
        );
        if (!tab.href) {
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => { onNavigate?.(); onAction?.(tab.id); }}
              className={cn(classes, 'w-full text-left bg-transparent border-none')}
            >
              {content}
            </button>
          );
        }
        return (
          <Link key={tab.id} href={tab.href} onClick={onNavigate}>
            <div className={classes}>
              {content}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function SidebarContent({ location: _location, onNavigate, collapsed, mobile, onNewWorkspace, onInviteToWorkspace }: { location: string; onNavigate?: () => void; collapsed?: boolean; mobile?: boolean; onNewWorkspace?: () => void; onInviteToWorkspace?: () => void }) {
  const activeTab = useActiveTab();
  const isAccountPage = activeTab.startsWith('account-');
  const { workspaces, activeWorkspace, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const { data: planInfo } = usePlan();
  const [wsOpen, setWsOpen] = useState(false);
  const [wsFlyoutOpen, setWsFlyoutOpen] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const allWsBtnRef = useRef<HTMLButtonElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const flyoutCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelFlyoutClose = () => {
    if (flyoutCloseTimer.current) {
      clearTimeout(flyoutCloseTimer.current);
      flyoutCloseTimer.current = null;
    }
  };

  const scheduleFlyoutClose = () => {
    cancelFlyoutClose();
    flyoutCloseTimer.current = setTimeout(() => setWsFlyoutOpen(false), 180);
  };

  const openWsFlyout = () => {
    const btn = allWsBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setFlyoutPos({ top: rect.top - 4, left: rect.right + 8 });
    setWsFlyoutOpen(true);
  };

  useEffect(() => {
    if (!wsFlyoutOpen || !flyoutPos || !flyoutRef.current || !allWsBtnRef.current) return;
    const width = flyoutRef.current.offsetWidth;
    const vw = window.innerWidth;
    let left = flyoutPos.left;
    if (left + width > vw - 8) {
      const btnRect = allWsBtnRef.current.getBoundingClientRect();
      left = Math.max(8, btnRect.left - width - 8);
    }
    setFlyoutPos((p) => (p && p.left === left ? p : p ? { ...p, left } : p));
  }, [wsFlyoutOpen, flyoutPos]);

  useEffect(() => {
    if (!wsFlyoutOpen) return;
    const close = () => setWsFlyoutOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [wsFlyoutOpen]);

  if (collapsed) return null;

  return (
    <div className="h-full bg-background border-r border-[hsl(var(--surface-hover))] flex flex-col">
      {/* Workspace selector */}
      <div className="relative shrink-0 px-3 pt-3">
        <button
          onClick={() => setWsOpen(!wsOpen)}
          className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 transition-colors border-none cursor-pointer text-left ${
            wsOpen ? 'bg-surface-hover' : 'bg-transparent hover:bg-surface-hover'
          }`}
        >
          <span className="flex items-center justify-center w-7 h-7 rounded-[8px] bg-brand text-white text-[11px] font-bold shrink-0">
            {initials(activeWorkspace?.name)}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold text-foreground truncate">
              {activeWorkspace?.name ?? 'Select workspace'}
            </span>
            <span className="block text-[10.5px] font-medium text-fg-muted truncate">
              {planInfo?.limits.label ?? 'Free'} plan
            </span>
          </span>
          <HugeiconsIcon icon={ ArrowRight01Icon } size={14} className="text-fg-muted shrink-0"  />
        </button>

        {wsOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => { setWsOpen(false); setWsFlyoutOpen(false); }} />
            <div className="absolute left-3 right-3 top-[calc(100%+6px)] z-20 bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md">
              <div
                className="relative"
                onMouseEnter={cancelFlyoutClose}
                onMouseLeave={scheduleFlyoutClose}
              >
                <button
                  ref={allWsBtnRef}
                  onClick={openWsFlyout}
                  onMouseEnter={openWsFlyout}
                  onMouseLeave={scheduleFlyoutClose}
                  className={`flex w-full items-center justify-between px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft transition-colors border-none cursor-pointer text-left ${
                    wsFlyoutOpen ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                  }`}
                >
                  All Workspaces
                  <HugeiconsIcon icon={ ArrowRight01Icon } size={14} className="text-fg-soft shrink-0"  />
                </button>
                {wsFlyoutOpen && flyoutPos && createPortal(
                  <div
                    ref={flyoutRef}
                    onMouseEnter={cancelFlyoutClose}
                    onMouseLeave={scheduleFlyoutClose}
                    className="fixed z-[100] min-w-[170px] bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md"
                    style={{ top: flyoutPos.top, left: flyoutPos.left }}
                  >
                    {workspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => {
                          setActiveWorkspaceId(ws.id);
                          setWsOpen(false);
                          setWsFlyoutOpen(false);
                          onNavigate?.();
                        }}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft text-left transition-colors border-none cursor-pointer ${
                          ws.id === activeWorkspaceId ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                        }`}
                      >
                        <span className="flex-1 min-w-0 truncate">{ws.name}</span>
                      </button>
                    ))}
                    <div className="h-px bg-[hsl(var(--surface-hover))] mx-1.5 my-0.5" />
                    <button
                      onClick={() => {
                        setWsOpen(false);
                        setWsFlyoutOpen(false);
                        onNavigate?.();
                        onNewWorkspace?.();
                      }}
                      className="flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left"
                    >
                      Add Workspace
                    </button>
                  </div>,
                  document.body
                )}
              </div>
              <button
                onClick={() => {
                  setWsOpen(false);
                  onNavigate?.();
                  onInviteToWorkspace?.();
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left"
              >
                Invite to Workspace
              </button>
              <div className="h-px bg-[hsl(var(--surface-hover))] mx-1.5 my-0.5" />
              <button
                onClick={() => {
                  setWsOpen(false);
                  onNavigate?.();
                  onNewWorkspace?.();
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left"
              >
                Add Workspace
              </button>
            </div>
          </>
        )}
      </div>
      <div className="shrink-0 mt-5 h-px bg-[hsl(var(--surface-hover))]" />

      {/* Navigation tabs */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none px-2 pb-3 flex flex-col">
        {isAccountPage ? (
          <div className={cn("flex flex-col", !mobile && "flex-1")}>
            {ACCOUNT_NAV.map((group, i) => (
              <NavGroup key={group.label} first={i === 0}>
                <TabRow tabs={group.tabs} activeTab={activeTab} onNavigate={onNavigate} />
              </NavGroup>
            ))}
            {!mobile && (
              <>
                <div className="flex-1" />
                <div className="mt-3">
                  <div className="h-px bg-[hsl(var(--surface-hover))] -mx-2" />
                  <div className="pt-3">
                    <Link href="/workspace/home" onClick={onNavigate}>
                    <div className="group flex items-center gap-2 h-[32px] px-2.5 rounded-[10px] text-[13px] font-medium text-fg-muted cursor-pointer select-none transition-colors duration-100 hover:bg-surface-hover hover:text-foreground">
                      <HugeiconsIcon icon={ ArrowLeft01Icon } size={14} strokeWidth={2} className="shrink-0"  />
                        <span className="leading-snug">Back to home</span>
                      </div>
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div>
            <NavGroup first>
              <TabRow tabs={WORKSPACE_TABS} activeTab={activeTab} onNavigate={onNavigate} />
            </NavGroup>
            <NavGroup>
              <TabRow tabs={REVIEW_TABS} activeTab={activeTab} onNavigate={onNavigate} />
            </NavGroup>
            <NavGroup>
              <TabRow tabs={BOT_TABS} activeTab={activeTab} onNavigate={onNavigate} />
            </NavGroup>
            <NavGroup>
              <TabRow tabs={TEAM_TABS} activeTab={activeTab} onNavigate={onNavigate} onAction={() => onInviteToWorkspace?.()} />
            </NavGroup>
          </div>
        )}
      </div>
    </div>
  );
}
