export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
  const workers = Array.from({ length: effectiveLimit }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => T,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => {
          if (onTimeout) resolve(onTimeout());
          else reject(new TimeoutError(`timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: {
    retries: number;
    delayMs?: number;
    onError?: (error: unknown, attempt: number) => void;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
  },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      options.onError?.(error, attempt);
      if (options.shouldRetry && !options.shouldRetry(error, attempt)) break;
      if (attempt < options.retries) {
        const delay = (options.delayMs ?? 50) * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 1000)));
      }
    }
  }
  throw lastError;
}
