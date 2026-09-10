import { useState, useEffect, useRef, Fragment } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  Layout01Icon,
  BrushIcon,
  Blockchain01Icon,
  UserGroupIcon,
  InformationCircleIcon,
  AiBrowserIcon,
  Cursor02Icon,
  MoveIcon,
  Message01Icon,
  ZoomOutAreaIcon,
  ZoomInAreaIcon,
  EyeIcon,
  CodeIcon,
  Share03Icon,
  GroupLayersIcon,
  Image02Icon,
  File01Icon,
  Rocket01Icon,
  ShapeCollectionIcon,
  OfficeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitFork, Search, Layout, Loader2, AlertTriangle, ChevronDown, Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatScreenLabel } from "@/lib/utils";
import { useCortardoAgent } from "@/hooks/use-cortardo-agent";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { CollabPanel } from "@/components/editor/CollabPanel";
import { useWorkspace } from "@/contexts/workspace-context";
import { EditorLoadingScreen, EDITOR_LOAD_MS } from "@/components/EditorLoadingScreen";
import { MobileEditorLoadingScreen } from "@/components/canvas/MobileEditorLoadingScreen";
import { Button } from "@/components/button";
import { Switch } from "@/components/ui/switch";
import { PLAN_LIMITS, type BillingPeriod } from "@shared/schema";
import { CURRENCIES, type CurrencyCode } from "@/lib/billing";
import { useIsMobile } from "@/hooks/use-mobile";
import { CanvasMobile } from "@/components/canvas/CanvasMobile";

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Hue (0..360) of a #rrggbb hex colour. */
function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return Math.round(h);
}
import { CommentsPanel } from "@/components/canvas/CommentsPanel";

