import { useCallback, useEffect, useRef, useState } from "react";
import type { CortardoAssetFile, CortardoBaseComponent, CortardoDesignTokens, CortardoQuestion, CortardoScreen, EditedComponent } from "@shared/schema";

export type CortardoStatus = "idle" | "thinking" | "questions" | "done" | "error";

/** Live status of a base component being rewritten by a parallel edit agent. */
export type ComponentBuildState = {
  status: "pending" | "building" | "done" | "error";
  source: string;
  error?: string;
};

export interface CortardoChat {
  id: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
  /** Estimated credit cost of the run (checkpoint cost in the edit tree). */
  credits?: number;
}

export interface UseCortardoAgent {
  status: CortardoStatus;
  reasoningText: string;
  planText: string;
  reasoningMs: number;
  questions: CortardoQuestion[] | null;
  answers: Record<string, string>;
  screens: CortardoScreen[];
  designTokens: CortardoDesignTokens | null;
  assets: CortardoAssetFile[];
  components: CortardoBaseComponent[];
  /** Finished component files returned by the parallel edit agents. */
  editedComponents: EditedComponent[];
  /** Live build state per component id (pending → building → done/error). */
  componentBuilds: Record<string, ComponentBuildState>;
  runId: string | null;
  prompt: string;
  model: string | null;
  reasoning: string | null;
  loading: boolean;
  systemError: boolean;
  chats: CortardoChat[];
  currentChatId: string | null;
  start: (projectId: string, prompt: string, options?: { model?: string; reasoning?: string }) => void;
  setAnswer: (id: string, value: string) => void;
  submitAnswers: () => void;
  reset: () => void;
  init: (projectId: string) => Promise<void>;
  loadChats: (projectId: string) => Promise<void>;
  selectChat: (runId: string) => Promise<void>;
  newChat: () => void;
}

