import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Comment01Icon,
  CheckmarkCircle01Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { ChevronLeft, CornerDownRight, Layout, Send } from "lucide-react";

export interface CommentsPanelProps {
  /** "panel" = inside the editor's left sidebar column; "page" = full-screen mobile view. */
  variant: "panel" | "page";
  /** Page variant only: drives the slide in/out transform. The panel variant
      is shown/hidden by its parent, so state survives tab switches. */
  open?: boolean;
  onClose?: () => void;
  /** Formatted labels of ready screens, used to pin comments to a frame. */
  screens?: string[];
  /** The currently selected screen, if any — new comments default to it. */
  focusScreen?: string | null;
}

interface CommentAuthor {
  name: string;
  initials: string;
  color: string;
}

interface CommentReply {
  id: string;
  author: CommentAuthor;
  time: string;
  body: string;
  isYou?: boolean;
}

interface CommentsThread {
  id: string;
  author: CommentAuthor;
  time: string;
  body: string;
  /** Index into the screens pool, resolved at render so real screen names
      appear as soon as a run produces them. */
  screen: number | null;
  resolved?: boolean;
  isYou?: boolean;
  replies: CommentReply[];
}

const YOU: CommentAuthor = { name: "You", initials: "", color: "hsl(var(--brand))" };

type Filter = "all" | "open" | "resolved";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
];

const FALLBACK_SCREENS = ["Home", "Pricing", "Checkout"];

function buildSeedThreads(screens: string[]): CommentsThread[] {
  const list = screens.length > 0 ? screens : FALLBACK_SCREENS;
  const s = (i: number) => i % list.length;
  return [
    {
      id: "seed-1",
      author: { name: "Amara Chen", initials: "AC", color: "#4A7A96" },
      time: "8m",
      screen: s(0),
      body: "Love the new spacing on this screen, it reads much lighter now. One ask: can the headline stack centre and the CTA row go full width below 480px? It's feeling a bit top-heavy on small phones.",
      replies: [
        {
          id: "seed-1-r1",
          author: { name: "Jay Robinson", initials: "JR", color: "#10B981" },
          time: "4m",
          body: "Agreed, I'll adjust the breakpoints in the next pass.",
        },
        {
          id: "seed-1-r2",
          author: { name: "Amara Chen", initials: "AC", color: "#4A7A96" },
          time: "2m",
          body: "Perfect, thank you!",
        },
      ],
    },
    {
      id: "seed-2",
      author: { name: "Daniel Okafor", initials: "DO", color: "#F59E0B" },
      time: "1h",
      screen: s(1),
      body: "The primary button here has no pressed or loading state, so a double click could fire two actions before the response comes back. Worth a quick fix in the component before handoff.",
      replies: [
        {
          id: "seed-2-r1",
          author: { name: "Marcus Bell", initials: "MB", color: "#EC4899" },
          time: "42m",
          body: "Good catch, flagging the same pattern on the checkout screen.",
        },
      ],
    },
    {
      id: "seed-3",
      author: { name: "Priya Nair", initials: "PN", color: "#284B63" },
      time: "5h",
      screen: s(2),
      body: "For launch week we should surface a 'Generate a screen' quick action in this empty state. The metric we care about is first screen created, and right now there's no obvious nudge.",
      replies: [
        {
          id: "seed-3-r1",
          author: { name: "Amara Chen", initials: "AC", color: "#4A7A96" },
          time: "3h",
          body: "On it, reusing the prompt shortcut styles so it stays on brand.",
        },
      ],
    },
    {
      id: "seed-4",
      author: { name: "Jay Robinson", initials: "JR", color: "#10B981" },
      time: "Yesterday",
      screen: s(1),
      body: "Swapped the fallback font stack so the numbers stop shifting width on load. Resolving since the fix is already merged.",
      resolved: true,
      replies: [],
    },
  ];
}

