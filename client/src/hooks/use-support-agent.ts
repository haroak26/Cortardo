import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  SUPPORT_AGENT_MAX_TURNS,
  SUPPORT_CHAT_DEFAULT_TITLE,
  SUPPORT_CHAT_TITLE_MAX,
  formatPageSnapshot,
  formatSupportObservations,
  parseSupportReply,
  type SupportChatMessage,
  type SupportObservation,
} from "@shared/support";
import { capturePageSnapshot, executeSupportAction } from "@/lib/support-tools";

export type SupportAgentItem =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string }
  | { id: string; role: "activity"; observation: SupportObservation; pending?: boolean };

export type SupportAgentStatus = "idle" | "thinking";
export type SupportAgentView = "chat" | "history";

export interface ServiceBotChat {
  id: string;
  title: string;
  /** True once the AI generated the title (or the AI title request settled). */
  titleAi?: boolean;
  createdAt: number;
  updatedAt: number;
  messages: SupportAgentItem[];
  /** Wire-format history sent to the model. */
  history: SupportChatMessage[];
}

const STORAGE_KEY = "servicebot.chats.v1";
const MAX_CHATS = 30;

function newId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function fallbackTitle(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (!oneLine) return SUPPORT_CHAT_DEFAULT_TITLE;
  return oneLine.length > SUPPORT_CHAT_TITLE_MAX
    ? `${oneLine.slice(0, SUPPORT_CHAT_TITLE_MAX - 1).trimEnd()}…`
    : oneLine;
}

/** Tolerates HTML/empty bodies (stale server, SPA fallback) without throwing. */
async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function createChat(): ServiceBotChat {
  const now = Date.now();
  return {
    id: newId(),
    title: SUPPORT_CHAT_DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
    history: [],
  };
}

/** Keeps the wire history inside the server's message/char ceilings. */
function trimHistory(history: SupportChatMessage[]): SupportChatMessage[] {
  const maxMessages = 48;
  const maxChars = 36_000;
  const result: SupportChatMessage[] = [];
  let chars = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (result.length >= maxMessages) break;
    if (chars + message.content.length > maxChars && result.length > 0) break;
    result.unshift(message);
    chars += message.content.length;
  }
  return result;
}

interface PersistedState {
  chats: ServiceBotChat[];
  activeId: string;
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const chats = Array.isArray(parsed.chats)
        ? parsed.chats
            .filter(
              (chat): chat is ServiceBotChat =>
                Boolean(chat) &&
                typeof chat.id === "string" &&
                Array.isArray(chat.messages) &&
                Array.isArray(chat.history),
            )
            .map((chat) => ({
              ...chat,
              messages: chat.messages.map((item) =>
                item.role === "activity" && item.pending ? { ...item, pending: false } : item,
              ),
            }))
        : [];
      if (chats.length > 0) {
        const activeId = chats.some((chat) => chat.id === parsed.activeId) ? (parsed.activeId as string) : chats[0].id;
        return { chats, activeId };
      }
    }
  } catch {
    /* start fresh */
  }
  const chat = createChat();
  return { chats: [chat], activeId: chat.id };
}

/**
 * ServiceBot controller: a store of conversations (persisted locally), the
 * active chat, and the agent loop (send → model reply → execute browser tools
 * → feed observations back). The server only proxies the model; all page work
 * happens here.
 */