export function useCortardoAgent(projectId: string | null): UseCortardoAgent {
  const [status, setStatus] = useState<CortardoStatus>("idle");
  const [reasoningText, setReasoningText] = useState("");
  const [planText, setPlanText] = useState("");
  const [reasoningMs, setReasoningMs] = useState(0);
  const [questions, setQuestions] = useState<CortardoQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [screens, setScreens] = useState<CortardoScreen[]>([]);
  const [designTokens, setDesignTokens] = useState<CortardoDesignTokens | null>(null);
  const [assets, setAssets] = useState<CortardoAssetFile[]>([]);
  const [components, setComponents] = useState<CortardoBaseComponent[]>([]);
  const [editedComponents, setEditedComponents] = useState<EditedComponent[]>([]);
  const [componentBuilds, setComponentBuilds] = useState<Record<string, ComponentBuildState>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [systemError, setSystemError] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [chats, setChats] = useState<CortardoChat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const startedRef = useRef(false);
  const reasoningStartRef = useRef<number | null>(null);
  const settledRef = useRef(false);
  const chatsRef = useRef<CortardoChat[]>([]);
  chatsRef.current = chats;

  const closeStream = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    closeStream();
    startedRef.current = false;
    reasoningStartRef.current = null;
    settledRef.current = false;
    setStatus("idle");
    setReasoningText("");
    setPlanText("");
    setReasoningMs(0);
    setQuestions(null);
    setAnswers({});
    setScreens([]);
    setDesignTokens(null);
    setAssets([]);
    setComponents([]);
    setEditedComponents([]);
    setComponentBuilds({});
    setRunId(null);
    setSystemError(false);
    setPrompt("");
  }, [closeStream]);

  const loadChats = useCallback(async (pid: string) => {
    if (!pid) return;
    try {
      const res = await fetch(`/api/cortardo-agent/runs/list?projectId=${encodeURIComponent(pid)}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const list = (await res.json()) as CortardoChat[];
      setChats(list || []);
    } catch {
      /* ignore */
    }
  }, []);

  const selectChat = useCallback(
    async (cid: string) => {
      try {
        const res = await fetch(`/api/cortardo-agent/runs/${cid}`, { credentials: "include" });
        if (!res.ok) return;
        const run = await res.json();
        closeStream();
        startedRef.current = false;
        settledRef.current = false;
        reasoningStartRef.current = null;
        setCurrentChatId(run.id);
        setRunId(run.id);
        setPrompt(run.prompt || "");
        setQuestions(run.questions ?? null);
        setAnswers(run.answers ?? {});
        setReasoningText(run.reasoning ?? "");
        setPlanText(run.plan ?? "");
        setReasoningMs(run.reasoningMs ?? 0);
        setScreens(run.screens ?? []);
        setDesignTokens(run.designTokens ?? null);
        setAssets(run.assets ?? []);
        setComponents(run.components ?? []);
        setEditedComponents(run.editedComponents ?? []);
        setComponentBuilds(
          Object.fromEntries(
            ((run.components as CortardoBaseComponent[] | undefined) ?? []).map((c) => [
              c.id,
              { status: "done", source: ((run.editedComponents as EditedComponent[] | undefined) ?? []).find((e) => e.id === c.id)?.source ?? "" },
            ]),
          ),
        );
        setSystemError(false);
        setStatus(run.status === "answered" ? "done" : run.questions ? "questions" : "idle");
      } catch {
        /* ignore */
      }
    },
    [closeStream],
  );

  const start = useCallback(
    async (pid: string, promptText: string, options?: { model?: string; reasoning?: string }) => {
      if (startedRef.current) return;
      startedRef.current = true;
      setPrompt(promptText);
      setStatus("thinking");
      setReasoningText("");
      setPlanText("");
      setReasoningMs(0);
      setQuestions(null);
      setAnswers({});
      setSystemError(false);
      setEditedComponents([]);
      setComponentBuilds({});
      reasoningStartRef.current = null;
      settledRef.current = false;
      if (options?.model) setModel(options.model);
    if (options?.reasoning) setReasoning(options.reasoning);

    try {
      const res = await fetch("/api/cortardo-agent/runs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: pid, prompt: promptText, model: options?.model, reasoning: options?.reasoning }),
        });
        if (!res.ok) throw new Error("Failed to start Cortardo Agent run");
        const { runId: rid, isFirst } = await res.json();
        setRunId(rid);
        setCurrentChatId(rid);
        // Optimistically add the chat to the switcher.
        setChats((prev) => {
          if (prev.some((c) => c.id === rid)) return prev;
          return [...prev, { id: rid, title: isFirst ? "Initial Build" : "New chat", prompt: promptText, status: "thinking", createdAt: new Date().toISOString() }];
        });

        const params = new URLSearchParams();
        if (options?.model) params.set("model", options.model);
        if (options?.reasoning) params.set("reasoning", options.reasoning);
        const qs = params.toString();
        const source = new EventSource(`/api/cortardo-agent/runs/${rid}/events${qs ? `?${qs}` : ""}`);
        sourceRef.current = source;

        source.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data) as {
              type: string;
              text?: string;
              questions?: CortardoQuestion[];
              screens?: CortardoScreen[];
              designTokens?: CortardoDesignTokens;
              assets?: CortardoAssetFile[];
              components?: CortardoBaseComponent[];
              component?: EditedComponent;
              componentId?: string;
              status?: string;
              delta?: string;
              source?: string;
              message?: string;
            };
            if (data.type === "reasoning" && typeof data.text === "string") {
              if (reasoningStartRef.current === null) reasoningStartRef.current = Date.now();
              setReasoningText((prev) => prev + data.text);
            } else if (data.type === "plan" && typeof data.text === "string") {
              if (reasoningStartRef.current !== null) {
                setReasoningMs(Date.now() - reasoningStartRef.current);
              }
              setPlanText(data.text);
            } else if (data.type === "artifacts") {
              if (Array.isArray(data.screens)) setScreens(data.screens);
              if (data.designTokens) setDesignTokens(data.designTokens);
              if (Array.isArray(data.assets)) setAssets(data.assets);
            } else if (data.type === "components" && Array.isArray(data.components)) {
              setComponents(data.components);
              setComponentBuilds(
                Object.fromEntries(data.components.map((c) => [c.id, { status: "pending", source: "" }])),
              );
            } else if (data.type === "componentEdit" && typeof data.componentId === "string") {
              const id = data.componentId;
              if (data.status === "start") {
                setComponentBuilds((prev) => ({ ...prev, [id]: { status: "building", source: prev[id]?.source ?? "" } }));
              } else if (data.status === "delta" && typeof data.delta === "string") {
                setComponentBuilds((prev) => ({
                  ...prev,
                  [id]: { status: "building", source: (prev[id]?.source ?? "") + data.delta },
                }));
              } else if (data.status === "done") {
                setComponentBuilds((prev) => ({
                  ...prev,
                  [id]: { status: "done", source: data.source ?? prev[id]?.source ?? "" },
                }));
              } else if (data.status === "error") {
                setComponentBuilds((prev) => ({
                  ...prev,
                  [id]: { status: "error", source: prev[id]?.source ?? "", error: data.message },
                }));
              }
            } else if (data.type === "componentEdited" && data.component) {
              setEditedComponents((prev) => {
                const rest = prev.filter((c) => c.id !== data.component!.id);
                return [...rest, data.component!];
              });
              setComponentBuilds((prev) => ({
                ...prev,
                [data.component!.id]: { status: "done", source: data.component!.source },
              }));
            } else if (data.type === "questions" && Array.isArray(data.questions)) {
              settledRef.current = true;
              setQuestions(data.questions);
              setStatus("questions");
            } else if (data.type === "done") {
              settledRef.current = true;
              setStatus((s) => (s === "questions" ? s : "done"));
              source.close();
              loadChats(pid);
            } else if (data.type === "error") {
              settledRef.current = true;
              setSystemError(true);
              setStatus("error");
              source.close();
            }
          } catch {}
        };

        source.onerror = () => {
          source.close();
          if (!settledRef.current) {
            setSystemError(true);
            setStatus("error");
          }
        };
      } catch (err) {
        console.error("[cortardo-agent] start error:", err);
        setSystemError(true);
        setStatus("error");
        startedRef.current = false;
      }
    },
    [status, loadChats],
  );

  const setAnswer = useCallback((id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  // Debounced autosave of in-progress answers so a reload never loses work.
  useEffect(() => {
    if (!runId || !questions || status !== "questions") return;
    const t = setTimeout(() => {
      fetch(`/api/cortardo-agent/runs/${runId}/answers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, final: false }),
      }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [answers, runId, questions, status]);

  const submitAnswers = useCallback(() => {
    if (!runId || !questions) return;
    const payload: Record<string, string> = {};
    for (const q of questions) payload[q.id] = answers[q.id] ?? "";
    setStatus("done");
    fetch(`/api/cortardo-agent/runs/${runId}/answers`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: payload, final: true }),
    }).catch(() => {});
  }, [runId, questions, answers]);

  // Begin a fresh chat (no run yet) so the user can type a new prompt.
  const newChat = useCallback(() => {
    closeStream();
    startedRef.current = false;
    reasoningStartRef.current = null;
    settledRef.current = false;
    setCurrentChatId(null);
    setRunId(null);
    setStatus("idle");
    setReasoningText("");
    setPlanText("");
    setReasoningMs(0);
    setQuestions(null);
    setAnswers({});
    setScreens([]);
    setDesignTokens(null);
    setAssets([]);
    setComponents([]);
    setEditedComponents([]);
    setComponentBuilds({});
    setSystemError(false);
    setPrompt("");
  }, [closeStream]);

  // Restore the most recent run for a project, if one exists.
  const init = useCallback(
    async (pid: string) => {
      if (startedRef.current) return;
      await loadChats(pid);
      const list = chatsRef.current;
      if (list.length > 0) {
        const latest = list[list.length - 1];
        await selectChat(latest.id);
      }
    },
    [loadChats, selectChat],
  );

  useEffect(() => () => closeStream(), [closeStream]);

  return {
    status,
    reasoningText,
    planText,
    reasoningMs,
    questions,
    answers,
    screens,
    designTokens,
    assets,
    components,
    editedComponents,
    componentBuilds,
    runId,
    prompt,
    model,
    reasoning,
    loading: status === "thinking",
    systemError,
    chats,
    currentChatId,
    start,
    setAnswer,
    submitAnswers,
    reset,
    init,
    loadChats,
    selectChat,
    newChat,
  };
}