export function CommentsPanel({
  variant,
  open = true,
  onClose,
  screens = [],
  focusScreen,
}: CommentsPanelProps) {
  const isPage = variant === "page";
  const [threads, setThreads] = useState<CommentsThread[]>(() => buildSeedThreads(screens));
  const [filter, setFilter] = useState<Filter>("all");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(100);

  const openCount = threads.filter((t) => !t.resolved).length;
  const resolvedCount = threads.length - openCount;

  const screenPool = screens.length > 0 ? screens : FALLBACK_SCREENS;
  const labelFor = (idx: number | null) => (idx == null ? null : screenPool[idx % screenPool.length]);

  const visibleThreads = threads.filter((t) => {
    if (filter === "open") return !t.resolved;
    if (filter === "resolved") return t.resolved;
    return true;
  });
  const sorted = [...visibleThreads].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return 0;
  });

  const nextId = (prefix: string) => `${prefix}-${++idRef.current}`;

  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const postComment = () => {
    const body = draft.trim();
    if (!body) return;
    const focusIdx =
      focusScreen && screens.includes(focusScreen) ? screens.indexOf(focusScreen) : 0;
    setThreads((prev) => [
      {
        id: nextId("c"),
        author: YOU,
        time: "Just now",
        body,
        screen: focusIdx,
        isYou: true,
        replies: [],
      },
      ...prev,
    ]);
    setDraft("");
    setFilter((f) => (f === "resolved" ? "all" : f));
  };

  const postReply = (threadId: string) => {
    const body = replyDraft.trim();
    if (!body) return;
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              replies: [
                ...t.replies,
                { id: nextId("r"), author: YOU, time: "Just now", body, isYou: true },
              ],
            }
          : t
      )
    );
    setReplyDraft("");
    setReplyingTo(null);
  };

  const toggleResolved = (threadId: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, resolved: !t.resolved } : t))
    );
  };

  const renderAvatar = (author: CommentAuthor, isYou: boolean | undefined, size: "md" | "sm") => {
    const dims = size === "md" ? "w-[22px] h-[22px] text-[8px]" : "w-[18px] h-[18px] text-[7px]";
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-full shrink-0 font-bold text-white select-none",
          dims,
          isYou && "ring-2 ring-brand/25"
        )}
        style={{ background: author.color }}
      >
        {isYou ? (
          <HugeiconsIcon icon={UserCircleIcon} size={size === "md" ? 12 : 10} strokeWidth={2} className="text-white" />
        ) : (
          author.initials
        )}
      </span>
    );
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background",
        isPage
          ? "absolute inset-0 z-40 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]" +
              (open ? " translate-x-0" : " translate-x-full")
          : "h-full min-h-0"
      )}
      aria-hidden={isPage && !open}
    >
      {/* Header */}
      {isPage ? (
        <div className="shrink-0 flex items-center gap-1.5 px-3 h-[51px] border-b border-surface-hover">
          <button
            onClick={onClose}
            aria-label="Back to canvas"
            className="flex items-center justify-center w-8 h-8 rounded-[7px] text-foreground hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer"
          >
            <ChevronLeft size={14} strokeWidth={2} />
          </button>
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={Comment01Icon} size={14} strokeWidth={1.75} className="text-brand" />
            <span className="text-[13px] font-semibold text-foreground">Comments</span>
          </div>
          <span className="ml-auto flex items-center gap-1 h-[18px] px-2 rounded-full bg-surface-hover text-[9.5px] font-semibold text-fg-muted tabular-nums">
            {openCount} open
          </span>
        </div>
      ) : (
        <div className="shrink-0 flex items-center justify-between gap-2 px-2.5 pt-2.5 pb-1.5">
          <span className="text-[11.5px] font-semibold text-foreground">Comments</span>
          <span className="text-[9.5px] font-medium text-fg-faint tabular-nums shrink-0">
            {threads.length} thread{threads.length !== 1 ? "s" : ""} · {openCount} open
          </span>
        </div>
      )}

      {/* Filter */}
      <div className="shrink-0 px-2.5 pb-1.5">
        <div className="flex items-center gap-0.5 p-[2px] rounded-[9px] bg-surface-hover">
          {FILTERS.map((f) => {
            const count =
              f.id === "open" ? openCount : f.id === "resolved" ? resolvedCount : threads.length;
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 h-[24px] rounded-[7px] text-[10px] font-semibold transition-colors border-none bg-transparent cursor-pointer",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-fg-muted hover:text-fg-strong"
                )}
              >
                {f.label}
                {count > 0 && <span className="text-[8.5px] tabular-nums text-fg-faint">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Threads */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pt-1 pb-2 space-y-[2px]">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center">
            <span className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-surface-hover mb-2">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={15} strokeWidth={1.75} className="text-fg-muted" />
            </span>
            <p className="text-[11.5px] font-medium text-fg-muted">
              {filter === "open"
                ? "No open comments"
                : filter === "resolved"
                  ? "No resolved comments"
                  : "No comments yet"}
            </p>
            <p className="text-[9.5px] text-fg-faint mt-0.5">
              {filter === "resolved" ? "Resolved threads will appear here." : "All caught up here."}
            </p>
          </div>
        ) : (
          sorted.map((t) => (
            <div
              key={t.id}
              className={cn(
                "group px-2.5 py-2 rounded-[10px] transition-colors hover:bg-surface-hover/60",
                t.resolved && "opacity-[0.7]"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {renderAvatar(t.author, t.isYou, "md")}
                <p className="text-[11.5px] font-semibold text-foreground truncate min-w-0">
                  {t.isYou ? "You" : t.author.name}
                </p>
                <span className="text-[9px] text-fg-faint shrink-0">· {t.time}</span>
              </div>
              <p
                className={cn(
                  "text-[11.5px] leading-[17px] mt-[3px]",
                  t.resolved ? "text-fg-muted" : "text-foreground/85"
                )}
              >
                {t.body}
              </p>

              <div className="flex items-center gap-1 mt-1.5">
                {t.screen != null && labelFor(t.screen) && (
                  <span className="flex items-center gap-1 h-[18px] px-1.5 rounded-[5px] bg-surface-hover text-[9px] font-medium text-fg-muted max-w-[130px]">
                    <Layout size={9} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{labelFor(t.screen)}</span>
                  </span>
                )}
                {!t.resolved && (
                  <button
                    onClick={() => setReplyingTo(replyingTo === t.id ? null : t.id)}
                    className="flex items-center gap-1 h-[18px] px-1 rounded-[5px] text-[9.5px] font-semibold text-fg-muted hover:text-fg-strong transition-colors border-none bg-transparent cursor-pointer"
                  >
                    <CornerDownRight size={10} strokeWidth={2} />
                    Reply
                  </button>
                )}
                <div className="flex-1" />
                {t.resolved ? (
                  <button
                    onClick={() => toggleResolved(t.id)}
                    title="Reopen thread"
                    className="flex items-center gap-1 h-[18px] px-1.5 rounded-full bg-success/10 text-success text-[9px] font-semibold hover:bg-success/15 transition-colors border-none cursor-pointer"
                  >
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={9} strokeWidth={2} />
                    Resolved
                  </button>
                ) : (
                  <button
                    onClick={() => toggleResolved(t.id)}
                    title="Resolve thread"
                    aria-label="Resolve thread"
                    className="flex items-center justify-center w-[20px] h-[20px] rounded-[6px] text-fg-faint hover:text-success hover:bg-success/10 transition-colors border-none bg-transparent cursor-pointer"
                  >
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} strokeWidth={2} />
                  </button>
                )}
              </div>

              {t.replies.length > 0 && (
                <div className="mt-2 rounded-[8px] bg-surface-muted/70 px-2.5 py-1.5 flex flex-col gap-2.5">
                  {t.replies.map((r) => (
                    <div key={r.id} className="flex gap-1.5 min-w-0">
                      {renderAvatar(r.author, r.isYou, "sm")}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10.5px] font-semibold text-foreground truncate min-w-0">
                            {r.isYou ? "You" : r.author.name}
                          </p>
                          <span className="text-[8.5px] text-fg-faint shrink-0">· {r.time}</span>
                        </div>
                        <p className="text-[11px] leading-[16px] text-fg-soft mt-[1px]">{r.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {replyingTo === t.id && (
                <div className="flex items-center gap-1.5 mt-2">
                  {renderAvatar(YOU, true, "sm")}
                  <div className="flex-1 min-w-0 flex items-center rounded-[8px] border border-transparent bg-surface-hover focus-within:border-brand/60 focus-within:bg-background transition-colors px-1.5">
                    <input
                      autoFocus
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          postReply(t.id);
                        }
                        if (e.key === "Escape") {
                          setReplyDraft("");
                          setReplyingTo(null);
                        }
                      }}
                      placeholder="Add a reply..."
                      className="flex-1 h-[26px] bg-transparent outline-none border-none text-[11px] text-foreground placeholder:text-fg-faint min-w-0"
                    />
                    <button
                      onClick={() => postReply(t.id)}
                      disabled={!replyDraft.trim()}
                      aria-label="Send reply"
                      className="flex items-center justify-center w-[20px] h-[20px] rounded-[6px] bg-brand text-white disabled:opacity-40 disabled:pointer-events-none transition-colors border-none cursor-pointer shrink-0"
                    >
                      <Send size={9} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* New comment composer */}
      <div className="shrink-0 px-2.5 pt-1.5 pb-2">
        <div className="rounded-[12px] bg-surface-hover px-2.5 pt-2 pb-1.5 transition-colors focus-within:bg-background focus-within:ring-1 focus-within:ring-brand/30">
          <textarea
            ref={composerRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                postComment();
                autoGrow(e.currentTarget);
              }
              if (e.key === "Escape") {
                setDraft("");
              }
            }}
            placeholder="Add a comment…"
            className="w-full resize-none bg-transparent outline-none border-none text-[12px] leading-[18px] text-foreground placeholder:text-fg-faint"
          />
          <div className="flex items-center gap-1.5 mt-1">
            {draft.trim() && (
              <span className="text-[9px] text-fg-faint mr-auto hidden sm:block">
                Enter to post · Shift + Enter for a new line
              </span>
            )}
            <button
              onClick={postComment}
              disabled={!draft.trim()}
              aria-label="Post comment"
              className="ml-auto flex items-center justify-center w-[22px] h-[22px] rounded-[7px] bg-brand text-white hover:bg-[hsl(var(--brand-hover))] disabled:opacity-40 disabled:pointer-events-none transition-colors border-none cursor-pointer shrink-0"
            >
              <Send size={10} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