export function useSupportAgent(options: { workspaceId?: string | null } = {}) {
  const [state, setState] = useState<PersistedState>(() => loadState());
  const [view, setView] = useState<SupportAgentView>("chat");
  const [status, setStatus] = useState<SupportAgentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [location, navigate] = useLocation();
  const workspaceIdRef = useRef<string | null>(options.workspaceId ?? null);
  workspaceIdRef.current = options.workspaceId ?? null;
  const stateRef = useRef(state);
  stateRef.current = state;
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or unavailable */
    }
  }, [state]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const activeChat = state.chats.find((chat) => chat.id === state.activeId) ?? state.chats[0];

  const updateChat = useCallback((id: string, updater: (chat: ServiceBotChat) => ServiceBotChat) => {
    setState((prev) => ({ ...prev, chats: prev.chats.map((chat) => (chat.id === id ? updater(chat) : chat)) }));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    setStatus("idle");
  }, []);

  const newChat = useCallback(() => {
    if (busyRef.current) return;
    const chat = createChat();
    setState((prev) => ({
      chats: [chat, ...prev.chats].slice(0, MAX_CHATS),
      activeId: chat.id,
    }));
    setView("chat");
    setError(null);
  }, []);

  const openChat = useCallback((id: string) => {
    if (busyRef.current) return;
    setState((prev) => (prev.chats.some((chat) => chat.id === id) ? { ...prev, activeId: id } : prev));
    setView("chat");
    setError(null);
  }, []);

  const requestTitle = useCallback(async (chatId: string, message: string) => {
    try {
      const response = await fetch("/api/support/title", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { title?: string };
      const title = body.title?.trim();
      if (!title) return;
      updateChat(chatId, (chat) => (chat.titleAi ? chat : { ...chat, title, titleAi: true }));
    } catch {
      /* keep the local fallback title */
    }
  }, [updateChat]);

  const send = useCallback(
    async (input: string) => {
      const text = input.trim();
      if (!text || busyRef.current) return;
      const chatId = stateRef.current.activeId;
      const chat = stateRef.current.chats.find((entry) => entry.id === chatId);
      if (!chat) return;
      const isFirstMessage = chat.history.length === 0;
      /* Local wire history: the loop must not read React state, which has not
         flushed yet when the first request is built. */
      const wire: SupportChatMessage[] = [...chat.history, { role: "user", content: text }];
      busyRef.current = true;
      setError(null);
      setStatus("thinking");

      updateChat(chatId, (entry) => ({
        ...entry,
        updatedAt: Date.now(),
        title: entry.titleAi ? entry.title : fallbackTitle(text),
        messages: [...entry.messages, { id: newId(), role: "user", content: text }],
        history: [...entry.history, { role: "user", content: text }],
      }));

      if (isFirstMessage) void requestTitle(chatId, text);

      /* Read the page ourselves so the model starts with full context instead
         of spending a turn on a blind inspect_page call. */
      const snapshot = capturePageSnapshot();
      wire.push({ role: "user", content: formatPageSnapshot(snapshot) });
      updateChat(chatId, (entry) => ({
        ...entry,
        messages: [
          ...entry.messages,
          {
            id: newId(),
            role: "activity",
            observation: {
              tool: "inspect_page",
              ok: true,
              summary: "Read the page",
            },
          },
        ],
        history: [...entry.history, { role: "user", content: formatPageSnapshot(snapshot) }],
      }));

      const controller = new AbortController();
      abortRef.current = controller;
      let gate: string | undefined = text;

      try {
        for (let turn = 0; turn < SUPPORT_AGENT_MAX_TURNS; turn += 1) {
          const response = await fetch("/api/support/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: trimHistory(wire),
              page: { path: locationRef.current, title: document.title },
              ...(gate ? { gate } : {}),
            }),
            signal: controller.signal,
          });
          gate = undefined;
          if (!response.ok) {
            const body = await readJson<{ message?: string }>(response);
            throw new Error(body?.message || "ServiceBot is unavailable right now.");
          }
          const payload = await readJson<{ text?: string }>(response);
          if (!payload?.text) {
            throw new Error("ServiceBot is unavailable right now. Please try again.");
          }
          const reply = payload.text;
          const parsed = parseSupportReply(reply);
          wire.push({ role: "assistant", content: reply });
          updateChat(chatId, (entry) => ({
            ...entry,
            updatedAt: Date.now(),
            history: [...entry.history, { role: "assistant", content: reply }],
            messages: parsed.message
              ? [...entry.messages, { id: newId(), role: "assistant", content: parsed.message }]
              : entry.messages,
          }));
          if (parsed.actions.length === 0) {
            return;
          }

          const observations: SupportObservation[] = [];
          for (const action of parsed.actions) {
            const itemId = newId();
            updateChat(chatId, (entry) => ({
              ...entry,
              messages: [
                ...entry.messages,
                { id: itemId, role: "activity", pending: true, observation: { tool: action.tool, ok: true, summary: "" } },
              ],
            }));
            const observation = await executeSupportAction(action, {
              navigate,
              workspaceId: workspaceIdRef.current,
            });
            observations.push(observation);
            updateChat(chatId, (entry) => ({
              ...entry,
              messages: entry.messages.map((item) =>
                item.id === itemId && item.role === "activity" ? { ...item, pending: false, observation } : item,
              ),
            }));
          }
          wire.push({ role: "user", content: formatSupportObservations(observations) });
          updateChat(chatId, (entry) => ({
            ...entry,
            history: [...entry.history, { role: "user", content: formatSupportObservations(observations) }],
          }));
        }
        updateChat(chatId, (entry) => ({
          ...entry,
          messages: [
            ...entry.messages,
            {
              id: newId(),
              role: "assistant",
              content:
                "I've done quite a bit but couldn't finish that off. Tell me what to try next and I'll keep going.",
            },
          ],
        }));
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
          setError(message);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          busyRef.current = false;
          setStatus("idle");
        }
      }
    },
    [navigate, requestTitle, updateChat],
  );

  return {
    chats: state.chats,
    activeChat,
    activeId: state.activeId,
    location,
    view,
    setView,
    status,
    error,
    setError,
    send,
    stop,
    newChat,
    openChat,
  };
}

export type SupportAgentController = ReturnType<typeof useSupportAgent>;
