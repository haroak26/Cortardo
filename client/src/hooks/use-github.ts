import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CodeGraphConnection, CodeGraphFile } from "@shared/codegraph";

export interface GithubInstallationSummary {
  id: string;
  installationId: string;
  accountLogin: string | null;
  accountType: string | null;
  repositorySelection: string;
  suspended: boolean;
  workspaceId: string;
  createdAt: string;
}

export interface GithubStatus {
  configured: boolean;
  appName: string | null;
  appSlug: string | null;
  workspaceId: string | null;
  installations: GithubInstallationSummary[];
  pendingInstallation: { installationId: string; workspaceId: string } | null;
}

export type CodegraphStatus = "missing" | "pending" | "indexing" | "ready" | "error" | "empty";

export interface ApiRepository {
  id: string;
  workspaceId: string;
  ownerId: string;
  provider: string;
  externalId: string | null;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string | null;
  installationId: string | null;
  isPrivate: boolean;
  reviewEnabled: boolean;
  settings: Record<string, unknown>;
  indexedAt: string | null;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  indexed: boolean;
  codegraphStatus: CodegraphStatus;
  codegraphFileCount: number;
  codegraphGeneratedAt: string | null;
  indexing: boolean;
  installation: {
    id: string;
    accountLogin: string | null;
    accountType: string | null;
    suspended: boolean;
  } | null;
}

export interface InstallationRepository {
  externalId: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string | null;
  isPrivate: boolean;
  imported: boolean;
  repositoryId: string | null;
  reviewEnabled: boolean;
  codegraphStatus: CodegraphStatus | null;
  codegraphFileCount: number;
  codegraphGeneratedAt: string | null;
  indexing: boolean;
}

export interface RepositoryCodegraph {
  repository: string;
  status: CodegraphStatus;
  indexing: boolean;
  files: CodeGraphFile[];
  connections: CodeGraphConnection[];
  commitSha: string | null;
  fileCount: number;
  generatedAt: string | null;
  error: string | null;
}

export interface ApiReviewRun {
  id: string;
  workspaceId: string;
  repositoryId: string | null;
  pullRequestId: string | null;
  trigger: string;
  status: string;
  title: string | null;
  summary: string | null;
  error: string | null;
  stats: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  repositoryFullName?: string | null;
  pullRequestNumber?: number | null;
  pullRequestAuthor?: string | null;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      text.trimStart().startsWith("<")
        ? `Unexpected non-JSON response (${res.status}). The server may need a restart.`
        : text.trim() || `Request failed (${res.status})`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response (${res.status})`);
  }
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
  return readJson<T>(res);
}

async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return readJson<T>(res);
}

export function useGithubStatus(workspaceId: string | null) {
  return useQuery<GithubStatus>({
    queryKey: ["/api/github/status", workspaceId ?? ""],
    queryFn: () => getJson(`/api/github/status${workspaceId ? `?workspaceId=${workspaceId}` : ""}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}

export function useRepositories(workspaceId: string | null) {
  return useQuery<ApiRepository[]>({
    queryKey: ["/api/repositories", workspaceId ?? ""],
    queryFn: async () => {
      const rows = await getJson<ApiRepository[]>(
        `/api/repositories${workspaceId ? `?workspaceId=${workspaceId}` : ""}`,
      );
      return Array.isArray(rows) ? rows : [];
    },
    enabled: !!workspaceId,
  });
}

export function useInstallationRepositories(installationId: string | null) {
  return useQuery<InstallationRepository[]>({
    queryKey: ["/api/github/installations", installationId ?? "", "repositories"],
    queryFn: async () => {
      const data = await getJson<{ repositories: InstallationRepository[] }>(
        `/api/github/installations/${installationId}/repositories`,
      );
      return data.repositories ?? [];
    },
    enabled: !!installationId,
    refetchInterval: (query) =>
      query.state.data?.some((repository) => repository.indexing) ? 3000 : false,
  });
}

