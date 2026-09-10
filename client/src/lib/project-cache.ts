import { queryClient } from "@/lib/queryClient";

/**
 * Manages per-project cache eviction. When the user navigates away from a
 * project, its query data is held for `TTL_MS` then evicted. Navigating
 * back cancels the eviction timer.
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function evictProject(projectId: string): void {
  // Remove project-specific query keys from the React Query cache.
  const cache = queryClient.getQueryCache();
  cache.getAll().forEach((q) => {
    const key = q.queryKey;
    if (
      (key[0] === `/api/projects/${projectId}`) ||
      (key[0] === "/api/projects" && key[1] === projectId) ||
      (key[0] === "/api/cortardo-agent/runs" && key[1] === projectId) ||
      (key[0] === "/api/cortardo-agent/projects" && key[1] === projectId)
    ) {
      cache.remove(q);
    }
  });
  timers.delete(projectId);
}

/** Call when the user navigates AWAY from a project. Starts the eviction timer. */
export function scheduleProjectEviction(projectId: string): void {
  if (timers.has(projectId)) return; // already scheduled
  const timer = setTimeout(() => evictProject(projectId), TTL_MS);
  timers.set(projectId, timer);
}

/** Call when the user navigates TO a project. Cancels any pending eviction. */
export function cancelProjectEviction(projectId: string): void {
  const timer = timers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(projectId);
  }
}

/** Remove all pending timers (e.g. on logout). */
export function clearAllProjectTimers(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
}
