import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { createHash, randomBytes, randomInt } from "crypto";
import { sendNewDeviceEmail } from "../email";
import type { User } from "@shared/schema";
import { storage } from "../storage";

// ─── URL / IP Utilities ───────────────────────────────────────────

function normalizePublicUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function parseAbsoluteUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.host) return null;
    return normalizePublicUrl(parsed.toString());
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

export function extractClientIp(req: Request) {
  const candidates = [
    firstHeaderValue(req.headers["cf-connecting-ip"]),
    firstHeaderValue(req.headers["x-real-ip"]),
    firstHeaderValue(req.headers["x-client-ip"]),
    firstHeaderValue(req.headers["x-forwarded-for"]),
    req.socket.remoteAddress ?? null,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const ip = value.replace(/^::ffff:/, "").trim();
    if (!ip || ip.toLowerCase() === "unknown") continue;
    return ip;
  }
  return "";
}

export function getPublicUrl(req: Request) {
  const envPublicUrl = parseAbsoluteUrl(process.env.PUBLIC_URL);
  if (envPublicUrl) return envPublicUrl;
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const allowedProto = ["https", "http"];
  if (forwardedProto && forwardedHost && allowedProto.includes(forwardedProto)) {
    const hostname = forwardedHost.split(":")[0];
    const publicHost = process.env.PUBLIC_HOSTNAME || process.env.REPLIT_DEV_DOMAIN || "";
    if (!publicHost || (!hostname.endsWith(publicHost.replace(/^https?:\/\//, "").split("/")[0]) && hostname !== "localhost")) {
      return normalizePublicUrl(`${req.protocol}://${req.hostname}`);
    }
    return normalizePublicUrl(`${forwardedProto}://${forwardedHost}`);
  }
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null;
  if (replitDevDomain) return replitDevDomain;
  const replitDeployedDomain = process.env.REPLIT_DEPLOYMENT_ID && process.env.REPL_SLUG && process.env.REPL_OWNER
    ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : null;
  if (replitDeployedDomain) return replitDeployedDomain;
  return normalizePublicUrl(`${req.protocol}://${req.get("host")}`);
}

// ─── Plan Limit Checker ──────────────────────────────────────────

import { PLAN_LIMITS, type PlanTier, type PlanLimits } from "@shared/schema";

type LimitCheckResult = { allowed: boolean; current: number; limit: number | "unlimited"; message?: string };

export function checkPlanLimit(
  plan: PlanTier,
  limitKey: keyof PlanLimits,
  current: number,
): LimitCheckResult {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const limit = limits[limitKey];
  if (limit === "unlimited") {
    return { allowed: true, current, limit: "unlimited" };
  }
  if (typeof limit !== "number") {
    return { allowed: true, current, limit: "unlimited" };
  }
  if (current >= limit) {
    return {
      allowed: false,
      current,
      limit,
      message: `Your ${limits.label} plan allows ${limit} ${limitKey}. Upgrade to add more.`,
    };
  }
  return { allowed: true, current, limit };
}

// ─── Auth Helpers ─────────────────────────────────────────────────

export function safeUserPayload(u: User) {
  const {
    password: _p,
    emailVerificationToken: _t,
    emailVerificationExpiry: _e,
    pendingEmailToken: _pt,
    pendingEmailExpiry: _pe,
    passwordResetToken: _prt,
    passwordResetExpiry: _pre,
    totpSecret: _ts,
    ...rest
  } = u;
  const publicUserId = `usr_${createHash("sha256")
    .update(`${u.id}:${u.createdAt.toISOString()}`)
    .digest("hex")
    .slice(0, 24)}`;
  return { ...rest, publicUserId };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!(req.session as any).isAdmin) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ─── Rate Limiters ────────────────────────────────────────────────

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

export const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

export const publicStrictRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

// ─── Login Challenge ──────────────────────────────────────────────

export type LoginChallenge = {
  id: string;
  userId: string;
  email: string;
  code: string;
  token: string;
  expiresAt: number;
  verifiedAt?: number;
};

const loginChallenges = new Map<string, LoginChallenge>();

export function createLoginChallenge(user: User): LoginChallenge {
  const id = randomBytes(16).toString("hex");
  const token = randomBytes(24).toString("hex");
  const code = String(randomInt(100000, 1000000));
  const challenge: LoginChallenge = {
    id, userId: user.id, email: user.email, code, token,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  loginChallenges.set(id, challenge);
  return challenge;
}

export function getActiveChallenge(challengeId: string): LoginChallenge | null {
  const challenge = loginChallenges.get(challengeId);
  if (!challenge) return null;
  if (challenge.expiresAt < Date.now()) {
    loginChallenges.delete(challengeId);
    return null;
  }
  return challenge;
}

setInterval(() => {
  const now = Date.now();
  loginChallenges.forEach((challenge, id) => {
    if (challenge.expiresAt < now) loginChallenges.delete(id);
  });
}, 60_000).unref();

// ─── Device Detection ─────────────────────────────────────────────

const knownDevices = new Map<string, Set<string>>();

function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  let browser = "Unknown browser";
  let os = "Unknown OS";
  let device = "Desktop";

  if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("OPR") || ua.includes("Opera")) browser = "Opera";
  else if (ua.includes("MSIE") || ua.includes("Trident")) browser = "Internet Explorer";

  if (ua.includes("Windows NT")) os = "Windows";
  else if (ua.includes("Mac OS X")) os = "macOS";
  else if (ua.includes("Linux") && !ua.includes("Android")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("CrOS")) os = "ChromeOS";

  if (ua.includes("iPhone")) device = "iPhone";
  else if (ua.includes("iPad")) device = "iPad";
  else if (ua.includes("Android") && ua.includes("Mobile")) device = "Phone";
  else if (ua.includes("Android")) device = "Tablet";
  else if (ua.includes("Mobile")) device = "Phone";

  return { browser, os, device };
}

function isKnownDevice(userId: string, deviceFingerprint: string): boolean {
  const devices = knownDevices.get(userId);
  if (!devices) return false;
  return devices.has(deviceFingerprint);
}

function markDeviceKnown(userId: string, deviceFingerprint: string): void {
  let devices = knownDevices.get(userId);
  if (!devices) {
    devices = new Set();
    knownDevices.set(userId, devices);
  }
  devices.add(deviceFingerprint);
}

export async function checkAndNotifyNewDevice(req: Request, user: User): Promise<void> {
  try {
    const ua = req.headers["user-agent"] || "";
    const ip = req.ip || req.socket.remoteAddress || "Unknown";
    const fingerprint = `${ua}|${ip}`;
    if (isKnownDevice(user.id, fingerprint)) return;
    const { browser, os } = parseUserAgent(ua);
    const baseUrl = getPublicUrl(req);
    const hostname = baseUrl.replace(/^https?:\/\//, "").split(".").slice(-2).join(".") || "Unknown";
    const location = `${hostname} (${ip})`;
    await sendNewDeviceEmail(user.email, user.displayName || user.email, {
      browser, os, ip, location,
      time: new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }),
    });
    markDeviceKnown(user.id, fingerprint);
  } catch (err) {
    console.error("[device] new device check failed:", err);
  }
}

export async function trackUserSession(req: Request, user: User): Promise<void> {
  try {
    const ua = req.headers["user-agent"] || "";
    const ip = extractClientIp(req) || req.socket.remoteAddress || "Unknown";
    const { browser, os, device } = parseUserAgent(ua);
    const sessionId = req.sessionID;
    if (!sessionId) return;
    const existing = await storage.getUserSessionBySessionId(sessionId);
    if (existing) {
      await storage.updateUserSession(existing.id, { lastActiveAt: new Date(), isCurrent: true });
      return;
    }
    const baseUrl = getPublicUrl(req);
    const hostname = baseUrl.replace(/^https?:\/\//, "").split(".").slice(-2).join(".") || "Unknown";
    const location = `${hostname}`;
    await storage.createUserSession(user.id, {
      sessionId,
      userAgent: ua.slice(0, 500),
      browser,
      os,
      device,
      ipAddress: ip,
      location,
    });
  } catch (err) {
    console.error("[session] track user session failed:", err);
  }
}

// ─── Verification Attempt Tracking ────────────────────────────────

const verificationAttempts = new Map<string, { attempts: number; lastAttempt: number }>();
const MAX_VERIFICATION_ATTEMPTS = 5;

export function trackVerificationAttempt(email: string): boolean {
  const normalized = email.toLowerCase();
  const entry = verificationAttempts.get(normalized);
  const now = Date.now();
  if (!entry) {
    verificationAttempts.set(normalized, { attempts: 1, lastAttempt: now });
    return true;
  }
  if (entry.attempts >= MAX_VERIFICATION_ATTEMPTS) return false;
  entry.attempts += 1;
  entry.lastAttempt = now;
  return true;
}

export function clearVerificationAttempts(email: string) {
  verificationAttempts.delete(email.toLowerCase());
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  verificationAttempts.forEach((v, k) => { if (v.lastAttempt < cutoff) verificationAttempts.delete(k); });
}, 60_000).unref();

// ─── Audit ────────────────────────────────────────────────────────

export function audit(req: Request, action: string, details?: string) {
  const user = (req as any).user;
  if (!user) return;
  storage.createAuditLog(user.id, action, details, extractClientIp(req)).catch(() => {});
}

// ─── Space Ownership ──────────────────────────────────────────────

export async function assertSpaceOwner(_req: Request, res: Response, _spaceId: string): Promise<boolean> {
  res.status(404).json({ message: "Space not found" });
  return false;
}
