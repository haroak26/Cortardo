import { useEffect, useRef, useState, useMemo } from "react";
import { ShieldCheck, ChevronDown, Loader2, Check, AlertTriangle } from "lucide-react";
import { AiAutoRotateIcon, AiBrowserIcon, AlertCircleIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { EditTree } from "@/components/agent/EditTree";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { PromptInput, type PromptOptions } from "@/components/PromptInput";
import { useUser } from "@/hooks/use-user";
import { QuestionCard } from "@/components/agentblocks/QuestionCard";
import type { CortardoQuestion } from "@shared/schema";
import type { CortardoBaseComponent, EditedComponent } from "@shared/schema";
import type { ComponentBuildState } from "@/hooks/use-cortardo-agent";
import type { CortardoChat, CortardoStatus } from "@/hooks/use-cortardo-agent";

interface CortardoAgentPanelProps {
  status: CortardoStatus;
  reasoningText: string;
  planText: string;
  reasoningMs: number;
  questions: CortardoQuestion[] | null;
  answers: Record<string, string>;
  /** Base components (shadcn preset "b0") selected for the build. */
  components: CortardoBaseComponent[];
  /** Finished component files returned by the parallel edit agents. */
  editedComponents: EditedComponent[];
  /** Live build state per component id (pending → building → done/error). */
  componentBuilds: Record<string, ComponentBuildState>;
  prompt: string;
  loading: boolean;
  systemError: boolean;
  chats: CortardoChat[];
  currentChatId: string | null;
  initialModel?: string | null;
  initialReasoning?: string | null;
  onAnswerChange: (id: string, value: string) => void;
  onSubmit: () => void;
  onPrompt: (prompt: string, options?: PromptOptions) => void;
  onSelectChat: (runId: string) => void;
  onNewChat: () => void;
  onRefreshChats: () => void;
  /** Restore the previous version of the project (undo the last run). */
  onRevert?: () => void;
  /** Whether a previous version exists to revert to. */
  canRevert?: boolean;
}

function useMarkdown(content: string): string {
  return useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(content, { breaks: true, gfm: true }) as string, {
        ALLOWED_TAGS: [
          "a", "b", "i", "em", "strong", "p", "br", "ul", "ol", "li",
          "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
        ],
        ALLOWED_ATTR: ["href", "title", "target", "rel"],
        ALLOW_DATA_ATTR: false,
        FORBID_ATTR: ["style", "onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
      }),
    [content],
  );
}

