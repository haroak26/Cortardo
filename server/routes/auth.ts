import type { Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { z } from "zod";
import { randomBytes } from "crypto";
import { storage } from "../storage";
import { hashPassword, comparePasswords } from "../auth";
import { generateTotpSecret, verifyTotp, buildOtpauthUrl } from "../totp";
import { sendMailFromSmtp } from "../transport-pool";
import { sendPinEmail, sendPasswordResetEmail, sendTwoFactorEmail } from "../email";
import {
  signupSchema, loginSchema, verifyEmailSchema, resendVerificationSchema,
  type User,
} from "@shared/schema";
import { buildOnboardingSession } from "../onboarding-session";
import { registerOnboardingRoutes } from "../onboarding-routes";
import {
  requireAuth, authRateLimiter, audit, safeUserPayload,
  createLoginChallenge, getActiveChallenge,
  checkAndNotifyNewDevice, trackUserSession, trackVerificationAttempt, clearVerificationAttempts,
  getPublicUrl,
} from "./helpers";

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/signup", authRateLimiter, async (req, res) => {
    try {
      const { email, password } = signupSchema.parse(req.body);
      const normalized = email.toLowerCase().trim();
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiry = new Date(Date.now() + 10 * 60 * 1000);
      const existing = await storage.getUserByEmail(normalized);
      if (existing?.emailVerified) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }
      let user: User;
      let statusCode = 201;
      if (existing) {
        const hashed = await hashPassword(password);
        user = await storage.updateUser(existing.id, { password: hashed, emailVerificationToken: code, emailVerificationExpiry: expiry });
        statusCode = 200;
      } else {
        const hashed = await hashPassword(password);
        const emailLocalPart = normalized.split("@")[0].replace(/[^a-z0-9]/g, "");
        const username = `${emailLocalPart}_${Date.now().toString(36)}`;
        user = await storage.createUser({ username, email: normalized, password: hashed, emailVerificationToken: code, emailVerificationExpiry: expiry, onboardingStep: 0 });
      }
      await storage.upsertOnboardingSession(user.id, { status: "active", currentStep: "email_verification", emailVerificationStatus: "sent" });
      await sendPinEmail(normalized, code);
      clearVerificationAttempts(normalized);
      const session = await buildOnboardingSession(user);
      return res.status(statusCode).json({ ok: true, email: normalized, session });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[auth/signup]", err);
      return res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post("/api/auth/verify-email", authRateLimiter, async (req, res, next) => {
    try {
      const { email, code } = verifyEmailSchema.parse(req.body);
      const normalized = email.toLowerCase().trim();
      if (!trackVerificationAttempt(normalized)) {
        return res.status(429).json({ message: "Too many attempts. Please request a new code." });
      }
      const user = await storage.getUserByEmail(normalized);
      if (!user) return res.status(400).json({ message: "No account found for this email." });
      if (user.emailVerified) {
        clearVerificationAttempts(normalized);
        const session = await buildOnboardingSession(user);
        return req.login(user, (err) => {
          if (err) return next(err);
          return res.status(200).json(session);
        });
      }
      if (!user.emailVerificationToken || !user.emailVerificationExpiry) {
        return res.status(400).json({ message: "No verification pending. Please sign up again." });
      }
      if (new Date() > user.emailVerificationExpiry) {
        await storage.updateUser(user.id, { emailVerificationToken: null, emailVerificationExpiry: null });
        await storage.upsertOnboardingSession(user.id, { currentStep: "email_verification", emailVerificationStatus: "expired" });
        return res.status(400).json({ message: "Verification code expired. Please request a new one." });
      }
      if (user.emailVerificationToken !== code.trim()) {
        return res.status(400).json({ message: "Incorrect verification code." });
      }
      const updated = await storage.updateUser(user.id, { emailVerified: true, emailVerificationToken: null, emailVerificationExpiry: null });
      clearVerificationAttempts(normalized);
      await storage.upsertOnboardingSession(user.id, { currentStep: user.displayName?.trim() ? "workspace" : "profile_name", emailVerificationStatus: "verified", displayNameStatus: user.displayName?.trim() ? "complete" : "not_started" });
      const session = await buildOnboardingSession(updated);
      if (session.currentStep === "complete") {
        console.error(`[auth/verify-email] CRITICAL: user ${user.id} has complete onboarding session immediately after email verification`);
      }
      req.login(updated, (err) => { if (err) return next(err); return res.status(200).json(session); });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[auth/verify-email]", err);
      return res.status(500).json({ message: "Failed to verify email" });
    }
  });

  app.post("/api/auth/resend-verification", authRateLimiter, async (req, res) => {
    try {
      const { email } = resendVerificationSchema.parse(req.body);
      const normalized = email.toLowerCase().trim();
      const user = await storage.getUserByEmail(normalized);
      if (!user) return res.status(400).json({ message: "No account found for this email." });
      if (user.emailVerified) return res.status(400).json({ message: "Email is already verified." });
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiry = new Date(Date.now() + 10 * 60 * 1000);
      await storage.updateUser(user.id, { emailVerificationToken: code, emailVerificationExpiry: expiry });
      await storage.upsertOnboardingSession(user.id, { status: "active", currentStep: "email_verification", emailVerificationStatus: "sent" });
      clearVerificationAttempts(normalized);
      await sendPinEmail(normalized, code);
      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[auth/resend-verification]", err);
      return res.status(500).json({ message: "Failed to resend code" });
    }
  });

  app.get("/api/auth/verification-session", authRateLimiter, async (req, res) => {
    try {
      const email = z.string().email().parse(req.query.email);
      const normalized = email.toLowerCase().trim();
      const user = await storage.getUserByEmail(normalized);
      if (!user) return res.status(404).json({ message: "No verification session found for this email." });
      if (user.emailVerified) {
        return res.status(409).json({ message: "Email is already verified.", email: normalized, emailVerificationStatus: "verified" });
      }
      const session = await buildOnboardingSession(user);
      return res.json({ email: normalized, currentStep: session.currentStep, emailVerificationStatus: session.emailVerificationStatus });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[auth/verification-session]", err);
      return res.status(500).json({ message: "Failed to get verification session" });
    }
  });

  app.post("/api/login", authRateLimiter, (req, res, next) => {
    try { loginSchema.parse(req.body); } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
    passport.authenticate("local", (err: unknown, user: User | false, info: { message?: string }) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message ?? "Invalid credentials" });
      if (user.totpEnabled) {
        const challenge = createLoginChallenge(user);
        return res.status(202).json({ requiresTwoFactor: true, totpChallenge: true, challengeId: challenge.id, expiresInSeconds: 300 });
      }
      if (user.emailVerified) {
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          audit(req, "login", "Successful login");
          checkAndNotifyNewDevice(req, user);
          trackUserSession(req, user);
          return res.status(200).json(safeUserPayload(user));
        });
        return;
      }
      const challenge = createLoginChallenge(user);
      const baseUrl = getPublicUrl(req);
      sendTwoFactorEmail(user.email, challenge.code, challenge.id, challenge.token, baseUrl).catch((e) => console.error("[auth] failed to send 2FA email:", e));
      return res.status(202).json({ requiresTwoFactor: true, requiresEmailVerification: true, email: user.email, challengeId: challenge.id, expiresInSeconds: 600 });
    })(req, res, next);
  });

  app.get("/api/login/verify-link", authRateLimiter, async (req, res) => {
    const challengeId = String(req.query.challengeId ?? "");
    const token = String(req.query.token ?? "");
    const challenge = getActiveChallenge(challengeId);
    if (!challenge || challenge.token !== token) return res.status(400).send("Invalid or expired verification link.");
    challenge.verifiedAt = Date.now();
    return res.redirect(`/auth/loading-verification?challenge=${encodeURIComponent(challengeId)}`);
  });

  app.post("/api/login/2fa/verify", authRateLimiter, async (req, res) => {
    const body = z.object({ challengeId: z.string().min(1), code: z.string().length(6) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Invalid code" });
    const challenge = getActiveChallenge(body.data.challengeId);
    if (!challenge) return res.status(400).json({ message: "Verification session expired. Please sign in again." });
    if (challenge.code !== body.data.code) return res.status(400).json({ message: "Incorrect verification code" });
    challenge.verifiedAt = Date.now();
    return res.status(200).json({ verified: true });
  });

  app.post("/api/login/2fa/resend", authRateLimiter, async (req, res) => {
    const body = z.object({ challengeId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Missing challenge id" });
    const existing = getActiveChallenge(body.data.challengeId);
    if (!existing) return res.status(400).json({ message: "Verification session expired. Please sign in again." });
    const user = await storage.getUserById(existing.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const challenge = createLoginChallenge(user);
    const baseUrl = getPublicUrl(req);
    await sendTwoFactorEmail(user.email, challenge.code, challenge.id, challenge.token, baseUrl);
    return res.status(200).json({ challengeId: challenge.id });
  });

  app.post("/api/login/2fa/totp", authRateLimiter, async (req, res, next) => {
    const body = z.object({ challengeId: z.string().min(1), code: z.string().length(6) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Invalid code" });
    const challenge = getActiveChallenge(body.data.challengeId);
    if (!challenge) return res.status(400).json({ message: "Verification session expired. Please sign in again." });
    const user = await storage.getUserById(challenge.userId);
    if (!user || !user.totpSecret) return res.status(400).json({ message: "TOTP not configured" });
    if (!verifyTotp(user.totpSecret, body.data.code)) return res.status(400).json({ message: "Incorrect verification code" });
    challenge.verifiedAt = Date.now();
    return res.status(200).json({ verified: true });
  });

  app.get("/api/login/2fa/status", authRateLimiter, async (req, res, next) => {
    const challengeId = String(req.query.challengeId ?? "");
    const challenge = getActiveChallenge(challengeId);
    if (!challenge) return res.status(400).json({ message: "Verification session expired." });
    if (!challenge.verifiedAt) return res.status(200).json({ verified: false });
    const user = await storage.getUserById(challenge.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    let loginUser = user;
    if (!user.emailVerified) {
      loginUser = await storage.updateUser(user.id, { emailVerified: true, emailVerificationToken: null, emailVerificationExpiry: null });
    }
    audit(req, "login", "Successful login with 2FA");
    checkAndNotifyNewDevice(req, loginUser);
    trackUserSession(req, loginUser);
    req.login(loginUser, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.status(200).json({ verified: true, user: safeUserPayload(loginUser) });
    });
  });

  app.post("/api/logout", (req, res) => {
    audit(req, "logout", "User logged out");
    const sessionId = req.sessionID;
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        if (sessionId) {
          storage.getUserSessionBySessionId(sessionId).then((existing) => {
            if (existing) storage.updateUserSession(existing.id, { isCurrent: false, lastActiveAt: new Date() });
          }).catch((e) => console.error("[logout] failed to update session:", e));
        }
        return res.status(200).json({ message: "Logged out" });
      });
    });
  });

  app.post("/api/forgot-password", authRateLimiter, async (req, res) => {
    try {
      const { email } = req.body as { email?: string };
      if (!email || typeof email !== "string") return res.status(400).json({ message: "Email is required" });
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (user) {
        const token = randomBytes(32).toString("hex");
        const expiry = new Date(Date.now() + 60 * 60 * 1000);
        await storage.updateUser(user.id, { passwordResetToken: token, passwordResetExpiry: expiry });
        const baseUrl = getPublicUrl(req);
        sendPasswordResetEmail(user.email, token, baseUrl).catch((e) => console.error("[email] Failed to send password reset email:", e));
      }
      return res.status(200).json({ message: "If that email exists, a reset link has been sent." });
    } catch (err) {
      console.error("[forgot-password]", err);
      return res.status(500).json({ message: "Internal error" });
    }
  });

  app.post("/api/reset-password", authRateLimiter, async (req, res) => {
    try {
      const { token, password } = req.body as { token?: string; password?: string };
      if (!token || !password) return res.status(400).json({ message: "Token and new password are required" });
      if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });
      const user = await storage.getUserByPasswordResetToken(token);
      if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
        return res.status(400).json({ message: "This reset link is invalid or has expired." });
      }
      const hashed = await hashPassword(password);
      await storage.updateUser(user.id, { password: hashed, passwordResetToken: null, passwordResetExpiry: null });
      audit(req, "password_reset", "Password reset completed");
      return res.status(200).json({ message: "Password updated successfully." });
    } catch (err) {
      console.error("[reset-password]", err);
      return res.status(500).json({ message: "Internal error" });
    }
  });

  // 2FA management
  app.post("/api/me/2fa/totp/setup", requireAuth, async (req, res) => {
    const secret = generateTotpSecret();
    const url = buildOtpauthUrl(secret, "Cortardo", (req.user as User).email);
    const qrModule: any = await import("qrcode");
    const qrDataUrl = await qrModule.default.toDataURL(url, { width: 200, margin: 1 });
    return res.status(200).json({ secret, url, qrCode: qrDataUrl });
  });

  app.post("/api/me/2fa/totp/enable", requireAuth, async (req, res) => {
    const body = z.object({ code: z.string().length(6), secret: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Invalid code or secret" });
    if (!verifyTotp(body.data.secret, body.data.code)) return res.status(400).json({ message: "Invalid verification code" });
    await storage.updateUser((req.user as User).id, { totpSecret: body.data.secret, totpEnabled: true });
    audit(req, "2fa_enabled", "Two-factor authentication enabled");
    return res.status(200).json({ success: true });
  });

  app.post("/api/me/2fa/totp/disable", requireAuth, async (req, res) => {
    const body = z.object({ password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Password is required" });
    const user = await storage.getUserById((req.user as User).id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!(await comparePasswords(body.data.password, user.password))) return res.status(400).json({ message: "Incorrect password" });
    await storage.updateUser(user.id, { totpSecret: null, totpEnabled: false });
    audit(req, "2fa_disabled", "Two-factor authentication disabled");
    return res.status(200).json({ success: true });
  });

  app.post("/api/me/2fa/totp/verify", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      if (!user.totpSecret) return res.status(400).json({ message: "TOTP not configured" });
      const body = z.object({ code: z.string().length(6) }).safeParse(req.body);
      if (!body.success) return res.status(400).json({ message: "Invalid verification code" });
      if (!verifyTotp(user.totpSecret, body.data.code)) return res.status(400).json({ message: "Incorrect code" });
      return res.json({ verified: true });
    } catch (err) {
      return res.status(500).json({ message: "Verification failed" });
    }
  });

  // Switch account
  const switchAttempts = new Map<string, { count: number; windowStart: number }>();
  app.post("/api/me/switch/check", requireAuth, async (req, res) => {
    const user = req.user as User;
    const now = Date.now();
    const windowMs = 60_000;
    const maxAttempts = 5;
    let entry = switchAttempts.get(user.id);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 1, windowStart: now };
      switchAttempts.set(user.id, entry);
      return res.json({ allowed: true, attemptsRemaining: maxAttempts - 1 });
    }
    entry.count++;
    if (entry.count > maxAttempts) {
      return res.json({ allowed: false, requires2fa: true, message: "Too many switch attempts. Please verify your identity." });
    }
    return res.json({ allowed: true, attemptsRemaining: maxAttempts - entry.count });
  });

  app.post("/api/me/switch/verify-email", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      if (!user.email) return res.status(400).json({ message: "No email on account" });
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const now = Date.now();
      if (!switchAttempts.has(user.id)) switchAttempts.set(user.id, { count: 6, windowStart: now });
      try {
        const body = `Your Cortardo security verification code is:\n\n${code}\n\nThis code expires in 5 minutes.\n\nIf you didn't request this, please secure your account immediately.`;
        const secureName = process.env.RESEND_FROM_NAME || process.env.BREVO_SENDER_NAME || "Cortardo";
        await sendMailFromSmtp(
          {
            host: process.env.SMTP_HOST || "localhost",
            port: Number(process.env.SMTP_PORT) || 25,
            user: process.env.SMTP_USER || "",
            pass: process.env.SMTP_PASS || "",
          },
          { from: `${secureName} Security <noreply@cortardo.com>`, to: user.email, subject: "Your verification code for inbox switch", text: body },
        );
        const verifyEntry = switchAttempts.get(user.id) ?? { count: 6, windowStart: now };
        (verifyEntry as any).verifyCode = code;
        (verifyEntry as any).verifyExpires = now + 300_000;
        switchAttempts.set(user.id, verifyEntry);
        return res.json({ sent: true, message: "Verification code sent to your email." });
      } catch (emailErr) {
        console.error("[switch-verify] failed to send email:", emailErr);
        return res.status(500).json({ message: "Failed to send verification email" });
      }
    } catch (err) {
      return res.status(500).json({ message: "Failed to send verification code" });
    }
  });

  app.post("/api/me/switch/verify-code", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const body = z.object({ code: z.string().length(6) }).safeParse(req.body);
      if (!body.success) return res.status(400).json({ message: "Invalid code" });
      const entry = switchAttempts.get(user.id);
      if (!entry) return res.status(400).json({ message: "No verification code sent. Request a new one." });
      const ve = entry as any;
      if (!ve.verifyCode || !ve.verifyExpires) return res.status(400).json({ message: "No verification code sent." });
      if (Date.now() > ve.verifyExpires) return res.status(400).json({ message: "Verification code expired." });
      if (ve.verifyCode !== body.data.code) return res.status(400).json({ message: "Incorrect verification code." });
      switchAttempts.delete(user.id);
      return res.json({ verified: true });
    } catch (err) {
      return res.status(500).json({ message: "Verification failed" });
    }
  });

  // ── OAuth state parameter helper (CSRF protection for OAuth callbacks) ──
  function generateOAuthState(req: Request): string {
    const state = randomBytes(24).toString("hex");
    req.session.oauthState = state;
    return state;
  }

  function verifyOAuthState(req: Request, state: string | undefined | null): boolean {
    const expected = req.session.oauthState;
    req.session.oauthState = undefined;
    if (!expected || !state) return false;
    try {
      return Buffer.from(state).length === Buffer.from(expected).length &&
        state.length === expected.length &&
        state === expected;
    } catch {
      return false;
    }
  }

  // GitHub OAuth
  app.get("/auth/github", authRateLimiter, (req, res, next) => {
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
      return res.redirect("/auth/login?error=github_not_configured");
    }
    const state = generateOAuthState(req);
    passport.authenticate("github", { scope: ["read:user", "user:email"], state })(req, res, next);
  });

  const oauthCallbackRedirect = async (req: Request, res: Response) => {
    if (!req.user) return res.redirect("/auth/login?error=oauth_failed");
    const user = req.user as User;
    trackUserSession(req, user);
    const flow = req.session.oauthFlow;
    req.session.oauthFlow = undefined;
    if (flow?.isNewUser) {
      return res.redirect("/auth/onboarding");
    }
    const session = await buildOnboardingSession(user).catch(() => null);
    if (session && session.currentStep !== "complete") {
      return res.redirect("/auth/onboarding");
    }
    return res.redirect("/home/mail");
  };

  const githubCallbackHandler = [
    authRateLimiter,
    (req: Request, res: Response, next: NextFunction) => {
      if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
        return res.redirect("/auth/login?error=github_not_configured");
      }
      if (!verifyOAuthState(req, req.query.state as string)) {
        return res.redirect("/auth/login?error=oauth_state_mismatch");
      }
      next();
    },
    (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate("github", { failureRedirect: "/auth/login?error=github_failed" })(req, res, next);
    },
    oauthCallbackRedirect,
  ] as const;

  app.get("/auth/callback", ...githubCallbackHandler);
  app.get("/auth/github/callback", ...githubCallbackHandler);

  // Google OAuth
  app.get("/auth/google", authRateLimiter, (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect("/auth/login?error=google_not_configured");
    }
    const state = generateOAuthState(req);
    passport.authenticate("google", { scope: ["email", "profile"], state })(req, res, next);
  });

  app.get(
    "/auth/google/callback",
    authRateLimiter,
    (req: Request, res: Response, next: NextFunction) => {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.redirect("/auth/login?error=google_not_configured");
      }
      if (!verifyOAuthState(req, req.query.state as string)) {
        return res.redirect("/auth/login?error=oauth_state_mismatch");
      }
      next();
    },
    (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate("google", { failureRedirect: "/auth/login?error=google_failed" })(req, res, next);
    },
    oauthCallbackRedirect,
  );

  app.post("/api/me/link-password", authRateLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });
      const payload = z.object({ password: z.string().min(8) }).parse(req.body);
      if (!fullUser.password.startsWith("oauth_")) return res.status(400).json({ message: "A password is already set for this account." });
      const hashed = await hashPassword(payload.password);
      await storage.updateUser(user.id, { password: hashed });
      return res.status(200).json({ message: "Password linked successfully." });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to link password" });
    }
  });

  // User profile
  app.get("/api/me", authRateLimiter, async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ message: "Not authenticated" });
    const user = req.user as User;
    const fullUser = await storage.getUserById(user.id);
    if (!fullUser) return res.status(401).json({ message: "Not authenticated" });
    const meSub = await storage.getSubscription(user.id);
    // Refresh session activity
    if (req.sessionID) {
      storage.getUserSessionBySessionId(req.sessionID).then((s) => {
        if (s) storage.updateUserSession(s.id, { lastActiveAt: new Date() }).catch(() => {});
      }).catch(() => {});
    }
    return res.status(200).json({ ...safeUserPayload(fullUser), hasPassword: !fullUser.password.startsWith("oauth_"), onboardingStep: fullUser.onboardingStep ?? 0, subscription: meSub ?? null });
  });

  app.get("/api/config", (req, res) => {
    return res.json({ publicUrl: getPublicUrl(req), trackerBaseUrl: getPublicUrl(req) });
  });

  // ── Session Management ──────────────────────────────────────────────────

  app.get("/api/me/sessions", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const sessions = await storage.listUserSessions(user.id);
      const safeSessions = sessions.map((s) => ({
        id: s.id,
        browser: s.browser,
        os: s.os,
        device: s.device,
        ipAddress: s.ipAddress,
        location: s.location,
        isCurrent: s.sessionId === req.sessionID,
        lastActiveAt: s.lastActiveAt,
        createdAt: s.createdAt,
      }));
      return res.json({ sessions: safeSessions });
    } catch (err) {
      console.error("[sessions] list failed:", err);
      return res.status(500).json({ message: "Failed to list sessions" });
    }
  });

  app.delete("/api/me/sessions/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const sessionId = String(req.params.id);
      const allSessions = await storage.listUserSessions(user.id);
      const target = allSessions.find((s) => s.id === sessionId);
      if (!target) return res.status(404).json({ message: "Session not found" });
      if (target.sessionId === req.sessionID) {
        return res.status(400).json({ message: "Cannot revoke your current session. Use sign out instead." });
      }
      await storage.deleteUserSession(sessionId);
      return res.json({ success: true });
    } catch (err) {
      console.error("[sessions] revoke failed:", err);
      return res.status(500).json({ message: "Failed to revoke session" });
    }
  });

  app.post("/api/me/sessions/revoke-all", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      await storage.deleteUserSessionsByUserId(user.id, req.sessionID);
      return res.json({ success: true, message: "All other sessions revoked" });
    } catch (err) {
      console.error("[sessions] revoke-all failed:", err);
      return res.status(500).json({ message: "Failed to revoke sessions" });
    }
  });

  registerOnboardingRoutes(app, { requireAuth });
}
