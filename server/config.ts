function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function optionalAbsoluteUrl(envName: string): string | null {
  const value = process.env[envName];
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.host) return null;
    return normalizeUrl(parsed.toString());
  } catch {
    return null;
  }
}

// PUBLIC_URL environment variable is used as the public-facing base URL fallback.
// See getPublicUrl() in routes.ts.