function FontDropdown({
  role,
  value,
  options,
  onChange,
}: {
  role: string;
  value: string;
  options: string[];
  onChange: (font: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-between px-2.5 h-[28px] rounded-[10px] text-[11px] font-[450] text-foreground transition-colors border-none cursor-pointer text-left ${
          open ? "bg-surface-hover" : "bg-transparent hover:bg-surface-hover"
        }`}
      >
        <span className="capitalize">{role}</span>
        <span className="flex items-center gap-1 text-fg-faint">
          {value}
          <ChevronDown
            size={12}
            className={cn("transition-transform duration-300 ease-out", open && "rotate-180")}
          />
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md">
            {options.map((f) => (
              <button
                key={f}
                onClick={() => {
                  onChange(f);
                  setOpen(false);
                }}
                className={`flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-left transition-colors border-none cursor-pointer ${
                  f === value ? "bg-surface-hover text-foreground" : "text-fg-soft hover:bg-surface-hover"
                }`}
              >
                <span className="truncate">{f}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function CanvasPage() {
  const [location] = useLocation();
  const [sidebarTab, setSidebarTab] = useState("screens");
  const [minLoadElapsed, setMinLoadElapsed] = useState(false);
  const [projectName, setProjectName] = useState("Untitled");
  const [editingProjectName, setEditingProjectName] = useState(false);
  const prevProjectName = useRef(projectName);
  const [initialized, setInitialized] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>(["Main"]);
  const [currentBranch, setCurrentBranch] = useState("Main");
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [activeTool, setActiveTool] = useState<"select" | "hand">("select");
  const [zoom, setZoom] = useState(100);
  const [previewMode, setPreviewMode] = useState<"preview" | "code">("preview");
  const showPreviewToggle = false;
  // Cortardo canvas doesn't expose a file tree yet; these stubs keep the
  // preview/code toggle (carried over from the editor commit) type-safe
  // until it is wired up.
  const files: Record<string, string> = {};
  const activeFilePath: string | null = null;
  const setActiveDocPath = (_path: string | null) => {};
  const setActiveFilePath = (_path: string | null) => {};

  // Editor sidebar panels (Screens / Design / Assets) — restored from the
  // editor commits. Default design tokens seed the Design panel until a run
  // produces real artifacts.
  const DEFAULT_FONT_VALUES: Record<string, string> = {
    Heading: "Inter",
    Subheading: "SF Pro",
    Body: "Inter",
  };
  const DEFAULT_SIZE_VALUES: Record<string, string> = {
    H1: "32px",
    H2: "24px",
    H3: "20px",
    Body: "14px",
    Small: "12px",
  };
  const DEFAULT_COLOUR_VALUES: Record<string, string> = {
    Primary: "#284B63",
    Secondary: "#4A7A96",
    Accent: "#F59E0B",
    Background: "#FFFFFF",
    Text: "#1A1A1A",
  };
  const DEFAULT_RADIUS_VALUES: Record<string, string> = {
    Small: "4",
    Medium: "8",
    Large: "12",
    "Extra Large": "20",
  };
  const [assetsTab, setAssetsTab] = useState<"layers" | "components" | "uploads">("layers");
  const [selectedScreen, setSelectedScreen] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [editingSize, setEditingSize] = useState<string | null>(null);
  const [editingRadius, setEditingRadius] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const [titleWidth, setTitleWidth] = useState(48);

  useEffect(() => {
    if (titleRef.current) setTitleWidth(titleRef.current.offsetWidth);
  }, [showSearch]);

  useEffect(() => {
    if (showSearch) {
      searchRef.current?.focus();
    } else {
      searchRef.current?.blur();
    }
  }, [showSearch]);

  // Design tokens — editable local state seeded with defaults, then synced
  // from the run's artifacts when they arrive (mirrors the editor commits'
  // useState + setter pattern).
  const [fontValues, setFontValues] = useState<Record<string, string>>(DEFAULT_FONT_VALUES);
  const [sizeValues, setSizeValues] = useState<Record<string, string>>(DEFAULT_SIZE_VALUES);
  const [colourValues, setColourValues] = useState<Record<string, string>>(DEFAULT_COLOUR_VALUES);
  const [cornerRadiusValues, setCornerRadiusValues] = useState<Record<string, string>>(DEFAULT_RADIUS_VALUES);

  const isMobile = useIsMobile();

  const { activeWorkspaceId, activeWorkspace } = useWorkspace();

  const projectId = location.startsWith("/canvas/") ? location.replace("/canvas/", "").split("/")[0] : null;
  const isNewCanvas = projectId === "new";
  const agentProjectId = projectId && !isNewCanvas ? projectId : null;

  // Loading duration — both the mobile and desktop editor load for 5s. The
  // loading screens animate their bar on a CSS timeline of the same length,
  // so the fill reaches 100% exactly as the editor mounts.
  const { data: projectsList } = useQuery<Array<{ id: string; name: string; kind?: string }>>({
    queryKey: ["/api/projects"],
    staleTime: 30_000,
  });
  const MIN_LOAD_MS = EDITOR_LOAD_MS;

  // Members are workspace-scoped, so resolve the workspace that owns this
  // project (falling back to the active workspace before a project exists).
  const collabWorkspaceId =
    (projectsList?.find((p) => p.id === agentProjectId) as { workspaceId?: string } | undefined)?.workspaceId ??
    activeWorkspaceId ??
    null;
  const collabMyRoleFallback = activeWorkspace?.role ?? null;

  // Branches are persisted per project; "Main" is the fallback until the real
  // list arrives (or for brand-new canvases that have no project yet).
  const { data: dbBranches } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/projects", agentProjectId, "branches"],
    queryFn: async () => {
      if (!agentProjectId) return [];
      const res = await fetch(`/api/projects/${agentProjectId}/branches`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!agentProjectId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!dbBranches || dbBranches.length === 0) return;
    const names = dbBranches.map((b) => b.name);
    setBranches((prev) => (prev.length === names.length && prev.every((n, i) => n === names[i]) ? prev : names));
    setCurrentBranch((prev) => (names.includes(prev) ? prev : names[0]));
  }, [dbBranches]);

  useEffect(() => {
    const timer = setTimeout(() => setMinLoadElapsed(true), MIN_LOAD_MS);
    return () => clearTimeout(timer);
  }, [MIN_LOAD_MS]);

  const agent = useCortardoAgent(agentProjectId);

  // Panel data derived from the Cortardo Agent run's artifacts (screens / design
  // tokens / assets). Falls back to the seeded defaults so the UI is never
  // empty before a run completes.
  const displayScreens = agent.screens;
  const componentFiles = agent.assets.filter((a) => a.kind === "component");
  const uploadFiles = agent.assets.filter((a) => a.kind === "upload");

  // Sync the editable design tokens once real artifacts arrive from a run
  // (one-way: server artifacts seed the local editors, user edits stay local).
  useEffect(() => {
    const tokens = agent.designTokens;
    if (!tokens) return;
    setFontValues((prev) => ({ ...prev, ...tokens.fonts }));
    setSizeValues((prev) => ({ ...prev, ...tokens.sizes }));
    setColourValues((prev) => ({ ...prev, ...tokens.colours }));
    setCornerRadiusValues((prev) => ({ ...prev, ...tokens.radii }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.designTokens]);

  const { data: apiProject } = useQuery<{ id: string; name: string } | null>({
    queryKey: ["/api/projects", projectId],
    queryFn: async () => {
      if (!projectId || isNewCanvas) return null;
      const res = await fetch(`/api/projects`, { credentials: "include" });
      if (!res.ok) return null;
      const projects: Array<{ id: string; name: string }> = await res.json();
      return projects.find((p) => p.id === projectId) || null;
    },
    enabled: !!projectId && !isNewCanvas,
    staleTime: 5 * 60 * 1000,
    placeholderData: () => {
      const list = queryClient.getQueryData<Array<{ id: string; name: string }>>(["/api/projects"]);
      return list?.find((p) => p.id === projectId) ?? undefined;
    },
  });

  useEffect(() => {
    if (apiProject) setProjectName(apiProject.name);
  }, [apiProject, projectId]);

  // Tab title reflects the project once it's loaded (e.g. "Healthy Jaguar - Cortardo").
  useEffect(() => {
    if (agentProjectId && projectName && projectName !== "Untitled") {
      document.title = `${projectName} - Cortardo`;
    } else {
      document.title = "Cortardo — Review. Collaborate. Ship.";
    }
  }, [agentProjectId, projectName]);

  // Prompt handoff from the home page → start the Cortardo Agent run, otherwise restore
  // any existing run so the user's work survives a reload.
  useEffect(() => {
    if (!agentProjectId) return;
    const storedPrompt = sessionStorage.getItem("cortardo-prompt");
    const storedModel = sessionStorage.getItem("cortardo-model") || undefined;
    const storedReasoning = sessionStorage.getItem("cortardo-reasoning") || undefined;
    if (storedPrompt && !initialized) {
      sessionStorage.removeItem("cortardo-prompt");
      sessionStorage.removeItem("cortardo-model");
      sessionStorage.removeItem("cortardo-reasoning");
      setSidebarTab("agent");
      setInitialized(true);
      agent.start(agentProjectId, storedPrompt, { model: storedModel, reasoning: storedReasoning });
    } else if (!initialized) {
      setInitialized(true);
      agent.init(agentProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentProjectId]);

  const handlePanelPrompt = (prompt: string, options?: { model?: string; reasoning?: string }) => {
    if (!agentProjectId) return;
    agent.reset();
    agent.start(agentProjectId, prompt, options);
  };

  const handleCreateBranch = async () => {
    const name = branchName.trim();
    if (!name || !agentProjectId || creatingBranch) return;
    setCreatingBranch(true);
    setBranchError(null);
    try {
      const res = await fetch(`/api/projects/${agentProjectId}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBranchError(data.message || "Failed to create branch");
        return;
      }
      setBranches((prev) => (prev.includes(name) ? prev : [...prev, name]));
      setCurrentBranch(name);
      setCreateBranchOpen(false);
      setBranchName("");
      queryClient.invalidateQueries({ queryKey: ["/api/projects", agentProjectId, "branches"] });
    } catch {
      setBranchError("Something went wrong. Please try again.");
    } finally {
      setCreatingBranch(false);
    }
  };

  if (!minLoadElapsed) {
    return isMobile ? (
      <MobileEditorLoadingScreen />
    ) : (
      <EditorLoadingScreen />
    );
  }

  if (isMobile) {
    return (
      <CanvasMobile
        projectId={projectId ?? ""}
        projectName={projectName}
        onRename={setProjectName}
        agent={agent}
        onPrompt={handlePanelPrompt}
        branches={branches}
        currentBranch={currentBranch}
        onBranchChange={setCurrentBranch}
        collabWorkspaceId={collabWorkspaceId}
        collabMyRoleFallback={collabMyRoleFallback}
      />
    );
  }

  return (
    <div className="h-dvh bg-background flex overflow-hidden">
      {/* Icon sidebar */}
      <div className="w-[64px] shrink-0 flex flex-col bg-background items-center relative z-10 border-r border-surface-hover">
        <div className="h-[51px] w-full flex items-center justify-center border-b border-surface-hover shrink-0">
          <img src="/CortardoSymbol.svg" alt="Cortardo" width={20} height={20} className="h-5 w-auto" />
        </div>
        <div className="flex-1 w-full flex flex-col items-center gap-2 overflow-y-auto pt-2">
          {[
            [
              { id: "screens", icon: Layout01Icon, label: "Screens" },
              { id: "design", icon: BrushIcon, label: "Design" },
              { id: "assets", icon: Blockchain01Icon, label: "Assets" },
            ],
            [
              { id: "collab", icon: UserGroupIcon, label: "Collab" },
              { id: "comments", icon: Message01Icon, label: "Comments" },
              { id: "info", icon: InformationCircleIcon, label: "Info" },
            ],
            [{ id: "agent", icon: AiBrowserIcon, label: "Agent" }],
          ].map((group, gi) => (
            <Fragment key={gi}>
              {gi > 0 && <div className="w-7 h-px bg-[hsl(var(--surface-hover))] rounded-full my-1" />}
              {group.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSidebarTab(tab.id)}
                  className={`relative flex flex-col items-center justify-center gap-[4px] w-full px-1 py-[8px] text-[9.5px] font-semibold leading-none cursor-pointer transition-colors ${
                    sidebarTab === tab.id ? "text-brand" : "text-foreground"
                  }`}
                >
                  <span className="flex items-center justify-center h-[16px] w-[16px] shrink-0">
                    <HugeiconsIcon icon={tab.icon} size={15} strokeWidth={1.75} />
                  </span>
                  <span className="text-center whitespace-nowrap leading-none">{tab.label}</span>
                  {tab.id === "agent" && agent.loading && (
                    <span className="absolute top-[4px] right-[14px] w-[6px] h-[6px] rounded-full bg-brand animate-pulse" />
                  )}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Right side: header + body */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header row */}
        <div className="shrink-0 h-[51px] flex items-center border-b border-surface-hover bg-background pl-[16px] pr-3 gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            {editingProjectName ? (
              <input
                autoFocus
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={() => {
                  if (!projectName.trim()) setProjectName(prevProjectName.current);
                  setEditingProjectName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (!projectName.trim()) setProjectName(prevProjectName.current);
                    setEditingProjectName(false);
                  }
                }}
                className="text-[14px] font-medium text-foreground bg-transparent border-none outline-none w-full p-0 m-0"
              />
            ) : (
              <span
                onClick={() => {
                  prevProjectName.current = projectName;
                  setEditingProjectName(true);
                }}
                className="text-[14px] font-medium text-foreground cursor-pointer hover:text-brand transition-colors truncate max-w-[200px]"
              >
                {projectName}
              </span>
            )}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 shrink-0 ml-3">
            <div className="relative shrink-0">
              <Button design="secondary" size="xs" icon={GitFork} onClick={() => setBranchDropdownOpen(!branchDropdownOpen)}>
                {currentBranch}
              </Button>
              {branchDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBranchDropdownOpen(false)} />
                  <div className="absolute right-0 top-[calc(100%+6px)] z-20 bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md min-w-[150px]">
                    {branches.map((b) => (
                      <button
                        key={b}
                        onClick={() => {
                          setCurrentBranch(b);
                          setBranchDropdownOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-left transition-colors border-none cursor-pointer ${
                          b === currentBranch ? "bg-surface-hover text-foreground" : "text-fg-soft hover:bg-surface-hover"
                        }`}
                      >
                        {b}
                      </button>
                    ))}
                    {agentProjectId && (
                      <>
                        <div className="h-px bg-[hsl(var(--surface-hover))] mx-1.5 my-0.5" />
                        <button
                          onClick={() => {
                            setBranchDropdownOpen(false);
                            setBranchName("");
                            setBranchError(null);
                            setCreateBranchOpen(true);
                          }}
                          className="flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left"
                        >
                          Create branch
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="w-px h-4 bg-border shrink-0" />
            <Button design="secondary" size="xs" onClick={() => setSidebarTab("collab")}>
              Invite
            </Button>
            <Button
              design="primary"
              size="xs"
              className="bg-brand/15 text-brand hover:bg-brand/25 active:bg-brand/30"
              onClick={() => setUpgradeOpen(!upgradeOpen)}
            >
              Upgrade
            </Button>
          </div>
        </div>

        {/* ── Create branch popup ── */}
        {createBranchOpen && (
          <>
            <div className="fixed inset-0 z-50 backdrop-blur-sm bg-background/60" onClick={() => setCreateBranchOpen(false)} />
            <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(380px,92vw)] bg-background border border-border/80 rounded-[20px] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.25)] p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[16px] font-semibold text-foreground tracking-[-0.01em]">Create a new branch</h2>
                  <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
                    Branches let you work on a copy of the project without affecting the main version.
                  </p>
                </div>
              </div>
              <label className="block text-[12px] font-medium text-foreground mt-4 mb-1.5">Branch name</label>
              <input
                autoFocus
                value={branchName}
                onChange={(e) => {
                  setBranchName(e.target.value);
                  setBranchError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && branchName.trim() && !creatingBranch) handleCreateBranch();
                }}
                placeholder="e.g. Feature / Landing"
                className="w-full h-[38px] px-3 rounded-[10px] bg-surface-muted text-[13px] text-foreground border border-border outline-none focus:border-brand/60 transition-colors placeholder:text-fg-faint"
              />
              {branchError && <p className="text-[12px] text-danger mt-2">{branchError}</p>}
              <div className="flex items-center justify-end gap-2 mt-5">
                <button
                  onClick={() => setCreateBranchOpen(false)}
                  className="flex items-center justify-center h-[34px] px-3.5 rounded-[10px] text-[12.5px] font-medium text-fg-muted hover:text-foreground hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateBranch}
                  disabled={!branchName.trim() || creatingBranch}
                  className="flex items-center justify-center gap-1.5 h-[34px] px-4 rounded-[10px] text-[12.5px] font-semibold bg-brand text-white hover:bg-[hsl(var(--brand-hover))] transition-colors border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingBranch && <Loader2 size={13} className="animate-spin" />}
                  Create branch
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Upgrade popup ── */}
        {upgradeOpen && (
          <>
            <div className="fixed inset-0 z-50 backdrop-blur-sm bg-background/60" onClick={() => setUpgradeOpen(false)} />
            <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(860px,92vw)] max-h-[88vh] overflow-y-auto bg-background border border-border/80 rounded-[20px] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.25)]">
              {/* Header area */}
              <div className="text-center pt-5 pb-4 px-8">
                <h2 className="text-[18px] font-semibold text-foreground tracking-[-0.01em]">Choose your plan</h2>
                <p className="text-[13px] text-muted-foreground mt-1">Upgrade to unlock more credits and features</p>
              </div>

              {/* Billing toggle */}
              <div className="flex items-center justify-center gap-3 pb-6">
                <span className={`text-[12.5px] font-medium ${billingPeriod === "monthly" ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
                <Switch checked={billingPeriod === "annual"} onCheckedChange={(v) => setBillingPeriod(v ? "annual" : "monthly")} className="scale-[0.8]" />
                <span className={`text-[12.5px] font-medium ${billingPeriod === "annual" ? "text-foreground" : "text-muted-foreground"}`}>Annual</span>
                <span className="relative inline-flex items-center">
                  <span className={`absolute left-full ml-1 top-1/2 -translate-y-1/2 inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 whitespace-nowrap transition-opacity ${billingPeriod === "annual" ? "opacity-100" : "opacity-0 pointer-events-none"}`}>Save 20%</span>
                </span>
              </div>

              {/* Plan cards */}
              <div className="flex items-stretch px-6 pb-7">
                {([
                  { key: "pro" as const, description: "For getting started.", icon: Rocket01Icon, accent: "#FD7476", features: ["No daily cap", "5000 credits per month", "Export to Figma", "Code export"] },
                  { key: "team" as const, description: "For growing engineering teams.", icon: ShapeCollectionIcon, accent: "#284B63", features: ["No daily cap", "20000 credits per month", "Everything in Solo", "Unlimited repos"] },
                  { key: "enterprise" as const, description: "For large organizations.", icon: OfficeIcon, accent: "#1a1a1a", features: ["No daily cap", "Unlimited credits per month", "Everything in Professional", "SSO", "Unlimited team members"] },
                ]).map(({ key, description, icon: PlanIcon, accent, features }, idx) => {
                  const limits = PLAN_LIMITS[key];
                  const displayPrice = billingPeriod === "annual" ? limits.prices.annual / 12 : limits.prices.monthly;
                  return (
                    <Fragment key={key}>
                      <div className="flex-1 flex flex-col">
                        {/* Card top */}
                        <div className="px-5 pt-5 pb-4">
                          <div className="flex items-start gap-3">
                            <span
                              className="flex items-center justify-center w-[38px] h-[38px] rounded-lg shrink-0"
                              style={{ backgroundColor: `${accent}12`, color: accent }}
                            >
                              <HugeiconsIcon icon={PlanIcon} size={20} strokeWidth={1.75} />
                            </span>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-[14px] font-semibold text-foreground">{limits.label}</h3>
                              <p className="text-[11.5px] text-muted-foreground mt-0.5">{description}</p>
                            </div>
                          </div>

                          {/* Price */}
                          <div className="mt-4 flex items-baseline gap-0.5">
                            <span className="text-[28px] font-semibold leading-none text-foreground">$</span>
                            <span className="text-[28px] font-semibold tracking-[-0.03em] leading-none text-foreground">{displayPrice}</span>
                          </div>
                          <p className="text-[10.5px] text-muted-foreground font-medium mt-1.5">
                            {billingPeriod === "annual" ? `$${limits.prices.annual} Billed annually` : "Billed monthly"}
                          </p>
                        </div>

                        {/* Divider */}
                        <div className="mx-5 h-px bg-border/60" />

                        {/* Features */}
                        <div className="flex-1 px-5 py-4">
                          <ul className="space-y-2.5">
                            {features.map((feature) => (
                              <li key={feature} className="flex items-start gap-2 text-[12px] leading-[18px] text-muted-foreground">
                                <Check className="h-[14px] w-[14px] mt-[1px] shrink-0" style={{ color: accent }} strokeWidth={2.5} />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* CTA */}
                        <div className="px-5 pb-5 pt-1">
                          {key === "enterprise" ? (
                            <div className="flex gap-2">
                              <Button className="flex-1" size="xs" style={{ backgroundColor: accent, color: "#fff" }}>Subscribe</Button>
                              <a href="mailto:sales@cortardo.com" className="flex-1">
                                <Button className="w-full" design="secondary" size="xs">Contact Sales</Button>
                              </a>
                            </div>
                          ) : (
                            <Button
                              className="w-full"
                              size="xs"
                              style={{ backgroundColor: accent, color: "#fff" }}
                            >
                              Subscribe
                            </Button>
                          )}
                        </div>
                      </div>
                      {idx < 2 && <div className="w-px bg-border/60 shrink-0" />}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Body: agent panel + canvas */}
        <div className="flex-1 min-h-0 flex">
          {/* Left content column */}
          <div className="w-[320px] shrink-0 border-r border-surface-hover bg-background flex flex-col min-h-0">
            {/* Comments stay mounted so threads & drafts survive tab switches;
                they are revealed when the Comments rail tab is active. */}
            <div className={cn("min-h-0 flex-1 flex flex-col", sidebarTab === "comments" ? "" : "hidden")}>
              <CommentsPanel
                variant="panel"
                screens={displayScreens.filter((s) => s.ready).map((s) => formatScreenLabel(s.name))}
                focusScreen={selectedScreen ? formatScreenLabel(selectedScreen) : null}
              />
            </div>
            {sidebarTab === "agent" ? (
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
                onPrompt={handlePanelPrompt}
                onSelectChat={(id) => agent.selectChat(id)}
                onNewChat={() => agent.newChat()}
                onRefreshChats={() => agentProjectId && agent.loadChats(agentProjectId)}
              />
            ) : sidebarTab === "collab" ? (
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <CollabPanel
                  workspaceId={collabWorkspaceId}
                  myRoleFallback={collabMyRoleFallback}
                />
              </div>
            ) : sidebarTab !== "comments" ? (
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1.5 py-1 space-y-1">
                {sidebarTab === "screens" ? (
                  <>
                    <div className="px-2.5 pr-0 pt-2 pb-2 flex items-center justify-between">
                      <div className="flex items-center min-w-0">
                        <motion.span
                          initial={false}
                          animate={{ width: showSearch ? 0 : titleWidth, opacity: showSearch ? 0 : 1 }}
                          transition={{
                            width: {
                              duration: showSearch ? 0.18 : 0.28,
                              delay: showSearch ? 0 : 0.06,
                              ease: showSearch ? "easeIn" : "easeOut",
                            },
                            opacity: {
                              duration: showSearch ? 0.1 : 0.22,
                              delay: showSearch ? 0 : 0.12,
                              ease: "easeInOut",
                            },
                          }}
                          className="inline-block overflow-hidden whitespace-nowrap text-[11.5px] font-semibold text-foreground"
                        >
                          <span ref={titleRef}>Screens</span>
                        </motion.span>

                        <motion.div
                          initial={false}
                          animate={{ width: showSearch ? 159 : 0 }}
                          transition={{
                            duration: showSearch ? 0.34 : 0.24,
                            delay: showSearch ? 0.05 : 0,
                            ease: showSearch ? [0.16, 1, 0.3, 1] : [0.5, 0, 0.75, 0.2],
                          }}
                          className="flex items-center gap-1.5 overflow-hidden shrink-0"
                          aria-hidden={!showSearch}
                        >
                          <Search size={13} strokeWidth={1.5} className="text-fg-muted shrink-0" />
                          <input
                            ref={searchRef}
                            tabIndex={showSearch ? 0 : -1}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") { setShowSearch(false); setSearchQuery(""); } }}
                            placeholder="Search screens..."
                            className="w-[140px] text-[11px] font-medium text-foreground bg-transparent border-none outline-none placeholder:text-fg-faint"
                          />
                        </motion.div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setShowSearch((prev) => { if (prev) setSearchQuery(""); return !prev; })}
                          className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] text-foreground hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer"
                        >
                          <Search size={13} strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>

                    {/* Real agent screens */}
                    {agent.status !== "idle" &&
                      displayScreens
                        .filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map((s, i) => (
                          <motion.button
                            key={s.name}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, delay: i * 0.04 }}
                            onClick={() => setSelectedScreen(s.name)}
                            disabled={!s.ready}
                            className={`flex items-center gap-2 w-full h-[28px] px-2.5 rounded-[10px] text-left transition-colors text-foreground box-border border-2 ${
                              selectedScreen === s.name
                                ? "bg-surface-hover font-semibold border-transparent"
                                : "bg-transparent border-transparent font-[450]"
                            } ${s.ready ? "cursor-pointer hover:bg-surface-hover" : "cursor-default opacity-70"}`}
                          >
                            {s.ready ? (
                              <Layout size={12} strokeWidth={1.5} className="shrink-0" />
                            ) : s.failed ? (
                              <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0 text-warning" />
                            ) : (
                              <Loader2 size={12} className="shrink-0 animate-spin text-fg-faint" />
                            )}
                            <span className="text-[11px] truncate">{formatScreenLabel(s.name)}</span>
                            {s.failed && <span className="ml-auto text-[9px] text-warning font-medium">warn</span>}
                          </motion.button>
                        ))}

                    {agent.status !== "idle" && displayScreens.length === 0 && (
                      <div className="px-2.5 py-4 text-center">
                        <Loader2 size={14} className="animate-spin text-fg-faint mx-auto mb-1.5" />
                        <p className="text-[11px] text-fg-muted leading-relaxed">
                          The agent is planning the screens — they'll appear here.
                        </p>
                      </div>
                    )}

                    {agent.status === "idle" && (
                      <div className="px-2.5 py-4 text-center">
                        <p className="text-[11px] text-fg-muted leading-relaxed">
                          No findings yet — the agent hasn't reviewed this change.
                        </p>
                      </div>
                    )}
                  </>
                ) : sidebarTab === "design" ? (
                  <>
                    <div className="px-2.5 pt-1.5 pb-1">
                      <span className="text-[11.5px] font-semibold text-foreground">Fonts</span>
                    </div>
                    <div className="space-y-0.5 pb-1.5">
                      {Object.entries(fontValues).map(([role, value]) => (
                        <FontDropdown
                          key={role}
                          role={role}
                          value={value}
                          options={[...new Set([...Object.values(fontValues), "Inter", "SF Pro", "Roboto", "Playfair Display", "JetBrains Mono", "DM Sans", "Space Grotesk"])]}
                          onChange={(font) => {
                            setFontValues((prev) => ({ ...prev, [role]: font }));
                          }}
                        />
                      ))}
                    </div>

                    <div className="h-px bg-surface-hover -mx-2" />

                    <div className="px-2.5 pt-1.5 pb-1">
                      <span className="text-[11.5px] font-semibold text-foreground">Font sizes</span>
                    </div>
                    <div className="space-y-0.5 pb-1.5">
                      {Object.entries(sizeValues).map(([label, val]) => (
                        <div key={label}>
                          {editingSize === label ? (
                            <div className="flex w-full items-center justify-between px-2.5 h-[28px] rounded-[10px] text-[11px] font-[450] text-foreground">
                              <span className="capitalize">{label}</span>
                              <div className="flex items-center gap-0.5">
                                <input
                                  autoFocus
                                  value={String(val).replace("px", "")}
                                  onChange={(e) => {
                                    setSizeValues((prev) => ({ ...prev, [label]: e.target.value + "px" }));
                                  }}
                                  onBlur={() => setEditingSize(null)}
                                  onKeyDown={(e) => { if (e.key === "Enter") setEditingSize(null); }}
                                  className="w-[40px] text-right text-[11px] font-[450] text-foreground bg-transparent border-none outline-none"
                                />
                                <span className="text-fg-faint text-[11px]">px</span>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingSize(label)}
                              className="flex w-full items-center justify-between px-2.5 h-[28px] rounded-[10px] text-[11px] font-[450] text-foreground hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left"
                            >
                              <span className="capitalize">{label}</span>
                              <span className="text-fg-faint">{val}</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="h-px bg-surface-hover -mx-2" />

                    <div className="px-2.5 pt-1.5 pb-1">
                      <span className="text-[11.5px] font-semibold text-foreground">Colours</span>
                    </div>
                    <div className="space-y-0.5 pb-1.5">
                      {Object.entries(colourValues).map(([id, hex]) => {
                        const safeHex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#888888";
                        return (
                          <div key={id}>
                            <button
                              onClick={() => setSelectedColor(selectedColor === id ? null : id)}
                              className="flex w-full items-center justify-between px-2.5 h-[28px] rounded-[10px] text-[11px] font-[450] text-foreground hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left"
                            >
                              <span className="flex items-center gap-2.5">
                                <div
                                  className="w-[16px] h-[16px] rounded-[4px] border border-border/60 shrink-0"
                                  style={{ backgroundColor: safeHex }}
                                />
                                <span className="capitalize">{id}</span>
                              </span>
                              <span className="text-fg-faint">{hex}</span>
                            </button>
                            {selectedColor === id && (
                              <div className="px-3 pb-2 pt-1.5 space-y-2">
                                <div
                                  className="w-full h-[48px] rounded-[8px] border border-border/60 cursor-pointer"
                                  style={{ background: `linear-gradient(to top, #000000 0%, hsl(${hexToHue(safeHex)} 100% 50%) 100%)` }}
                                  onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const t = Math.min(1, Math.max(0, (rect.bottom - e.clientY) / rect.height));
                                    setColourValues((prev) => ({ ...prev, [id]: hslToHex(hexToHue(safeHex), 100, Math.round(t * 50)) }));
                                  }}
                                />
                                <input
                                  type="range"
                                  min={0}
                                  max={360}
                                  value={hexToHue(safeHex)}
                                  onChange={(e) => {
                                    setColourValues((prev) => ({ ...prev, [id]: hslToHex(Number(e.target.value), 100, 50) }));
                                  }}
                                  className="colour-hue-slider w-full"
                                  aria-label="Hue"
                                />
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-fg-muted font-medium uppercase tracking-wider w-7">Hex</span>
                                  <span className="text-fg-faint text-[12px] font-mono">#</span>
                                  <input
                                    value={safeHex.slice(1)}
                                    onChange={(e) => {
                                      setColourValues((prev) => ({ ...prev, [id]: `#${e.target.value}` }));
                                    }}
                                    className="flex-1 h-[28px] px-2 rounded-[6px] bg-surface-muted text-[12px] font-mono text-foreground border-none outline-none"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="h-px bg-surface-hover -mx-2" />

                    <div className="px-2.5 pt-1.5 pb-1">
                      <span className="text-[11.5px] font-semibold text-foreground">Roundness</span>
                    </div>
                    <div className="space-y-0.5 pb-1.5">
                      {Object.entries(cornerRadiusValues).map(([label, rawVal]) => {
                        const val = parseInt(rawVal) || 0;
                        const r = Math.min(val, 16);
                        return (
                          <div key={label}>
                            {editingRadius === label ? (
                              <div className="flex w-full items-center justify-between px-2.5 h-[28px] rounded-[10px] text-[11px] font-[450] text-foreground">
                                <span className="flex items-center gap-2.5 capitalize">
                                  <svg width="14" height="14" viewBox="0 0 28 28" fill="none" className="shrink-0">
                                    <path d={`M 2 24 L 2 ${2 + r} Q 2 2 ${2 + r} 2 L 24 2`} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" className="text-foreground" />
                                  </svg>
                                  {label}
                                </span>
                                <div className="flex items-center gap-0.5">
                                  <input
                                    autoFocus
                                    value={rawVal}
                                    onChange={(e) => {
                                      setCornerRadiusValues((prev) => ({ ...prev, [label]: e.target.value }));
                                    }}
                                    onBlur={() => setEditingRadius(null)}
                                    onKeyDown={(e) => { if (e.key === "Enter") setEditingRadius(null); }}
                                    className="w-[40px] text-right text-[11px] font-[450] text-foreground bg-transparent border-none outline-none"
                                  />
                                  <span className="text-fg-faint text-[11px]">px</span>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditingRadius(label)}
                                className="flex w-full items-center justify-between px-2.5 h-[28px] rounded-[10px] text-[11px] font-[450] text-foreground hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left"
                              >
                                <span className="flex items-center gap-2.5 capitalize">
                                  <svg width="14" height="14" viewBox="0 0 28 28" fill="none" className="shrink-0">
                                    <path d={`M 2 24 L 2 ${2 + r} Q 2 2 ${2 + r} 2 L 24 2`} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" className="text-foreground" />
                                  </svg>
                                  {label}
                                </span>
                                <span className="text-fg-faint">{rawVal}px</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : sidebarTab === "assets" ? (
                  <>
                    <div className="px-2.5 pt-2 pb-2 flex items-center gap-1.5">
                      {(["layers", "components", "uploads"] as const).map((tab) => (
                        <Button
                          key={tab}
                          design={assetsTab === tab ? "secondary" : "ghost"}
                          size="xs"
                          className="capitalize flex-1 hover:bg-surface-hover focus-visible:ring-0"
                          onClick={() => setAssetsTab(tab)}
                        >
                          {tab}
                        </Button>
                      ))}
                    </div>
                    <div className="h-px bg-surface-hover mx-2" />

                    {assetsTab === "layers" && (
                      <div className="px-2.5">
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                          <HugeiconsIcon icon={ GroupLayersIcon } size={20} strokeWidth={1.5} className="text-fg-muted mb-2" />
                          <p className="text-[11px] text-fg-muted">Layer management coming soon</p>
                        </div>
                      </div>
                    )}

                    {assetsTab === "components" && (
                      <div className="space-y-1.5 px-2.5">
                        {componentFiles.slice(0, 6).map((c, i) => (
                          <div
                            key={c.id}
                            className="group rounded-[10px] border border-border bg-background hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all duration-150 cursor-pointer overflow-hidden"
                            onClick={() => setSelectedScreen(c.label.replace(/\.jsx$/, ""))}
                          >
                            <div className="aspect-[16/8] bg-surface-hover flex items-center justify-center">
                              <div className="w-5 h-5 rounded-[4px] border border-border/40 bg-background flex items-center justify-center">
                                <span className="text-[9px] font-bold text-fg-muted uppercase">{c.label.slice(0, 2)}</span>
                              </div>
                            </div>
                            <div className="h-px bg-surface-hover" />
                            <div className="px-2.5 py-1.5">
                              <p className="text-[12px] font-[450] text-foreground truncate">{c.label.replace(/\.jsx$/, "")}</p>
                              <p className="text-[10px] text-fg-faint mt-0.5">{"Generated component"}</p>
                            </div>
                          </div>
                        ))}
                        {componentFiles.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <HugeiconsIcon icon={ File01Icon } size={20} strokeWidth={1.5} className="text-fg-muted mb-2" />
                            <p className="text-[11px] text-fg-muted">No components yet</p>
                          </div>
                        )}
                      </div>
                    )}

                    {assetsTab === "uploads" && (
                      <div className="space-y-1.5 px-2.5">
                        {uploadFiles.slice(0, 4).map((u, i) => (
                          <div
                            key={u.id}
                            className="group rounded-[10px] border border-border bg-background hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all duration-150 cursor-pointer overflow-hidden"
                          >
                            <div className="aspect-[16/8] bg-surface-hover flex items-center justify-center">
                              <HugeiconsIcon icon={ Image02Icon } size={16} strokeWidth={1.5} className="text-fg-muted" />
                            </div>
                            <div className="h-px bg-surface-hover" />
                            <div className="px-2.5 py-1.5">
                              <p className="text-[12px] font-[450] text-foreground truncate">{u.label}</p>
                              <p className="text-[10px] text-fg-faint mt-0.5">{["2 hours ago", "Yesterday", "3 days ago", "1 week ago"][i % 4]}</p>
                            </div>
                          </div>
                        ))}
                        {uploadFiles.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <HugeiconsIcon icon={ Image02Icon } size={20} strokeWidth={1.5} className="text-fg-muted mb-2" />
                            <p className="text-[11px] text-fg-muted">No uploads yet</p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center px-6 text-center">
                    <p className="text-[12px] text-fg-muted">This panel is coming soon in Cortardo.</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Center canvas */}
          <div className="flex-1 flex flex-col bg-[hsl(var(--surface-hover))] relative">
            <div className="flex-1" />

            {/* Toolbar (bottom of editor) */}
            <motion.div
              className="shrink-0 flex items-center justify-center pb-3 pt-2 relative z-20"
              initial={isNewCanvas ? { opacity: 0, y: 12 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
            >
              <div className="flex items-center gap-1 p-1.5 rounded-[14px] bg-background border border-border/80 shadow-sm">
                <div className="flex items-center gap-1.5">
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
                        className={cn(
                          "group flex items-center justify-center w-[32px] h-[32px] rounded-[8px] text-[12.5px] font-medium transition-colors border-none cursor-pointer shrink-0",
                          active ? "bg-surface-hover text-fg-strong" : "text-fg-muted hover:bg-surface-hover hover:text-fg-strong"
                        )}
                      >
                        <HugeiconsIcon icon={Icon} size={15} strokeWidth={2} className={cn("shrink-0", active ? "text-fg-strong" : "text-fg-muted group-hover:text-fg-strong")} />
                      </button>
                    );
                  })}
                </div>
                <div className="w-px h-[18px] bg-border/60 shrink-0" />
                <button
                  onClick={() => setSidebarTab("comments")}
                  title="Comments"
                  aria-label="Comments"
                  aria-pressed={sidebarTab === "comments"}
                  className={cn(
                    "flex items-center justify-center w-[32px] h-[32px] rounded-[8px] text-[12.5px] font-medium transition-colors border-none cursor-pointer shrink-0",
                    sidebarTab === "comments"
                      ? "bg-brand/10 text-brand"
                      : "text-fg-muted hover:bg-surface-hover hover:text-fg-strong"
                  )}
                >
                  <HugeiconsIcon icon={ Message01Icon } size={15} strokeWidth={2} className={cn("shrink-0", sidebarTab === "comments" ? "text-brand" : "text-fg-muted group-hover:text-fg-strong")} />
                </button>
                <div className="w-px h-[18px] bg-border/60 shrink-0" />
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => setZoom((z) => Math.max(25, z - 10))}
                    className="flex items-center justify-center w-[32px] h-[32px] rounded-[8px] text-[12.5px] font-medium text-fg-muted hover:bg-surface-hover hover:text-fg-strong transition-colors border-none cursor-pointer shrink-0"
                  >
                    <HugeiconsIcon icon={ ZoomOutAreaIcon } size={15} strokeWidth={2} className="shrink-0" />
                  </button>
                  <span className="text-[12px] text-fg-muted font-medium tabular-nums w-[42px] text-center shrink-0">{Math.round(zoom)}%</span>
                  <button
                    onClick={() => setZoom((z) => Math.min(200, z + 10))}
                    className="flex items-center justify-center w-[32px] h-[32px] rounded-[8px] text-[12.5px] font-medium text-fg-muted hover:bg-surface-hover hover:text-fg-strong transition-colors border-none cursor-pointer shrink-0"
                  >
                    <HugeiconsIcon icon={ ZoomInAreaIcon } size={15} strokeWidth={2} className="shrink-0" />
                  </button>
                </div>
                {showPreviewToggle && (
                  <>
                    <div className="w-px h-[18px] bg-border/60 shrink-0" />
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => setPreviewMode("preview")}
                        className={cn(
                          "group flex items-center justify-center w-[32px] h-[32px] rounded-[8px] text-[12.5px] font-medium transition-colors border-none cursor-pointer shrink-0",
                          previewMode === "preview" ? "bg-surface-hover text-fg-strong" : "text-fg-muted hover:bg-surface-hover hover:text-fg-strong"
                        )}
                      >
                        <HugeiconsIcon icon={ EyeIcon } size={15} strokeWidth={2} className={cn("shrink-0", previewMode === "preview" ? "text-fg-strong" : "text-fg-muted group-hover:text-fg-strong")} />
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
                          "group flex items-center justify-center w-[32px] h-[32px] rounded-[8px] text-[12.5px] font-medium transition-colors border-none cursor-pointer shrink-0",
                          previewMode === "code" ? "bg-surface-hover text-fg-strong" : "text-fg-muted hover:bg-surface-hover hover:text-fg-strong"
                        )}
                      >
                        <HugeiconsIcon icon={ CodeIcon } size={15} strokeWidth={2} className={cn("shrink-0", previewMode === "code" ? "text-fg-strong" : "text-fg-muted group-hover:text-fg-strong")} />
                      </button>
                    </div>
                  </>
                )}
                <div className="w-px h-[18px] bg-border/60 shrink-0" />
                <button className="flex items-center justify-center gap-1.5 px-3 h-[32px] rounded-[8px] text-[12.5px] font-semibold bg-brand text-white hover:bg-[hsl(var(--brand-hover))] transition-colors border-none cursor-pointer shrink-0">
                  <HugeiconsIcon icon={ Share03Icon } size={15} strokeWidth={2} className="shrink-0" />
                  Export
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
