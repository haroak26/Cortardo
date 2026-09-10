import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Cursor02Icon,
  MoveIcon,
  Message01Icon,
  ZoomOutAreaIcon,
  ZoomInAreaIcon,
  EyeIcon,
  CodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type CanvasTab } from "@/components/canvas/CanvasMobileTabBar";
import { CanvasMobileNavToolbar } from "@/components/canvas/CanvasMobileNavToolbar";
import { CanvasMobileSidebar } from "@/components/canvas/CanvasMobileSidebar";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { CollabPanel } from "@/components/editor/CollabPanel";
import { CanvasViewport } from "@/components/canvas/CanvasViewport";
import { CommentsPanel } from "@/components/canvas/CommentsPanel";
import { formatScreenLabel } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { CanvasOverflowMenu, CanvasUpgradeSheet } from "@/components/canvas/CanvasOverflowMenu";
import type { UseCortardoAgent } from "@/hooks/use-cortardo-agent";

export function CanvasMobile({
  projectId,
  projectName,
  onRename,
  agent,
  onPrompt,
  branches,
  currentBranch,
  onBranchChange,
  collabWorkspaceId,
  collabMyRoleFallback,
}: {
  projectId: string;
  projectName: string;
  onRename: (name: string) => void;
  agent: UseCortardoAgent;
  onPrompt: (prompt: string, options?: { model?: string; reasoning?: string }) => void;
  branches: string[];
  currentBranch: string;
  onBranchChange: (b: string) => void;
  collabWorkspaceId: string | null;
  collabMyRoleFallback: string | null;
}) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<CanvasTab | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<"select" | "hand">("select");
  const [zoom, setZoom] = useState(1);
  const [previewMode, setPreviewMode] = useState<"preview" | "code">("preview");
  const showPreviewToggle = false;
  // Cortardo canvas doesn't expose a file tree yet; stubs keep the preview/code
  // toggle (carried over from the editor commit) type-safe until wired up.
  const files: Record<string, string> = {};
  const activeFilePath: string | null = null;
  const setActiveDocPath = (_path: string | null) => {};
  const setActiveFilePath = (_path: string | null) => {};

  return (
    <div className="relative h-dvh bg-background flex flex-col overflow-hidden">
      {/* Nav toolbar (top-left): project switcher, section switch, sidebar toggle. */}
      <CanvasMobileNavToolbar
        projectId={projectId}
        projectName={projectName}
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        onSelectProject={(id) => setLocation(`/canvas/${id}`)}
        onOpenSidebar={() => setSidebarOpen(true)}
        onInvite={() => setActiveTab("collab")}
        onUpgrade={() => setUpgradeOpen(true)}
        onOpenBranch={() => setOverflowOpen(true)}
        onBackHome={() => setLocation("/")}
      />

      {/* Canvas surface — always rendered behind the sheets. */}
      <CanvasViewport zoom={zoom} onZoomChange={setZoom} />
      {/* Floating canvas toolbar — the same editor toolbar re-added from the
          editor commit, shrunk for the mobile canvas. */}
      <motion.div
        className="absolute bottom-[calc(14px+env(safe-area-inset-bottom))] left-0 right-0 z-20 flex items-center justify-center px-2"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <div className="flex items-center gap-1 p-1.5 rounded-[14px] bg-background border border-border shadow-lg max-w-[calc(100vw-24px)] overflow-x-auto">
          <div className="flex items-center gap-0.5">
            {([
              { id: "select", icon: Cursor02Icon },
              { id: "hand", icon: MoveIcon },
            ] as const).map((t) => {
              const Icon = t.icon;
              const active = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTool(t.id)}
                  aria-label={t.id}
                  className={cn(
                    "group flex items-center justify-center w-8 h-8 rounded-[7px] text-[12px] font-medium transition-colors border-none cursor-pointer shrink-0",
                    active ? "bg-surface-hover text-fg-strong" : "text-fg-muted hover:bg-surface-hover hover:text-fg-strong"
                  )}
                >
                  <HugeiconsIcon icon={Icon} size={14} strokeWidth={2} className={cn("shrink-0", active ? "text-fg-strong" : "text-fg-muted group-hover:text-fg-strong")} />
                </button>
              );
            })}
          </div>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <button
            onClick={() => setCommentsOpen((o) => !o)}
            aria-label="Comments"
            aria-pressed={commentsOpen}
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-[7px] text-[12px] font-medium transition-colors border-none cursor-pointer shrink-0",
              commentsOpen
                ? "bg-brand/10 text-brand"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg-strong"
            )}
          >
            <HugeiconsIcon icon={ Message01Icon } size={14} strokeWidth={2} className={cn("shrink-0", commentsOpen ? "text-brand" : "text-fg-muted")} />
          </button>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))}
              aria-label="Zoom out"
              className="flex items-center justify-center w-8 h-8 rounded-[7px] text-[12px] font-medium text-fg-muted hover:bg-surface-hover hover:text-fg-strong transition-colors border-none cursor-pointer shrink-0"
            >
              <HugeiconsIcon icon={ ZoomOutAreaIcon } size={14} strokeWidth={2} className="shrink-0"  />
            </button>
            <span className="text-[11px] text-fg-muted font-medium tabular-nums w-[36px] text-center shrink-0">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
              aria-label="Zoom in"
              className="flex items-center justify-center w-8 h-8 rounded-[7px] text-[12px] font-medium text-fg-muted hover:bg-surface-hover hover:text-fg-strong transition-colors border-none cursor-pointer shrink-0"
            >
              <HugeiconsIcon icon={ ZoomInAreaIcon } size={14} strokeWidth={2} className="shrink-0"  />
            </button>
          </div>
          {showPreviewToggle && (
            <>
              <div className="w-px h-4 bg-border/60 shrink-0" />
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setPreviewMode("preview")}
                  className={cn(
                    "group flex items-center justify-center w-8 h-8 rounded-[7px] text-[12px] font-medium transition-colors border-none cursor-pointer shrink-0",
                    previewMode === "preview" ? "bg-surface-hover text-fg-strong" : "text-fg-muted hover:bg-surface-hover hover:text-fg-strong"
                  )}
                >
                  <HugeiconsIcon icon={ EyeIcon } size={14} strokeWidth={2} className={cn("shrink-0", previewMode === "preview" ? "text-fg-strong" : "text-fg-muted group-hover:text-fg-strong")}  />
                </button>
                <button
                  onClick={() => {
                    setPreviewMode("code");
                    setActiveDocPath(null);
                    if (!activeFilePath) {
                      const first = Object.keys(files).sort()[0];
                      if (first) setActiveFilePath(first);
                    }
                  }}
                  className={cn(
                    "group flex items-center justify-center w-8 h-8 rounded-[7px] text-[12px] font-medium transition-colors border-none cursor-pointer shrink-0",
                    previewMode === "code" ? "bg-surface-hover text-fg-strong" : "text-fg-muted hover:bg-surface-hover hover:text-fg-strong"
                  )}
                >
                  <HugeiconsIcon icon={ CodeIcon } size={14} strokeWidth={2} className={cn("shrink-0", previewMode === "code" ? "text-fg-strong" : "text-fg-muted group-hover:text-fg-strong")}  />
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* Full-screen pages — any selected tab (including the agent) fills the
          screen instead of a slide-up panel or bottom sheet. */}
      {activeTab && (
        <div className="absolute inset-0 z-40 bg-background flex flex-col">
          <div className="shrink-0 flex items-center gap-2 px-3 h-[51px] border-b border-surface-hover">
            <button
              onClick={() => setActiveTab(null)}
              aria-label="Back"
              className="flex items-center justify-center w-8 h-8 rounded-[7px] text-foreground hover:bg-surface-hover transition-colors border-none cursor-pointer"
            >
              <ChevronLeft size={14} strokeWidth={2} />
            </button>
            <span className="text-[13px] font-semibold text-foreground capitalize">
              {activeTab === "agent" ? "Cortardo" : activeTab}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {activeTab === "agent" ? (
              <AgentPanel
                status={agent.status}
                reasoningText={agent.reasoningText}
                planText={agent.planText}
                reasoningMs={agent.reasoningMs}
                questions={agent.questions}
                answers={agent.answers}
                components={agent.components}
                editedComponents={agent.editedComponents}
                componentBuilds={agent.componentBuilds}
                prompt={agent.prompt}
                loading={agent.loading}
                systemError={agent.systemError}
                chats={agent.chats}
                currentChatId={agent.currentChatId}
                initialModel={agent.model}
                initialReasoning={agent.reasoning}
                onAnswerChange={agent.setAnswer}
                onSubmit={agent.submitAnswers}
                onPrompt={onPrompt}
                onSelectChat={agent.selectChat}
                onNewChat={agent.newChat}
                onRefreshChats={() => {}}
              />
            ) : activeTab === "info" ? (
              <div className="flex flex-col gap-3 p-4">
                <InfoRow label="Name" value={projectName} />
                <InfoRow label="Branch" value={currentBranch} />
                <InfoRow
                  label="Status"
                  value={agent.status === "idle" ? "Not started" : agent.status}
                />
              </div>
            ) : activeTab === "collab" ? (
              <CollabPanel
                workspaceId={collabWorkspaceId}
                myRoleFallback={collabMyRoleFallback}
                page
              />
            ) : (
              <div className="h-full flex items-center justify-center p-10">
                <p className="text-[12px] text-fg-muted text-center">
                  This page is coming soon in Cortardo.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-screen comments view */}
      <CommentsPanel
        variant="page"
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        screens={agent.screens.filter((s) => s.ready).map((s) => formatScreenLabel(s.name))}
        focusScreen={null}
      />

      <CanvasOverflowMenu
        open={overflowOpen}
        onOpenChange={setOverflowOpen}
        branches={branches}
        currentBranch={currentBranch}
        onBranchChange={onBranchChange}
      />

      <CanvasUpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} />

      {/* Full-screen editor sidebar (opened from the nav toolbar chevron). */}
      {sidebarOpen && (
        <CanvasMobileSidebar
          activeTab={activeTab}
          onSelectTab={(tab) => setActiveTab(tab)}
          onClose={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-[10px] bg-surface-hover px-3 py-2.5">
      <span className="text-[12px] font-medium text-fg-muted">{label}</span>
      <span className="text-[12.5px] font-medium text-foreground truncate max-w-[60%]">{value}</span>
    </div>
  );
}
