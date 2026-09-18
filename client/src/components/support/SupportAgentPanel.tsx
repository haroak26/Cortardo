import { useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  AnonymousIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Compass01Icon,
  Cursor01Icon,
  CursorTextIcon,
  GraduationCapIcon,
  HistoryIcon,
  MagicWand01Icon,
  MessageAdd01Icon,
  PanelLeftCloseIcon,
  RefreshIcon,
  Search01Icon,
  Settings02Icon,
  SparklesIcon,
  TaskDone01Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { IconButton } from "@/components/button";
import { PromptInput } from "@/components/PromptInput";
import type { SupportAgentController, SupportAgentItem } from "@/hooks/use-support-agent";
import { SUPPORT_AGENT_LABEL, SUPPORT_CHAT_DEFAULT_TITLE } from "@shared/support";
import { cn } from "@/lib/utils";

type Suggestion = { label: string; prompt: string };

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { label: "Summarise this page", prompt: "Summarise this page for me." },
  { label: "What can I do here?", prompt: "What can I do on this page?" },
];

/** Two tailored suggestions per section; matched by path prefix, first win. */
const PAGE_SUGGESTIONS: { prefix: string; items: Suggestion[] }[] = [
  {
    prefix: "/workspace/home",
    items: [
      { label: "Summarise my workspace", prompt: "Summarise my workspace and what needs attention." },
      { label: "What can I do here?", prompt: "What can I do on this page?" },
    ],
  },
  {
    prefix: "/workspace/analytics",
    items: [
      { label: "Explain these metrics", prompt: "Explain the metrics on this page." },
      { label: "What stands out?", prompt: "What stands out in the analytics on this page?" },
    ],
  },
  {
    prefix: "/workspace/settings",
    items: [
      { label: "Summarise workspace settings", prompt: "Summarise this workspace's settings." },
      { label: "Where is the support code?", prompt: "Where can I find the support code on this page?" },
    ],
  },
  {
    prefix: "/review/repositories/",
    items: [
      { label: "Summarise this repository", prompt: "Summarise this repository and its recent review activity." },
      { label: "How is the bot set up here?", prompt: "How is the bot configured for this repository?" },
    ],
  },
  {
    prefix: "/review/repositories",
    items: [
      { label: "Which repo needs attention?", prompt: "Which repository on this page needs attention first?" },
      { label: "Summarise my repositories", prompt: "Summarise the repositories on this page." },
    ],
  },
  {
    prefix: "/review/security",
    items: [
      { label: "Summarise security status", prompt: "Summarise the security status on this page." },
      { label: "What needs attention?", prompt: "What security items need attention here?" },
    ],
  },
  {
    prefix: "/review/activity",
    items: [
      { label: "Summarise recent activity", prompt: "Summarise the recent activity on this page." },
      { label: "Anything concerning?", prompt: "Is there anything concerning in this activity feed?" },
    ],
  },
  {
    prefix: "/bot/exclusions",
    items: [
      { label: "Add an exclusion", prompt: "Add an exclusion for the build output directory." },
      { label: "Summarise the exclusions", prompt: "Summarise the exclusions on this page." },
    ],
  },
  {
    prefix: "/bot/rules",
    items: [
      { label: "Help me add a rule", prompt: "Help me add a review rule for this workspace." },
      { label: "Summarise the rules", prompt: "Summarise the rules on this page." },
    ],
  },
  {
    prefix: "/bot/learnings",
    items: [
      { label: "Add a learning", prompt: "Add a learning the bot should remember for this workspace." },
      { label: "Summarise the learnings", prompt: "Summarise the learnings on this page." },
    ],
  },
  {
    prefix: "/bot/configuration",
    items: [
      { label: "Explain these settings", prompt: "Explain the bot settings on this page." },
      { label: "What is the autonomy level?", prompt: "What autonomy level is the bot set to, and what does it mean?" },
    ],
  },
  {
    prefix: "/bot/analytics",
    items: [
      { label: "Explain the bot metrics", prompt: "Explain the bot metrics on this page." },
      { label: "How can I reduce cost?", prompt: "How can I reduce the bot's cost based on this page?" },
    ],
  },
  {
    prefix: "/bot/advanced",
    items: [
      { label: "Summarise advanced options", prompt: "Summarise the advanced options on this page." },
      { label: "What should I change here?", prompt: "What should I consider changing on this page?" },
    ],
  },
  {
    prefix: "/bot",
    items: [
      { label: "How is the bot doing?", prompt: "Summarise how the bot is performing." },
      { label: "Summarise this page", prompt: "Summarise this page for me." },
    ],
  },
  {
    prefix: "/team",
    items: [
      { label: "Who is in this workspace?", prompt: "Who is in this workspace?" },
      { label: "Invite a teammate", prompt: "Invite a teammate to this workspace — ask me for their email." },
    ],
  },
  {
    prefix: "/account/security",
    items: [
      { label: "Review my security", prompt: "Review my account security and what I should improve." },
      { label: "How do I enable 2FA?", prompt: "How do I enable two-factor authentication?" },
    ],
  },
  {
    prefix: "/account/authentication",
    items: [
      { label: "Change my password", prompt: "How do I change my password?" },
      { label: "Manage sessions", prompt: "How do I manage and revoke my active sessions?" },
    ],
  },
  {
    prefix: "/account/billing",
    items: [
      { label: "What plan am I on?", prompt: "What plan am I on, and what does it include?" },
      { label: "Explain my billing", prompt: "Explain the billing details on this page." },
    ],
  },
  {
    prefix: "/account/usage",
    items: [
      { label: "Explain my usage", prompt: "Explain my usage on this page." },
      { label: "Am I near a limit?", prompt: "Am I close to any plan limits?" },
    ],
  },
  {
    prefix: "/account/integrations",
    items: [
      { label: "What integrations exist?", prompt: "What integrations are available on this page?" },
      { label: "Is everything connected?", prompt: "Are my integrations fully connected and healthy?" },
    ],
  },
  {
    prefix: "/account/sessions",
    items: [
      { label: "Where am I signed in?", prompt: "Where am I currently signed in?" },
      { label: "Any suspicious sessions?", prompt: "Are there any suspicious sessions on this page?" },
    ],
  },
  {
    prefix: "/account",
    items: [
      { label: "Summarise my account", prompt: "Summarise my account on this page." },
      { label: "What can I do here?", prompt: "What can I do on this page?" },
    ],
  },
];