export function useUpdateRepositorySelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ installationId, externalIds }: { installationId: string; externalIds: string[] }) =>
      sendJson<{ imported: number; removed: number; queued: number }>(
        "PUT",
        `/api/github/installations/${installationId}/repositories`,
        { externalIds },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/repositories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/github/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/github/installations"] });
    },
  });
}

export function useRepositoryCodegraph(repositoryId: string | null) {
  return useQuery<RepositoryCodegraph>({
    queryKey: ["/api/repositories", repositoryId ?? "", "codegraph"],
    queryFn: () => getJson<RepositoryCodegraph>(`/api/repositories/${repositoryId}/codegraph`),
    enabled: !!repositoryId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return data.indexing || data.status === "indexing" || data.status === "pending" ? 2500 : false;
    },
  });
}

export interface ReviewFixAttempt {
  id: string;
  runId: string;
  findingKey: string;
  attempt: number;
  status: string;
  path: string | null;
  line: number | null;
  title: string | null;
  patch: string | null;
  reproPath: string | null;
  verdict: Record<string, unknown>;
  logs: string | null;
  durationMs: number;
  createdAt: string;
}

export function useReviewFixAttempts(runId: string | null) {
  return useQuery<ReviewFixAttempt[]>({
    queryKey: ["/api/runs", runId ?? "", "attempts"],
    queryFn: async () => {
      const rows = await getJson<ReviewFixAttempt[]>(`/api/runs/${runId}/attempts`);
      return Array.isArray(rows) ? rows : [];
    },
    enabled: Boolean(runId),
  });
}

export function useGenerateRepositoryCodegraph() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repositoryId: string) =>
      sendJson<{ status: string }>("POST", `/api/repositories/${repositoryId}/codegraph`),
    onSuccess: (_data, repositoryId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/repositories", repositoryId, "codegraph"] });
      queryClient.invalidateQueries({ queryKey: ["/api/repositories"] });
    },
  });
}

export function useReviewRuns(workspaceId: string | null, limit = 50) {
  return useQuery<ApiReviewRun[]>({
    queryKey: ["/api/runs", workspaceId ?? "", limit],
    queryFn: async () => {
      const rows = await getJson<ApiReviewRun[]>(
        `/api/runs?limit=${limit}${workspaceId ? `&workspaceId=${workspaceId}` : ""}`,
      );
      return Array.isArray(rows) ? rows : [];
    },
    enabled: !!workspaceId,
    refetchInterval: 15_000,
  });
}

/** Returns the GitHub install URL; navigate the browser to it. */
export function useStartGithubInstall() {
  return useMutation({
    mutationFn: (workspaceId: string) =>
      getJson<{ url: string }>(`/api/github/install-url?workspaceId=${workspaceId}`),
  });
}

export function useClaimGithubInstallation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<{ installation: GithubInstallationSummary }>(
      "POST",
      "/api/github/installations/claim",
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/github/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/repositories"] });
    },
  });
}

export function useSyncGithubInstallation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (installationId: string) =>
      sendJson<{ repositories: number }>("POST", `/api/github/installations/${installationId}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/repositories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/github/status"] });
    },
  });
}

export function useDisconnectGithubInstallation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      sendJson<{ ok: boolean; githubUninstalled: boolean }>(
        "DELETE",
        `/api/github/installations/${id}?uninstall=true`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/repositories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/github/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/github/installations"] });
    },
  });
}

export function useUpdateRepository() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; reviewEnabled?: boolean }) =>
      sendJson<ApiRepository>("PATCH", `/api/repositories/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/repositories"] });
    },
  });
}

export function useTriggerRepositoryReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      repositoryId,
      pullRequestNumber,
      instructions,
    }: {
      repositoryId: string;
      pullRequestNumber?: number;
      instructions?: string;
    }) =>
      sendJson<ApiReviewRun>("POST", `/api/repositories/${repositoryId}/runs`, {
        pullRequestNumber,
        instructions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
    },
  });
}
