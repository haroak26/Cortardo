const originalFetch = window.fetch;

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  if (typeof input === "string") {
    if (input.startsWith("/")) return true;
    try {
      return new URL(input, window.location.origin).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  if (input instanceof URL) {
    return input.origin === window.location.origin;
  }
  try {
    return new URL(input.url).origin === window.location.origin;
  } catch {
    return false;
  }
}

window.fetch = function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : undefined) ?? "GET";

  if (isUnsafeMethod(method) && isSameOrigin(input)) {
    const token = getCsrfToken();
    if (token) {
      if (!init) {
        if (input instanceof Request) {
          init = { headers: { "x-csrf-token": token } };
        } else {
          init = { headers: { "x-csrf-token": token } };
        }
      } else {
        const headers = new Headers(init.headers);
        headers.set("x-csrf-token", token);
        init = { ...init, headers };
      }
    }
  }

  return originalFetch.call(window, input, init);
};