function suggestionsForPath(path: string): Suggestion[] {
  return PAGE_SUGGESTIONS.find((entry) => path.startsWith(entry.prefix))?.items ?? DEFAULT_SUGGESTIONS;
}

const TOOL_ICONS: Record<string, typeof Search01Icon> = {
  inspect_page: Search01Icon,
  get_page_text: CursorTextIcon,
  click: Cursor01Icon,
  set_field: CursorTextIcon,
  select_option: CheckmarkCircle02Icon,
  navigate: Compass01Icon,
  scroll_to: ArrowRight01Icon,
  highlight: MagicWand01Icon,
  create_exclusion: CheckmarkCircle02Icon,
  create_rule: TaskDone01Icon,
  create_learning: GraduationCapIcon,
  update_bot_settings: Settings02Icon,
  invite_teammate: UserAdd01Icon,
};

const PENDING_LABELS: Record<string, string> = {
  inspect_page: "Reading the page…",
  get_page_text: "Reading the page…",
  click: "Clicking…",
  set_field: "Typing…",
  select_option: "Choosing an option…",
  navigate: "Opening the page…",
  scroll_to: "Scrolling…",
  highlight: "Pointing it out…",
  create_exclusion: "Creating exclusion…",
  create_rule: "Creating rule…",
  create_learning: "Adding learning…",
  update_bot_settings: "Updating settings…",
  invite_teammate: "Sending invite…",
};

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Markdown({ content }: { content: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(content, { breaks: true, gfm: true }) as string),
    [content],
  );
  return (
    <div
      className="agent-markdown text-[13px] leading-[1.65] text-foreground"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function AgentAvatar({ size = 22 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-[hsl(var(--brand)/0.1)] text-[hsl(var(--brand))]"
      style={{ width: size, height: size }}
    >
      <HugeiconsIcon icon={SparklesIcon} size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  );
}

function ActivityRow({ item }: { item: Extract<SupportAgentItem, { role: "activity" }> }) {
  const { observation, pending } = item;
  const icon = TOOL_ICONS[observation.tool] ?? MagicWand01Icon;
  const label = pending ? PENDING_LABELS[observation.tool] ?? "Working…" : observation.summary;
  return (
    <div
      className={cn(
        "flex items-center gap-2 pl-1 text-[12px] leading-snug",
        pending ? "text-fg-faint" : observation.ok ? "text-fg-muted" : "text-[hsl(var(--danger))]",
      )}
    >
      <span
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full",
          pending ? "bg-surface-hover" : observation.ok ? "bg-surface-hover" : "bg-[hsl(var(--danger)/0.1)]",
        )}
      >
        <HugeiconsIcon
          icon={pending ? RefreshIcon : observation.ok ? icon : Alert02Icon}
          size={11}
          strokeWidth={2}
          className={cn(pending && "animate-spin")}
        />
      </span>
      <span className="min-w-0 break-words">{label}</span>
    </div>
  );
}

