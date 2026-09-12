import React, { Suspense, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Loading01Icon, ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from "@hugeicons/react";
import { SidebarContent } from '@/components/Sidebar';
import { CreateWorkspacePopup } from '@/components/CreateWorkspacePopup';
import { InviteWorkspacePopup } from '@/components/InviteWorkspacePopup';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspace } from '@/contexts/workspace-context';
import { useUser, useCredits } from '@/hooks/use-user';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/button';

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const str = name || email || '?';
  const parts = str.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return str[0].toUpperCase();
}


const SIDEBAR_W = 240;

/** Lightweight fallback shown inside the app shell while a lazy page chunk loads. */
function MainContentFallback() {
  return (
    <div className="flex-1 flex items-center justify-center" aria-busy="true" aria-label="Loading">
      <div className="w-4 h-4 border-2 border-border border-t-foreground/60 rounded-full animate-spin" />
    </div>
  );
}

export function AppLayout({
  children,
  subNav,
}: {
  children: React.ReactNode;
  subNav?: React.ReactNode;
}) {
  const [locationPath] = useLocation();
  const { data: user, isLoading: userLoading } = useUser();
  const { data: credits, isLoading: creditsLoading } = useCredits();
  const isAccountPage = locationPath.startsWith('/account');
  const { switchingWorkspace, switchingWsPhase, switchingWsName, activeWorkspaceId } = useWorkspace();
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [inviteWorkspaceOpen, setInviteWorkspaceOpen] = useState(false);

  useEffect(() => {
    document.title = 'Cortardo — Review. Collaborate. Ship.';
  }, []);

  return (
      <div className="lds-app-shell h-dvh bg-background flex flex-col overflow-hidden overscroll-none">
        {/* ── Body: sidebar + main ── */}
        <div className="flex-1 min-h-0 flex mobile-body-row">
          {/* Sidebar — desktop only */}
          {!isMobile && (
            <aside className="h-full shrink-0" style={{ width: SIDEBAR_W, minWidth: SIDEBAR_W }}>
              <SidebarContent location={locationPath} onNewWorkspace={() => setCreateWorkspaceOpen(true)} onInviteToWorkspace={() => setInviteWorkspaceOpen(true)} />
            </aside>
          )}

          {/* Main content */}
          <div className="flex-1 min-h-0 flex flex-col">
            {isAccountPage ? (
              isMobile && (
                <div className="shrink-0 flex items-center h-[48px] px-5">
                  <button
                    onClick={() => setMobileSidebarOpen(true)}
                    className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-foreground hover:bg-surface-hover transition-colors border-none cursor-pointer"
                    aria-label="Open menu"
                  >
                    <div className="relative w-4 h-[10px] flex flex-col justify-between">
                      <span className="block w-4 h-[2px] bg-current rounded-full" />
                      <span className="block w-4 h-[2px] bg-current rounded-full" />
                    </div>
                  </button>
                </div>
              )
            ) : (
            <div className="shrink-0 flex items-center justify-between h-[48px] px-5">
                <div className="flex items-center gap-2">
                  {isMobile && (
                    <button
                      onClick={() => setMobileSidebarOpen(true)}
                      className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-foreground hover:bg-surface-hover transition-colors border-none cursor-pointer"
                      aria-label="Open menu"
                    >
                      <div className="relative w-4 h-[10px] flex flex-col justify-between">
                        <span className="block w-4 h-[2px] bg-current rounded-full" />
                        <span className="block w-4 h-[2px] bg-current rounded-full" />
                      </div>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {creditsLoading ? (
                    <Skeleton className="h-4 w-28" />
                  ) : credits ? (
                    <Link href="/account/credits" className="text-[14px] font-medium text-fg-muted hover:text-foreground transition-colors no-underline tabular-nums">
                      {credits.balance % 1 === 0 ? credits.balance : credits.balance.toFixed(2)} Credits Remaining
                    </Link>
                  ) : null}
                  <div className="w-px h-4 bg-[hsl(var(--surface-hover))]" />
                  <Link href="/account/profile" aria-label="Account settings">
                    {userLoading ? (
                      <Skeleton className="w-[28px] h-[28px] rounded-full" />
                    ) : user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="w-[28px] h-[28px] rounded-full object-cover hover:opacity-80 transition-opacity cursor-pointer" />
                    ) : (
                      <div className="w-[28px] h-[28px] rounded-full bg-brand flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer">
                        <span className="text-[11px] font-bold text-white">
                          {initials(user?.displayName, user?.email)}
                        </span>
                      </div>
                    )}
                  </Link>
                </div>
              </div>
            )}
            {subNav && (
              <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
                {subNav}
              </div>
            )}
            <main className="flex-1 min-w-0 min-h-0 md:overflow-hidden flex flex-col page-enter">
              <Suspense fallback={<MainContentFallback />}>
                {children}
              </Suspense>
            </main>
          </div>
        </div>

      {switchingWorkspace && (
        <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center gap-4">
              <HugeiconsIcon icon={ Loading01Icon } className="h-6 w-6 animate-spin text-foreground"  />
          <div className="text-center">
            {switchingWsPhase === 'logging-out' && (
              <>
                <p className="text-[16px] font-semibold text-foreground">Logging out of {switchingWsName}...</p>
                <p className="text-[12px] text-fg-muted font-medium mt-1.5">Closing your current workspace session</p>
              </>
            )}
            {switchingWsPhase === 'signing-in' && (
              <>
                <p className="text-[16px] font-semibold text-foreground">Signing into {switchingWsName}...</p>
                <p className="text-[12px] text-fg-muted font-medium mt-1.5">Authenticating your workspace connection</p>
              </>
            )}
          </div>
        </div>
      )}
      {/* Mobile sidebar overlay */}
      {isMobile && mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-transparent backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative h-full w-[240px] animate-slide-in-left bg-background flex flex-col">
            <div className="flex-1 min-h-0 overflow-hidden">
              <SidebarContent location={locationPath} mobile onNavigate={() => setMobileSidebarOpen(false)} onNewWorkspace={() => { setMobileSidebarOpen(false); setCreateWorkspaceOpen(true); }} onInviteToWorkspace={() => { setMobileSidebarOpen(false); setInviteWorkspaceOpen(true); }} />
            </div>
            <div className="shrink-0 h-px bg-[hsl(var(--surface-hover))]" />
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="shrink-0 flex items-center gap-[8px] h-[44px] w-full px-[11px] text-[14px] font-medium text-foreground hover:bg-surface-hover transition-colors cursor-pointer border-none"
            >
              <HugeiconsIcon icon={ ArrowLeft01Icon } size={16} strokeWidth={2} className="text-foreground shrink-0"  />
              Close sidebar
            </button>
          </div>
        </div>
      )}

      <CreateWorkspacePopup open={createWorkspaceOpen} onClose={() => setCreateWorkspaceOpen(false)} />
      <InviteWorkspacePopup open={inviteWorkspaceOpen} onClose={() => setInviteWorkspaceOpen(false)} workspaceId={activeWorkspaceId} />
      </div>
  );
}
