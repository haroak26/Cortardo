import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  activateEncryptedCache as activateEncryption,
  clearEncryptionKey,
} from "@/lib/crypto-cache";
import { clearAllProjectTimers } from "@/lib/project-cache";

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  const token = getCsrfToken();
  if (token) headers["x-csrf-token"] = token;

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/* ── Cache lifecycle ──────────────────────────────────────────────
   The query cache is persisted to encrypted localStorage so reloads
   and revisits render instantly from cache while revalidating in the
   background. It is scoped to the signed-in user and fully wiped
   when the session ends (logout, account deletion, or a 401). */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_STORAGE_KEY = "cortardo.queryCache.v1";
const CACHE_USER_KEY = "cortardo.cacheUserId";

/** localStorage keys that survive a cache wipe (non-private prefs). */
const LOCAL_STORAGE_KEEP = new Set(["cortardo_cookie_consent"]);

const SESSION_STORAGE_KEYS = [
  "cortardo-prompt",
  "cortardo-landing-prompt",
  "cortardo.agent.clarify.v2",
];

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      // Must be >= the persister maxAge so restored queries aren't GC'd.
      gcTime: SEVEN_DAYS_MS,
      retry: 1,
      networkMode: "offlineFirst",
    },
    mutations: {
      retry: false,
    },
  },
});

// ── Encrypted persister ────────────────────────────────────────────────
// Uses a plain (unencrypted) persister as a fallback until the encryption
// key is generated on login. Once the key exists, reads/writes go through
// the encrypted storage adapter. This lets the app boot from a warm cache
// (the persisted blob is still readable) while new writes are encrypted.

const plainPersister = createSyncStoragePersister({
  // Storage adapter that tolerates an encrypted cache blob at boot. The cache
  // is AES-encrypted in localStorage after login, but the key lives only in
  // memory for the current page — so a reload/new tab has no way to decrypt
  // the blob. Returning null for those blobs (instead of handing the raw
  // "enc:..." string to JSON.parse) lets the app boot from a cold cache
  // instead of crashing the whole page with an uncaught SyntaxError.
  storage: {
    getItem(key: string) {
      const raw = window.localStorage.getItem(key);
      if (key === CACHE_STORAGE_KEY && typeof raw === "string" && raw.startsWith("enc:")) {
        return null;
      }
      return raw;
    },
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => window.localStorage.removeItem(key),
  },
  key: CACHE_STORAGE_KEY,
  throttleTime: 500,
});

let activePersister = plainPersister;

/**
 * Activate encrypted cache after login. Intercepts localStorage so future
 * writes are AES-256-GCM encrypted in-memory. The plain persister continues
 * to handle the serialization format — encryption happens at the storage level.
 * The next natural cache update will write the encrypted blob.
 */
export async function activateEncryptedCache(): Promise<void> {
  await activateEncryption(CACHE_STORAGE_KEY);
}

/**
 * Permanently wipe every trace of app data: the query cache (memory +
 * persisted), app-scoped localStorage, and app-scoped sessionStorage.
 */
export async function wipeAppCache(): Promise<void> {
  clearEncryptionKey();
  clearAllProjectTimers();
  try {
    queryClient.clear();
    plainPersister.removeClient();
    // Also remove the encrypted blob if the active persister is different.
    if (activePersister !== plainPersister) {
      activePersister.removeClient();
    }
  } catch {}
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith("cortardo.") || key.startsWith("cortardo-") || key.startsWith("pastel.") || key.startsWith("pastel-")) && !LOCAL_STORAGE_KEEP.has(key)) {
        keys.push(key);
      }
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {}
  try {
    SESSION_STORAGE_KEYS.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {}
}

/* Wipe the cache whenever the session user changes:
   - data === null  → signed out / cookie session ended → wipe everything
   - a different id → a new account signed in → drop the previous account's cache */