function ReasoningContent({ content }: { content: string }) {
  const html = useMarkdown(content);
  return (
    <div
      className="mt-1 text-[12px] italic text-fg-muted leading-relaxed prose prose-sm max-w-none [&>p]:my-1 [&>p:last-child]:mb-0 [&>strong]:font-semibold [&>em]:not-italic [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>a]:text-brand [&>a]:underline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function PlanContent({ content }: { content: string }) {
  const html = useMarkdown(content);
  return (
    <div
      className="text-[12.5px] leading-relaxed text-foreground prose prose-sm max-w-none [&>p]:my-1 [&>p:last-child]:mb-0 [&>strong]:font-semibold [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>a]:text-brand [&>a]:underline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** "Base components" stage output — the building blocks being edited live. */
function ComponentsSection({
  components,
  componentBuilds,
}: {
  components: CortardoBaseComponent[];
  componentBuilds: Record<string, ComponentBuildState>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!components.length) return null;
  const building = components.filter((c) => componentBuilds[c.id]?.status === "building").length;
  const done = components.filter((c) => componentBuilds[c.id]?.status === "done").length;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold tracking-wide text-fg-muted uppercase">
          Base components
        </div>
        {building > 0 && (
          <span className="text-[10px] font-medium text-fg-faint tabular-nums">
            {done}/{components.length} built
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {components.map((c) => {
          const build = componentBuilds[c.id];
          const state = build?.status ?? "pending";
          return (
            <button
              key={c.id}
              onClick={() => setExpanded((e) => (e === c.id ? null : c.id))}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] font-medium border transition-colors cursor-pointer border-none ${
                state === "error"
                  ? "text-danger bg-danger/8"
                  : state === "done"
                    ? "text-success bg-success/8"
                    : state === "building"
                      ? "text-brand bg-brand/8"
                      : "text-fg-soft bg-surface-hover border-border/60"
              }`}
            >
              {state === "building" && <Loader2 className="size-2.5 animate-spin" />}
              {state === "done" && <Check className="size-2.5" />}
              {state === "error" && <AlertTriangle className="size-2.5" />}
              {c.name || c.id}
            </button>
          );
        })}
      </div>

      {(building > 0 || expanded) && (
        <div className="flex flex-col gap-1.5">
          {components.map((c) => {
            const build = componentBuilds[c.id];
            const state = build?.status ?? "pending";
            const isOpen = expanded === c.id || state === "building";
            if (!isOpen || !build?.source) return null;
            return (
              <div key={c.id} className="rounded-[8px] border border-border/60 bg-surface-muted overflow-hidden">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] font-semibold text-fg-muted">{c.name}.tsx</span>
                  <span className="text-[9px] font-medium text-fg-faint tabular-nums">
                    {state === "building" ? "building…" : state === "error" ? "failed" : `${build.source.length} chars`}
                  </span>
                </div>
                <pre className="max-h-[160px] overflow-auto px-2 pb-2 text-[9.5px] leading-[1.45] text-fg-soft font-mono whitespace-pre-wrap break-words">
                  {build.source || (state === "building" ? "…" : "No source")}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StatusPill({ status }: { status: CortardoAgentPanelProps["status"] }) {
  if (status === "done") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-success bg-success/10 px-2 py-0.5 rounded-full">
        <ShieldCheck size={9} strokeWidth={2.5} />
        Done
      </span>
    );
  }
  return null;
}

export function AgentPanel({
  status,
  reasoningText,
  planText,
  reasoningMs,
  questions,
  answers,
  components,
  editedComponents,
  componentBuilds,
  prompt,
  loading,
  systemError,
  chats,
  currentChatId,
  initialModel,
  initialReasoning,
  onAnswerChange,
  onSubmit,
  onPrompt,
  onSelectChat,
  onNewChat,
  onRefreshChats,
  onRevert,
  canRevert = false,
}: CortardoAgentPanelProps) {
  const { data: user } = useUser();
  const firstName = (user?.displayName || user?.username || "there").split(/\s+/)[0] || "there";
  const bodyRef = useRef<HTMLDivElement>(null);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [retryHover, setRetryHover] = useState(false);
  const [showEditTree, setShowEditTree] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoningText, planText, status, questions, answers]);

  const isThinking = status === "thinking";
  const idle = status === "idle";

  // Keep the reasoning block open whenever there is reasoning to show
  // (including a restored/completed run loaded from the DB). It auto-opens
  // while the agent is actively thinking and stays open once content exists,
  // so a reload never hides the agent's reasoning behind a collapsed header.
  useEffect(() => {
    setReasoningOpen(isThinking || !!reasoningText);
  }, [isThinking, reasoningText]);

  const activeChat = chats.find((c) => c.id === currentChatId);
  const activeTitle = activeChat?.title || (status === "idle" ? "New chat" : "Cortardo chat");

  // Revert subpanel: replaces the whole panel body with the edit tree. The
  // header stays identical; the revert button becomes the agent icon to go back.
  if (showEditTree) {
    return (
      <div className="h-full flex flex-col relative -mx-1.5">
        <div className="shrink-0 px-3 pt-1 pb-1 flex items-center gap-1.5">
          <button
            onClick={() => {
              if (!chatMenuOpen) onRefreshChats();
              setChatMenuOpen((o) => !o);
            }}
            className="relative min-w-0 flex-1 flex items-center gap-1.5 h-[28px] px-2 rounded-[8px] text-[12px] font-medium text-foreground bg-surface-hover hover:bg-surface-hover/80 transition-colors border-none cursor-pointer"
          >
            <span className="truncate text-left flex-1">{activeTitle}</span>
            <ChevronDown size={13} strokeWidth={2} className="text-fg-muted shrink-0" />
          </button>
          <button
            aria-label="Back to chat"
            onClick={() => setShowEditTree(false)}
            className="flex items-center justify-center h-[28px] w-[28px] shrink-0 rounded-[8px] transition-colors border-none cursor-pointer text-foreground bg-surface-hover hover:bg-surface-hover/80"
          >
            <HugeiconsIcon icon={ AiBrowserIcon } size={14} strokeWidth={1.8}  />
          </button>
          <button
            aria-label="New chat"
            onClick={() => onNewChat()}
            className="flex items-center justify-center h-[28px] w-[28px] shrink-0 rounded-[8px] transition-colors border-none cursor-pointer text-foreground bg-surface-hover hover:bg-surface-hover/80"
          >
            <HugeiconsIcon icon={ PlusSignIcon } size={14} strokeWidth={1.8}  />
          </button>
          <StatusPill status={status} />
        </div>
        <EditTree
          chats={chats}
          currentChatId={currentChatId}
          onBack={() => setShowEditTree(false)}
          onRevertTo={(runId) => {
            setShowEditTree(false);
            if (runId !== currentChatId) onSelectChat(runId);
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative -mx-1.5">
      {/* Header — chat switcher styled like the prompt input (canvas grey,
          no outline) plus revert and new-chat icon buttons on the right. */}
      <div className="shrink-0 px-3 pt-1 pb-1 flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <button
            onClick={() => {
              if (!chatMenuOpen) onRefreshChats();
              setChatMenuOpen((o) => !o);
            }}
            className="w-full flex items-center gap-1.5 h-[28px] px-2 rounded-[8px] text-[12px] font-medium text-foreground bg-surface-hover hover:bg-surface-hover/80 transition-colors border-none cursor-pointer"
          >
            <span className="truncate text-left flex-1">{activeTitle}</span>
            <ChevronDown size={13} strokeWidth={2} className="text-fg-muted shrink-0" />
          </button>
          {/* Chat list — anchored to the closed switcher button and exactly as
              wide as it is, so the menu reads as an extension of it. */}
          {chatMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setChatMenuOpen(false)} />
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 bg-background border border-border rounded-[14px] p-1 flex flex-col gap-0.5 shadow-md max-h-[260px] overflow-y-auto">
                {chats.length === 0 && (
                  <span className="px-2 py-1.5 text-[11px] text-fg-muted">No chats yet</span>
                )}
                {chats.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setChatMenuOpen(false);
                      if (c.id !== currentChatId) onSelectChat(c.id);
                    }}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12px] text-left transition-colors border-none cursor-pointer ${
                      c.id === currentChatId ? "bg-surface-hover text-foreground" : "text-fg-soft hover:bg-surface-hover"
                    }`}
                  >
                    <span className="truncate flex-1">{c.title || c.prompt.slice(0, 40) || "New chat"}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          aria-label="Edit history"
          onClick={() => setShowEditTree(true)}
          className="flex items-center justify-center h-[28px] w-[28px] shrink-0 rounded-[8px] transition-colors border-none cursor-pointer text-foreground bg-surface-hover hover:bg-surface-hover/80"
        >
          <HugeiconsIcon icon={ AiAutoRotateIcon } size={14} strokeWidth={1.8}  />
        </button>
        <button
          aria-label="New chat"
          onClick={() => onNewChat()}
          className="flex items-center justify-center h-[28px] w-[28px] shrink-0 rounded-[8px] transition-colors border-none cursor-pointer text-foreground bg-surface-hover hover:bg-surface-hover/80"
        >
          <HugeiconsIcon icon={ PlusSignIcon } size={14} strokeWidth={1.8}  />
        </button>
        <StatusPill status={status} />
      </div>

      {/* Chat body — empty state: a spacer above pushes the greeting and the
          prompt input to sit slightly above the middle of the panel. Once a
          message is sent the spacer is replaced by the scrolling chat body. */}
      {status === "idle" && (
        <>
          <div className="flex-[0.8]" />
          <div className="shrink-0 px-3 pb-1">
            <p className="text-[15px] font-medium text-foreground leading-snug">
              {firstName},
              <br />
              what would you like to review?
            </p>
          </div>
        </>
      )}

      {/* Chat body (hidden while idle so the input can float mid-panel) */}
      {!idle && (
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-3 pt-5 pb-3 flex flex-col gap-4">
          {/* User prompt — grey bubble, right aligned. On error it shifts left
              to make room for a retry button: a red circled "!" that gains a
              grey hover ring larger than the icon; clicking resends it. The
              pr-2 evens out the icon's gap to the bubble and the panel edge. */}
          {prompt && (
            <div className={`flex justify-end items-center gap-2 ${status === "error" ? "pr-2" : ""}`}>
              <div className="max-w-[85%] rounded-[10px] bg-surface-hover px-3 py-2 text-[12.5px] text-foreground leading-snug">
                {prompt}
              </div>
              {status === "error" && (
                <button
                  aria-label="Send again"
                  onMouseEnter={() => setRetryHover(true)}
                  onMouseLeave={() => setRetryHover(false)}
                  onClick={() => {
                    setRetryHover(false);
                    onPrompt(prompt);
                  }}
                  className={`shrink-0 flex items-center justify-center w-[28px] h-[28px] rounded-full transition-colors cursor-pointer border-none text-danger ${
                    retryHover ? "bg-surface-hover" : "bg-transparent"
                  }`}
                >
                  <HugeiconsIcon icon={ AlertCircleIcon } size={16} strokeWidth={1.8}  />
                </button>
              )}
            </div>
          )}

          {/* AI reasoning — collapsible "Reasoning" block above the plan message */}
          {reasoningText && (
            <div className="flex flex-col">
              <button
                onClick={() => setReasoningOpen((o) => !o)}
                className="flex items-center gap-1.5 self-start text-[11px] font-semibold text-fg-muted hover:text-foreground transition-colors border-none bg-transparent cursor-pointer"
              >
                {isThinking ? (
                  <span>Reasoning</span>
                ) : (
                  reasoningMs > 0 && (
                    <span>Reasoned for {(reasoningMs / 1000).toFixed(1)}s</span>
                  )
                )}
              </button>
              {reasoningOpen && (
                <div className="mt-1">
                  <ReasoningContent content={reasoningText} />
                </div>
              )}
            </div>
          )}

          {/* AI plan message — the "what it will do" output */}
          {planText && <PlanContent content={planText} />}

          {/* Base components selected for the build */}
          <ComponentsSection components={components} componentBuilds={componentBuilds} />

          {status === "questions" && questions && (
            <QuestionCard
              questions={questions}
              answers={answers}
              onAnswerChange={onAnswerChange}
              onSubmit={onSubmit}
              isLoading={loading}
            />
          )}

          {status === "done" && questions && (
            <QuestionCard
              questions={questions}
              answers={answers}
              onAnswerChange={onAnswerChange}
              onSubmit={onSubmit}
              isLoading={loading}
              collapsed
            />
          )}
        </div>
      )}

      {/* Bottom: prompt input. While idle the container grows so the input
          sits half way up the panel with the greeting above it; once a chat
          starts it shrinks back to the bottom. While the agent is working the
          send button is greyed out (disabled) but typing is allowed. */}
      <div className={`${idle ? "flex-1" : "shrink-0"} px-3 pb-3 pt-2`}>
        <PromptInput
          onSubmit={onPrompt}
          placeholder={status === "done" ? "Refine the review…" : "Describe what you want reviewed…"}
          isLoading={isThinking}
          systemError={systemError}
          showFocusPlaceholder={false}
          compact
          initialModel={initialModel}
          initialReasoning={initialReasoning}
        />
      </div>
    </div>
  );
}
