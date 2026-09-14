import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const GITHUB_INSTALL_STATE_COOKIE = "gh_install_state";
export const GITHUB_PENDING_INSTALL_COOKIE = "gh_pending_install";
export const GITHUB_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

export interface InstallStatePayload {
  state: string;
  workspaceId: string;
  userId: string;
  exp: number;
}

export interface PendingInstallPayload {
  installationId: string;
  setupAction: string;
  workspaceId: string;
  userId: string;
  exp: number;
}

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || "cortardo-github-dev-secret";
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function encode(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode<T extends { exp: number }>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createInstallState(workspaceId: string, userId: string): { state: string; cookieValue: string } {
  const state = randomBytes(16).toString("hex");
  const payload: InstallStatePayload = {
    state,
    workspaceId,
    userId,
    exp: Date.now() + GITHUB_COOKIE_MAX_AGE_MS,
  };
  return { state, cookieValue: encode(payload) };
}

export function readInstallState(token: string | undefined | null): InstallStatePayload | null {
  return decode<InstallStatePayload>(token);
}

export function createPendingInstall(input: {
  installationId: string;
  setupAction: string;
  workspaceId: string;
  userId: string;
}): string {
  const payload: PendingInstallPayload = {
    ...input,
    exp: Date.now() + GITHUB_COOKIE_MAX_AGE_MS,
  };
  return encode(payload);
}

export function readPendingInstall(token: string | undefined | null): PendingInstallPayload | null {
  return decode<PendingInstallPayload>(token);
}

export function githubCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: GITHUB_COOKIE_MAX_AGE_MS,
    path: "/",
  };
}