let wiping = false;
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated") return;
  const key = event.query.queryKey;
  if (!Array.isArray(key) || key[0] !== "/api/me") return;
  if (wiping) return;
  const data = event.query.state.data as { id?: string } | null | undefined;
  if (data === undefined) return;

  wiping = true;
  const done = () => { wiping = false; };
  try {
    if (data === null || !data.id) {
      // Signed out / session ended. Only wipe if there is something to wipe.
      const hasPersisted = window.localStorage.getItem(CACHE_STORAGE_KEY) !== null
        || window.localStorage.getItem(CACHE_USER_KEY) !== null;
      if (hasPersisted) void wipeAppCache().then(done, done);
      else done();
      return;
    }
    const storedUserId = window.localStorage.getItem(CACHE_USER_KEY);
    if (storedUserId && storedUserId !== data.id) {
      // New account: drop the previous account's data, keep the new user.
      const me = data;
      queryClient.clear();
      plainPersister.removeClient();
      if (activePersister !== plainPersister) activePersister.removeClient();
      queryClient.setQueryData(["/api/me"], me);
    }
    window.localStorage.setItem(CACHE_USER_KEY, data.id);
  } catch {
    // ignore storage errors
  }
  done();
});

if (typeof window !== "undefined") {
  // A malformed or unreadable cache must never take down the app at boot.
  try {
    persistQueryClient({
      queryClient,
      persister: plainPersister,
      maxAge: SEVEN_DAYS_MS,
    });
  } catch (err) {
    console.error("[queryClient] failed to restore persisted cache:", err);
    try {
      plainPersister.removeClient();
    } catch {}
  }
}

/* ── Login prefetch ───────────────────────────────────────────────
   Warm exactly the keys the app shell needs immediately after sign-in
   so the first screen renders without a blank gate or waterfall:
   me → workspaces → (workspace-scoped) spaces + projects + credits
                     + components + assets. */

async function prefetchKey<T>(qc: QueryClient, queryKey: unknown[], url: string): Promise<T | null> {
  return qc.fetchQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json() as Promise<T>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export type PrefetchProgress = (step: number, total: number) => void;

const PREFETCH_TOTAL_STEPS = 4;

/**
 * Prefetch all data the app shell needs after login.
 * Calls `onProgress(step, total)` after each phase completes.
 * Step 1 = /api/me, Step 2 = /api/workspaces, Step 3 = parallel bulk, Step 4 = chunk warm.
 */
export async function prefetchAppData(
  qc: QueryClient = queryClient,
  onProgress?: PrefetchProgress,
): Promise<void> {
  type User = { id?: string; lastWorkspaceId?: string | null } | null;
  type Workspace = { id: string };

  // Step 1: User
  let user = qc.getQueryData<User>(["/api/me"]);
  if (!user) {
    try {
      user = await prefetchKey<User>(qc, ["/api/me"], "/api/me");
    } catch {
      user = null;
    }
  }
  if (!user) return;
  onProgress?.(1, PREFETCH_TOTAL_STEPS);

  try { window.localStorage.setItem(CACHE_USER_KEY, String(user.id)); } catch {}

  // Step 2: Workspaces
  let workspaces: Workspace[] = [];
  try {
    workspaces = (await prefetchKey<Workspace[]>(qc, ["/api/workspaces"], "/api/workspaces")) ?? [];
  } catch {
    workspaces = [];
  }
  onProgress?.(2, PREFETCH_TOTAL_STEPS);

  // Resolve the workspace id the contexts will pick so the spaces
  // prefetch lands on the exact query key ['/api/spaces', id].
  let workspaceId: string | null = null;
  try { workspaceId = window.localStorage.getItem("cortardo.activeWorkspaceId"); } catch {}
  if (!workspaceId || !workspaces.some((w) => w.id === workspaceId)) {
    workspaceId = user.lastWorkspaceId ?? workspaces[0]?.id ?? null;
  }

  // Step 3: Parallel bulk fetch — plan, credits, projects, spaces, components, assets
  const jobs: Promise<unknown>[] = [
    prefetchKey(qc, ["/api/me/plan"], "/api/me/plan"),
    prefetchKey(qc, ["/api/credits/balance"], "/api/credits/balance"),
    prefetchKey(qc, ["/api/projects"], "/api/projects"),
  ];
  if (workspaceId) {
    const wsQuery = `workspaceId=${encodeURIComponent(workspaceId)}`;
    jobs.push(
      prefetchKey(qc, ["/api/spaces", workspaceId], `/api/spaces?${wsQuery}`),
    );
  }
  await Promise.allSettled(jobs);
  onProgress?.(3, PREFETCH_TOTAL_STEPS);

  // Step 4: Warm the heavy route chunks while the network is idle so the
  // first navigation after sign-in doesn't pay the parse cost.
  const warm = () => {
    void import("@/pages/HomePage");
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(warm, { timeout: 3000 });
  } else {
    setTimeout(warm, 1500);
  }
  onProgress?.(4, PREFETCH_TOTAL_STEPS);
}
