import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GitFork, UserPlus, Sparkles } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TABS, type CanvasTab } from "./CanvasMobileTabBar";

function NavMenu({
  align = "left",
  trigger,
  children,
}: {
  align?: "left" | "right";
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={`absolute z-50 mt-2 ${
            align === "right" ? "right-0" : "left-0"
          } min-w-[200px] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-120px)] overflow-y-auto bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuOption({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft text-left transition-colors border-none cursor-pointer ${
        active ? "bg-surface-hover" : "hover:bg-surface-hover"
      }`}
    >
      {children}
    </button>
  );
}

function MenuDivider() {
  return <div className="h-px bg-[hsl(var(--surface-hover))] mx-1.5 my-0.5" />;
}

function MenuPrimary({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] font-semibold text-white bg-brand hover:bg-[hsl(var(--brand-hover))] transition-colors border-none cursor-pointer"
    >
      {children}
    </button>
  );
}

export function CanvasMobileNavToolbar({
  projectId,
  projectName,
  activeTab,
  onSelectTab,
  onSelectProject,
  onOpenSidebar,
  onInvite,
  onUpgrade,
  onOpenBranch,
  onBackHome,
}: {
  projectId: string;
  projectName: string;
  activeTab: CanvasTab | null;
  onSelectTab: (tab: CanvasTab) => void;
  onSelectProject: (id: string) => void;
  onOpenSidebar: () => void;
  onInvite: () => void;
  onUpgrade: () => void;
  onOpenBranch: () => void;
  onBackHome: () => void;
}) {
  const { data: projects } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/projects"],
    staleTime: 30_000,
  });

  const current = activeTab ? TABS.find((t) => t.id === activeTab) : null;
  const currentIcon = current?.icon ?? TABS[0].icon;

  return (
    <div className="absolute top-[12px] left-[12px] z-30 flex items-center justify-center">
      <div className="flex items-center gap-1 p-1.5 rounded-[14px] bg-background border border-border shadow-lg">
        {/* Project name → workspace dropdown of all the user's projects,
            plus a divider and a Back to home action. */}
        <NavMenu
          trigger={({ toggle, open }) => (
            <button
              onClick={toggle}
              aria-expanded={open}
              aria-label="Switch project"
              className="flex items-center justify-center max-w-[120px] px-2 h-8 rounded-[7px] text-[13px] font-medium text-foreground hover:bg-surface-hover transition-colors border-none cursor-pointer shrink-0"
            >
              <span className="truncate">{projectName}</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
                {(projects ?? []).map((p) => (
                  <MenuOption
                    key={p.id}
                    active={p.id === projectId}
                    onClick={() => {
                      onSelectProject(p.id);
                      close();
                    }}
                  >
                    <span className="truncate">{p.name}</span>
                  </MenuOption>
                ))}
              </div>
              <MenuDivider />
              <MenuOption
                onClick={() => {
                  onBackHome();
                  close();
                }}
              >
                Back to home
              </MenuOption>
            </>
          )}
        </NavMenu>

        <div className="w-px h-4 bg-border/60 shrink-0" />

        {/* Current section → workspace dropdown with the icon-sidebar options,
            plus invite / upgrade / branch below a divider. */}
        <NavMenu
          align="right"
          trigger={({ toggle, open }) => (
            <button
              onClick={toggle}
              aria-expanded={open}
              aria-label="Current section"
              className="flex items-center justify-center w-8 h-8 rounded-[7px] text-foreground hover:bg-surface-hover transition-colors border-none cursor-pointer shrink-0"
            >
              <HugeiconsIcon icon={currentIcon} size={14} strokeWidth={1.75} />
            </button>
          )}
        >
          {(close) => (
            <>
              {TABS.map((t) => (
                <MenuOption
                  key={t.id}
                  active={t.id === activeTab}
                  onClick={() => {
                    onSelectTab(t.id);
                    close();
                  }}
                >
                  <span className="flex items-center justify-center h-[16px] w-[16px] shrink-0">
                    <HugeiconsIcon icon={t.icon} size={14} strokeWidth={1.75} />
                  </span>
                  <span className="whitespace-nowrap">{t.label}</span>
                </MenuOption>
              ))}
              <MenuDivider />
              <MenuOption
                onClick={() => {
                  onInvite();
                  close();
                }}
              >
                <UserPlus size={14} strokeWidth={1.75} />
                Invite
              </MenuOption>
              <MenuOption
                onClick={() => {
                  onOpenBranch();
                  close();
                }}
              >
                <GitFork size={14} strokeWidth={1.75} />
                Branch
              </MenuOption>
              <MenuDivider />
              <MenuPrimary
                onClick={() => {
                  onUpgrade();
                  close();
                }}
              >
                <Sparkles size={14} strokeWidth={1.75} />
                Upgrade
              </MenuPrimary>
            </>
          )}
        </NavMenu>

        <div className="w-px h-4 bg-border/60 shrink-0" />

        {/* Chevron → opens the editor sidebar panel full screen. */}
        <button
          onClick={onOpenSidebar}
          aria-label="Open editor sidebar"
          className="flex items-center justify-center w-8 h-8 rounded-[7px] text-foreground hover:bg-surface-hover transition-colors border-none cursor-pointer shrink-0"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
