import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { storage } from "./storage";
import { db } from "./db";
import { sql, eq, and } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, comparePasswords } from "./auth";
import { sendVerificationEmail, sendEmailChangeVerification, sendPasswordResetEmail, sendTwoFactorEmail, sendAdminTwoFactorEmail, sendPinEmail, sendWelcomeEmail, sendWorkspaceInviteEmail, sendNewDeviceEmail } from "./email";
import { generateTotpSecret, verifyTotp, buildOtpauthUrl } from "./totp";
import { registerAuthRoutes } from "./routes/auth";
import { registerRemainingRoutes } from "./routes/remaining";
import { registerCortardoAgentRoutes } from "./routes/cortardo-agent";
import { buildOnboardingSession } from "./onboarding-session";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import {
  signupSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  updateProfileSchema,
  changePasswordSchema,
  deleteAccountSchema,
  createWorkspaceSchema,
  updateWorkspaceSchema,
  inviteWorkspaceMemberSchema,
  updateWorkspaceMemberSchema,
  createProjectSchema,
  createBranchSchema,
  PLAN_LIMITS,
  type PlanTier,
  type User,
  workspaces,
  users,
  forgotPasswordSchema,
  resetPasswordSchema,
  onboardingStepSchema,
} from "@shared/schema";

function safeUserPayload(u: User) {
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


type LoginChallenge = {
  id: string;
  userId: string;
  email: string;
  code: string;
  token: string;
  expiresAt: number;
  verifiedAt?: number;
};

const loginChallenges = new Map<string, LoginChallenge>();

function createLoginChallenge(user: User): LoginChallenge {
  const id = randomBytes(16).toString("hex");
  const token = randomBytes(24).toString("hex");
  const code = String(randomInt(100000, 1000000));
  const challenge: LoginChallenge = {
    id,
    userId: user.id,
    email: user.email,
    code,
    token,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  loginChallenges.set(id, challenge);
  return challenge;
}

function getActiveChallenge(challengeId: string): LoginChallenge | null {
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

// ── New Device Detection ──────────────────────────────────────────────────────

const knownDevices = new Map<string, Set<string>>();

function parseUserAgent(ua: string): { browser: string; os: string } {
  let browser = "Unknown browser";
  let os = "Unknown OS";

  if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari")) browser = "Safari";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("OPR") || ua.includes("Opera")) browser = "Opera";

  if (ua.includes("Windows NT")) os = "Windows";
  else if (ua.includes("Mac OS X")) os = "macOS";
  else if (ua.includes("Linux") && !ua.includes("Android")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("CrOS")) os = "ChromeOS";

  return { browser, os };
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

async function checkAndNotifyNewDevice(req: Request, user: User): Promise<void> {
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
      browser,
      os,
      ip,
      location,
      time: new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }),
    });

    markDeviceKnown(user.id, fingerprint);
  } catch (err) {
    console.error("[device] new device check failed:", err);
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export function normalizePublicUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export function parseAbsoluteUrl(value: string | undefined) {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.host) return null;
    return normalizePublicUrl(parsed.toString());
  } catch {
    return null;
  }
}

export function firstHeaderValue(value: string | string[] | undefined) {
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
  return normalizePublicUrl(`${req.protocol}://${req.hostname}`);
}