function MessageRow({ item }: { item: SupportAgentItem }) {
  if (item.role === "activity") return <ActivityRow item={item} />;
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[14px] rounded-br-[4px] bg-surface-hover px-3 py-2 text-[13px] leading-[1.55] text-foreground whitespace-pre-wrap break-words">
          {item.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <AgentAvatar />
      <div className="min-w-0 flex-1 pt-[1px]">
        <Markdown content={item.content} />
      </div>
    </div>
  );
}

function ThinkingRow() {
  return (
    <div className="flex items-center gap-2.5">
      <AgentAvatar />
      <div className="flex gap-1 pl-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-fg-faint animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-fg-faint animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-fg-faint animate-bounce" />
      </div>
    </div>
  );
}

function EmptyState({ suggestions, onPick }: { suggestions: Suggestion[]; onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-1 flex-col justify-end px-1 text-left">
      <p className="text-[15px] font-semibold text-foreground">Hi, I'm your ServiceBot</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">
        Ask anything about this page, or tell me what to do.
      </p>
      <div className="mt-3 flex w-full flex-col gap-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => onPick(suggestion.prompt)}
            className="group flex w-full items-center justify-between gap-2 rounded-[10px] border-none bg-surface-hover px-3 py-2 text-left text-[12.5px] font-medium text-fg-soft transition-colors cursor-pointer hover:bg-surface-hover-strong"
          >
            <span className="truncate">{suggestion.label}</span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={2}
              className="shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export function SupportAgentPanel({
  agent,
  open,
  onClose,
}: {
  agent: SupportAgentController;
  open: boolean;
  onClose: () => void;
}) {
  const { activeChat, activeId, chats, location, view, setView, status, error, send, stop, newChat, openChat, setError } = agent;
  const messages = activeChat?.messages ?? [];
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && view === "chat") endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [open, view, messages, status, error]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const empty = messages.length === 0 && status === "idle";
  const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div
      data-support-agent
      role="complementary"
      aria-label="ServiceBot"
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
    >
      {view === "history" ? (
        <>
          {/* History header */}
          <div className="flex h-[54px] shrink-0 items-center gap-1.5 border-b border-[hsl(var(--surface-hover))] px-2.5">
            <IconButton size="sm" design="ghost" aria-label="Back to chat" onClick={() => setView("chat")}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={2} />
            </IconButton>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight text-foreground">Chats</p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-fg-faint">Your recent conversations</p>
            </div>
            <IconButton size="sm" design="ghost" aria-label="Close ServiceBot" onClick={onClose}>
              <HugeiconsIcon icon={PanelLeftCloseIcon} size={15} strokeWidth={2} />
            </IconButton>
          </div>

          {/* History list */}
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2.5 py-3">
            {sortedChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => openChat(chat.id)}
                className={cn(
                  "w-full shrink-0 rounded-[10px] border-none px-3 py-2.5 text-left transition-colors cursor-pointer",
                  chat.id === activeId ? "bg-surface-hover" : "hover:bg-surface-hover",
                )}
              >
                <p className={cn("truncate text-[12.5px] font-medium", chat.id === activeId ? "text-foreground" : "text-fg-soft")}>
                  {chat.title}
                </p>
                <p className="mt-0.5 text-[11px] text-fg-faint">{relativeTime(chat.updatedAt)}</p>
              </button>
            ))}
          </div>

          {/* New chat footer */}
          <div className="shrink-0 border-t border-[hsl(var(--surface-hover))] p-2.5">
            <button
              type="button"
              onClick={newChat}
              className="flex w-full items-center justify-center gap-2 rounded-[10px] border-none bg-[hsl(var(--brand)/0.08)] px-3 py-2.5 text-[12.5px] font-medium text-[hsl(var(--brand))] transition-colors cursor-pointer hover:bg-[hsl(var(--brand)/0.12)]"
            >
              <HugeiconsIcon icon={MessageAdd01Icon} size={14} strokeWidth={2} />
              New chat
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Chat header */}
          <div className="flex h-[54px] shrink-0 items-center gap-1.5 border-b border-[hsl(var(--surface-hover))] px-2.5">
            <span className="relative ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
              <HugeiconsIcon icon={AnonymousIcon} size={15} strokeWidth={2} />
              <span className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full bg-[hsl(var(--success))] ring-2 ring-background" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight text-foreground">
                {activeChat?.title && activeChat.title !== SUPPORT_CHAT_DEFAULT_TITLE ? activeChat.title : "ServiceBot"}
              </p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-fg-faint">Ask anything, or give me a task</p>
            </div>
            <IconButton size="sm" design="ghost" aria-label="Chat history" onClick={() => setView("history")}>
              <HugeiconsIcon icon={HistoryIcon} size={15} strokeWidth={2} />
            </IconButton>
            <IconButton size="sm" design="ghost" aria-label="Close ServiceBot" onClick={onClose}>
              <HugeiconsIcon icon={PanelLeftCloseIcon} size={15} strokeWidth={2} />
            </IconButton>
          </div>

          {/* Messages */}
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-3.5 pt-4 pb-2">
            {empty ? (
              <EmptyState suggestions={suggestionsForPath(location)} onPick={send} />
            ) : (
              messages.map((item) => <MessageRow key={item.id} item={item} />)
            )}
            {status === "thinking" && !empty && <ThinkingRow />}
            {error && (
              <div className="flex items-start gap-2 rounded-[10px] bg-[hsl(var(--danger)/0.08)] px-3 py-2">
                <HugeiconsIcon icon={Alert02Icon} size={13} strokeWidth={2} className="mt-px shrink-0 text-[hsl(var(--danger))]" />
                <p className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-[hsl(var(--danger))]">{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                  className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-[hsl(var(--danger))]"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
                </button>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Composer */}
          <div className="shrink-0 px-2.5 pb-3 pt-2.5">
            <PromptInput
              variant="pill"
              showControls={false}
              initialModel={SUPPORT_AGENT_LABEL}
              placeholder="Ask Anything..."
              onSubmit={(prompt) => send(prompt)}
              isLoading={status === "thinking"}
              onStop={stop}
            />
            <p className="mt-2 text-center text-[10.5px] text-fg-faint">ServiceBot can make mistakes.</p>
          </div>
        </>
      )}
    </div>
  );
}
