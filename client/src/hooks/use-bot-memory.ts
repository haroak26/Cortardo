import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BOT_SETTINGS_DEFAULTS,
  COMMIT_REVIEW_DEFAULTS,
  PULL_REQUEST_REVIEW_DEFAULTS,
  type BotAutonomyLevel,
  type BotSettingsPayload,
  type BotWorkspaceConfig,
  type CommitReviewSettings,
  type PullRequestReviewSettings,
} from "@shared/bot";

export { BOT_SETTINGS_DEFAULTS, COMMIT_REVIEW_DEFAULTS, PULL_REQUEST_REVIEW_DEFAULTS };
export type { BotAutonomyLevel, BotSettingsPayload, BotWorkspaceConfig, CommitReviewSettings, PullRequestReviewSettings };

export interface ApiBotSettings extends BotSettingsPayload {}

export interface ApiRule {
  id: string;
  workspaceId: string;
  repositoryId: string | null;
  glob: string | null;
  instruction: string;
  scope: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiLearning {
  id: string;
  workspaceId: string;
  repositoryId: string | null;
  text: string;
  scope: string;
  source: "feedback" | "rule" | "manual";
  accepted: number;
  rejected: number;
  findingKey: string | null;
  path: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiExclusion {
  id: string;
  workspaceId: string;
  repositoryId: string | null;
  scope: string;
  pattern: string;
  note: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiFinding {
  id: string;
  runId: string;
  repositoryId: string | null;
  findingKey: string;
  path: string | null;
  line: number | null;
  category: string | null;
  severity: string | null;
  verdict: string | null;
  confidence: number;
  title: string;
  detail: string;
  status: "open" | "fixed" | "dismissed" | "stale";
  createdAt: string;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

function scopedQuery(workspaceId: string | null, repositoryId?: string | null): string {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  if (repositoryId) params.set("repositoryId", repositoryId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useBotRules(workspaceId: string | null, repositoryId?: string | null) {
  return useQuery<ApiRule[]>({
    queryKey: ["/api/bot/rules", workspaceId ?? "", repositoryId ?? ""],
    queryFn: () => getJson(`/api/bot/rules${scopedQuery(workspaceId, repositoryId)}`),
    enabled: !!workspaceId,
  });
}

export function useCreateRule(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { instruction: string; glob?: string | null; repositoryId?: string | null }) =>
      sendJson<ApiRule>("POST", "/api/bot/rules", {
        workspaceId,
        instruction: input.instruction,
        glob: input.glob ?? null,
        repositoryId: input.repositoryId ?? null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/rules"] }),
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      instruction?: string;
      glob?: string | null;
      repositoryId?: string | null;
      enabled?: boolean;
    }) => sendJson<ApiRule>("PATCH", `/api/bot/rules/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/rules"] }),
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<{ ok: boolean }>("DELETE", `/api/bot/rules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/rules"] }),
  });
}

export function useBotLearnings(workspaceId: string | null, repositoryId?: string | null) {
  return useQuery<ApiLearning[]>({
    queryKey: ["/api/bot/learnings", workspaceId ?? "", repositoryId ?? ""],
    queryFn: () => getJson(`/api/bot/learnings${scopedQuery(workspaceId, repositoryId)}`),
    enabled: !!workspaceId,
  });
}

export function useCreateLearning(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; repositoryId?: string | null; source?: "feedback" | "rule" | "manual" }) =>
      sendJson<ApiLearning>("POST", "/api/bot/learnings", {
        workspaceId,
        text: input.text,
        repositoryId: input.repositoryId ?? null,
        source: input.source ?? "manual",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/learnings"] }),
  });
}

export function useUpdateLearning() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; text?: string; active?: boolean; repositoryId?: string | null }) =>
      sendJson<ApiLearning>("PATCH", `/api/bot/learnings/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/learnings"] }),
  });
}

export function useDeleteLearning() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<{ ok: boolean }>("DELETE", `/api/bot/learnings/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/learnings"] }),
  });
}

export function useBotExclusions(workspaceId: string | null) {
  return useQuery<ApiExclusion[]>({
    queryKey: ["/api/bot/exclusions", workspaceId ?? ""],
    queryFn: () => getJson(`/api/bot/exclusions${scopedQuery(workspaceId)}`),
    enabled: !!workspaceId,
  });
}

export function useCreateExclusion(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { pattern: string; note?: string | null; repositoryId?: string | null }) =>
      sendJson<ApiExclusion>("POST", "/api/bot/exclusions", {
        workspaceId,
        pattern: input.pattern,
        note: input.note ?? null,
        repositoryId: input.repositoryId ?? null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/exclusions"] }),
  });
}

export function useUpdateExclusion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      pattern?: string;
      note?: string | null;
      repositoryId?: string | null;
      enabled?: boolean;
    }) => sendJson<ApiExclusion>("PATCH", `/api/bot/exclusions/${id}`, patch),
    onMutate: async ({ id, ...patch }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/bot/exclusions"] });
      const previous = queryClient.getQueriesData<ApiExclusion[]>({ queryKey: ["/api/bot/exclusions"] });
      queryClient.setQueriesData<ApiExclusion[]>({ queryKey: ["/api/bot/exclusions"] }, (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/exclusions"] }),
  });
}

export function useDeleteExclusion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<{ ok: boolean }>("DELETE", `/api/bot/exclusions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/exclusions"] }),
  });
}

/** Findings for a repository, used by the review detail surface. */
export function useRepositoryFindings(repositoryId: string | null, status?: string) {
  return useQuery<ApiFinding[]>({
    queryKey: ["/api/repositories", repositoryId ?? "", "findings", status ?? ""],
    queryFn: () =>
      getJson(`/api/repositories/${repositoryId}/findings${status ? `?status=${encodeURIComponent(status)}` : ""}`),
    enabled: !!repositoryId,
  });
}

export function useDismissFinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<ApiFinding>("PATCH", `/api/findings/${id}`, { status: "dismissed" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/repositories"] }),
  });
}

/** "Don't flag this again": dismiss the finding and create a learning. */
export function useLearnFromFinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<{ learning: ApiLearning }>("POST", `/api/findings/${id}/learning`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/repositories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot/learnings"] });
    },
  });
}

export function useBotSettings(workspaceId: string | null) {
  return useQuery<ApiBotSettings>({
    queryKey: ["/api/bot/settings", workspaceId ?? ""],
    queryFn: () => getJson(`/api/bot/settings${scopedQuery(workspaceId)}`),
    enabled: !!workspaceId,
  });
}

export interface BotSettingsPatch {
  commitReviews?: Partial<CommitReviewSettings>;
  settings?: {
    instructions?: string;
    autonomy?: BotAutonomyLevel;
    pullRequests?: Partial<PullRequestReviewSettings>;
  };
}

export function useUpdateBotSettings(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["/api/bot/settings", workspaceId ?? ""];
  return useMutation({
    mutationFn: (patch: BotSettingsPatch) =>
      sendJson<ApiBotSettings>("PATCH", "/api/bot/settings", { workspaceId, ...patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ApiBotSettings>(queryKey);
      if (previous) {
        queryClient.setQueryData<ApiBotSettings>(queryKey, {
          commitReviews: { ...previous.commitReviews, ...(patch.commitReviews ?? {}) },
          settings: {
            instructions: patch.settings?.instructions ?? previous.settings.instructions,
            autonomy: patch.settings?.autonomy ?? previous.settings.autonomy,
            pullRequests: {
              ...previous.settings.pullRequests,
              ...(patch.settings?.pullRequests ?? {}),
            },
          },
        });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