export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later." },
  });

  const apiRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later." },
  });

  const publicRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later." },
  });

  const publicStrictRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later." },
  });

  // ── Verification attempt tracking (in-memory) ───────────────────────────
  const verificationAttempts = new Map<string, { attempts: number; lastAttempt: number }>();
  const MAX_VERIFICATION_ATTEMPTS = 5;

  function trackVerificationAttempt(email: string): boolean {
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

  function clearVerificationAttempts(email: string) {
    verificationAttempts.delete(email.toLowerCase());
  }

  setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    verificationAttempts.forEach((v, k) => { if (v.lastAttempt < cutoff) verificationAttempts.delete(k); });
  }, 60_000).unref();

  // ── Health Check ──────────────────────────────────────────────────────
  app.get("/api/health", async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.status(200).json({ status: "ok", db: true });
    } catch (e) {
      console.error("[health] db check failed:", e);
      res.status(503).json({ status: "degraded", db: false });
    }
  });

  registerAuthRoutes(app);
  registerRemainingRoutes(app);
  // ── Projects ──────────────────────────────────────────────────────────
  const PROJECT_NAME_ADJECTIVES = [
    "Healthy", "Brave", "Calm", "Clever", "Cosmic", "Crimson", "Curious", "Daring",
    "Electric", "Emerald", "Fancy", "Fluffy", "Gentle", "Golden", "Hidden", "Jolly",
    "Lucky", "Mighty", "Mystic", "Noble", "Polite", "Quiet", "Rapid", "Ruby",
    "Sacred", "Silent", "Silver", "Sleepy", "Snug", "Solar", "Spicy", "Sturdy",
    "Sunny", "Swift", "Tidy", "Velvet", "Vivid", "Wandering", "Wild", "Witty", "Zesty", "Cozy",
  ];
  const PROJECT_NAME_ANIMALS = [
    "Jaguar", "Otter", "Falcon", "Panda", "Lynx", "Marmot", "Heron", "Badger",
    "Cobra", "Dolphin", "Eagle", "Fox", "Gecko", "Hawk", "Ibis", "Koala",
    "Lemur", "Moose", "Newt", "Owl", "Puma", "Quokka", "Rabbit", "Seal",
    "Tiger", "Urchin", "Viper", "Walrus", "Yak", "Zebra", "Bison", "Camel",
    "Ferret", "Gibbon", "Hare", "Iguana", "Jackal", "Koi", "Llama", "Mantis",
  ];
  /** Generates a random "Adjective Animal" name, e.g. "Healthy Jaguar". */
  function randomProjectName(): string {
    const adjective = PROJECT_NAME_ADJECTIVES[randomInt(0, PROJECT_NAME_ADJECTIVES.length)];
    const animal = PROJECT_NAME_ANIMALS[randomInt(0, PROJECT_NAME_ANIMALS.length)];
    return `${adjective} ${animal}`;
  }

  app.post("/api/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as User).id;
      const parsed = createProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.issues });
      }

      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      let workspaceId = (req.body as any).workspaceId || user.lastWorkspaceId;

      if (!workspaceId) {
        const defaultName = (user.displayName || user.username || "My").trim().split(/\s+/)[0] || "My";
        const ws = await storage.createWorkspace(userId, {
          name: `${defaultName}'s Workspace`,
          slug: `ws-${randomBytes(6).toString("hex")}`,
        });
        workspaceId = ws.id;
        await storage.updateUser(userId, { lastWorkspaceId: ws.id });
      }

      const access = await storage.canAccessWorkspace(userId, workspaceId);
      if (!access.allowed) {
        return res.status(403).json({ message: "Access denied" });
      }

      const projectData = { ...parsed.data };
      // Never derive the project name from the user's prompt; assign a random
      // "Adjective Animal" name instead (e.g. "Healthy Jaguar").
      if (!projectData.name || projectData.name === projectData.description) {
        projectData.name = randomProjectName();
      }

      const project = await storage.createProject(userId, workspaceId, projectData);

      try {
        await storage.incrementUsage(userId, "projects_count");
      } catch {}

      try {
        await storage.createBranch(project.id, { name: "Main", createdBy: userId });
      } catch {}

      return res.status(201).json(project);
    } catch (err: any) {
      console.error("[projects] create error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to create project" });
    }
  });

  app.get("/api/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as User).id;
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const workspaceId = (req.query.workspaceId as string) || user.lastWorkspaceId;
      if (!workspaceId) return res.json([]);

      const access = await storage.canAccessWorkspace(userId, workspaceId);
      if (!access.allowed) return res.json([]);

      const projectsList = await storage.listProjects(workspaceId);
      return res.json(projectsList);
    } catch (err: any) {
      console.error("[projects] list error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to list projects" });
    }
  });

  // ── Project Branches ─────────────────────────────────────────────────────
  app.get("/api/projects/:projectId/branches", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId);
      const userId = (req.user as User).id;
      const project = await storage.getProjectById(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== userId) return res.status(403).json({ message: "Access denied" });

      const branchList = await storage.listBranches(projectId);
      return res.json(branchList);
    } catch (err: any) {
      console.error("[branches] list error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to list branches" });
    }
  });

  app.post("/api/projects/:projectId/branches", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId);
      const userId = (req.user as User).id;
      const project = await storage.getProjectById(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.ownerId !== userId) return res.status(403).json({ message: "Access denied" });

      const parsed = createBranchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid branch name", errors: parsed.error.issues });
      }

      const existing = await storage.listBranches(projectId);
      if (existing.some((b) => b.name.toLowerCase() === parsed.data.name.toLowerCase())) {
        return res.status(409).json({ message: "A branch with this name already exists" });
      }

      const branch = await storage.createBranch(projectId, { name: parsed.data.name, createdBy: userId });
      return res.status(201).json(branch);
    } catch (err: any) {
      console.error("[branches] create error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to create branch" });
    }
  });

  // ── Components ──────────────────────────────────────────────────────────
  app.get("/api/components", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as User).id;
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const workspaceId = (req.query.workspaceId as string) || user.lastWorkspaceId;
      if (!workspaceId) return res.json([]);

      const access = await storage.canAccessWorkspace(userId, workspaceId);
      if (!access.allowed) return res.json([]);

      const list = await storage.listComponents(workspaceId);
      return res.json(list);
    } catch (err: any) {
      console.error("[components] list error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to list components" });
    }
  });

  // ── Assets ──────────────────────────────────────────────────────────────
  app.get("/api/assets", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as User).id;
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const workspaceId = (req.query.workspaceId as string) || user.lastWorkspaceId;
      if (!workspaceId) return res.json([]);

      const access = await storage.canAccessWorkspace(userId, workspaceId);
      if (!access.allowed) return res.json([]);

      const list = await storage.listAssets(workspaceId);
      return res.json(list);
    } catch (err: any) {
      console.error("[assets] list error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to list assets" });
    }
  });

  registerCortardoAgentRoutes(app);

  return httpServer;
}
