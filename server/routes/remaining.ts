import type { Express, Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { randomBytes, randomInt, timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import path from "path";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { hashPassword, comparePasswords } from "../auth";
import { sendEmailChangeVerification, sendVerificationEmail, sendPasswordResetEmail, sendAccountDeletionEmail, sendSubscriptionUpdateEmail, sendWorkspaceInviteEmail, sendMemberAcceptedInviteEmail, sendMemberDeclinedInviteEmail, sendMemberLeftWorkspaceEmail, sendMemberRemovedEmail } from "../email";
import { uploadBlob, deleteBlob } from "../blob-storage";
import { generateUniqueWorkspaceSlug } from "../lib/workspace-slug";
import * as creditService from "../lib/credit-service";

import {
  signupSchema, loginSchema, verifyEmailSchema, resendVerificationSchema,
  updateProfileSchema, changePasswordSchema, deleteAccountSchema,
  createWorkspaceSchema, updateWorkspaceSchema, inviteWorkspaceMemberSchema,
  updateWorkspaceMemberSchema, bulkInviteMemberSchema,
  PLAN_LIMITS,
  type PlanTier, type BillingPeriod, type User,
  type WorkspaceMember,
  workspaces, users,
} from "@shared/schema";
import {
  requireAuth, upload, audit,
  apiRateLimiter, authRateLimiter, publicRateLimiter, publicStrictRateLimiter,
  safeUserPayload, createLoginChallenge, getActiveChallenge,
  checkAndNotifyNewDevice, trackVerificationAttempt, clearVerificationAttempts,
  getPublicUrl, extractClientIp, checkPlanLimit,
} from "./helpers";

const STRIPE_API_VERSION = "2026-02-25.clover" as const;
type PaidPlan = "free" | "pro" | "team" | "enterprise";
const CURRENCIES = ["usd", "gbp", "eur"] as const;
type Currency = (typeof CURRENCIES)[number];

// Env var name variants to try per plan, in priority order.
// New naming first (HOBBY/PROFESSIONAL/ENTERPRISE), legacy fallbacks (PRO/TEAM).
const PRICE_ENV_NAMES: Record<Exclude<PaidPlan, "free">, string[]> = {
  pro: ["HOBBY", "PRO"],
  team: ["PROFESSIONAL", "TEAM"],
  enterprise: ["ENTERPRISE"],
};

function stripePriceFor(plan: PaidPlan, billingPeriod: BillingPeriod = "monthly", currency: Currency = "usd"): string | null {
  const names = PRICE_ENV_NAMES[plan as Exclude<PaidPlan, "free">] ?? [];
  const cur = [currency.toUpperCase()];
  const combos = billingPeriod === "annual"
    ? [[...cur, "ANNUAL"], ["ANNUAL", ...cur], ["ANNUAL"]]
    : [cur, []];
  for (const name of names) {
    for (const combo of combos) {
      const value = process.env[`STRIPE_PRICE_${name}${combo.length ? `_${combo.join("_")}` : ""}`];
      if (value) return value;
    }
  }
  return null;
}

async function notifyWorkspaceAdminsAndOwners(
  workspaceId: string,
  workspaceName: string,
  member: WorkspaceMember,
  event: "accepted" | "declined" | "left" | "removed",
  extra?: { removedBy?: string; excludeMemberId?: string },
): Promise<void> {
  try {
    const members = await storage.listWorkspaceMembers(workspaceId);
    const recipients = members.filter((m) => m.status === "active" && ["owner", "admin"].includes(m.role));
    const memberLabel = member.displayName || member.email.split("@")[0] || "A team member";
    for (const recipient of recipients) {
      if (recipient.id === member.id) continue;
      if (extra?.excludeMemberId && recipient.id === extra.excludeMemberId) continue;
      const recipientName = recipient.displayName || undefined;
      switch (event) {
        case "accepted":
          await sendMemberAcceptedInviteEmail(recipient.email, recipientName, workspaceName, memberLabel, member.email, member.role);
          break;
        case "declined":
          await sendMemberDeclinedInviteEmail(recipient.email, recipientName, workspaceName, memberLabel, member.email);
          break;
        case "left":
          await sendMemberLeftWorkspaceEmail(recipient.email, recipientName, workspaceName, memberLabel, member.email, member.role);
          break;
        case "removed":
          await sendMemberRemovedEmail(recipient.email, recipientName, workspaceName, memberLabel, member.email, extra?.removedBy || "An admin");
          break;
      }
    }
  } catch (err) {
    console.error("[workspaces] failed to notify admins/owners:", err);
  }
}

function planInfoFromPriceId(priceId: string | undefined | null): { plan: PaidPlan; billingPeriod: BillingPeriod } | null {
  if (!priceId) return null;
  for (const plan of ["free", "pro", "team", "enterprise"] as const) {
    for (const bp of ["monthly", "annual"] as const) {
      for (const currency of CURRENCIES) {
        if (priceId === stripePriceFor(plan, bp, currency)) return { plan, billingPeriod: bp };
      }
    }
  }
  return null;
}

export function registerRemainingRoutes(app: Express): void {
  // ── Integrations ───────────────────────────────────────────────────────────
  app.get("/api/integrations", apiRateLimiter, requireAuth, async (req, res) => {
    const user = req.user as User;
    const integrations = await storage.listIntegrations(user.id);
    return res.json(integrations.map((i) => ({
      ...i,
      apiKey: i.apiKey.slice(0, 4) + "••••••••••••",
    })));
  });

  const integrationSchema = z.object({
    provider: z.enum(["stripe", "paddle", "lemonsqueezy"]),
    apiKey: z.string().trim().min(10, "API key is too short"),
  });

  app.post("/api/integrations", apiRateLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const input = integrationSchema.parse(req.body);
      if (input.provider === "stripe") {
        if (!/^rk_(live|test)_/i.test(input.apiKey)) {
          return res.status(400).json({ message: "Use a Stripe restricted key (rk_live_… or rk_test_…) with read access." });
        }
        const stripe = new Stripe(input.apiKey, { apiVersion: "2026-02-25.clover" });
        try {
          await Promise.all([
            stripe.charges.list({ limit: 1 }),
            stripe.refunds.list({ limit: 1 }),
          ]);
        } catch {
          return res.status(400).json({ message: "Invalid Stripe key or missing read permissions: charges, refunds." });
        }
      }
      const integration = await storage.upsertIntegration(user.id, input.provider, input.apiKey);
      return res.status(201).json({ ...integration, apiKey: integration.apiKey.slice(0, 4) + "••••••••••••" });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to save integration" });
    }
  });

  app.delete("/api/integrations/:provider", apiRateLimiter, requireAuth, async (req, res) => {
    const user = req.user as User;
    const provider = String(req.params.provider);
    if (!["stripe", "paddle", "lemonsqueezy"].includes(provider)) return res.status(400).json({ message: "Invalid provider" });
    await storage.deleteIntegration(user.id, provider);
    return res.status(200).json({ message: "Disconnected" });
  });

  async function getRevenueData(provider: "stripe" | "paddle" | "lemonsqueezy", userId: string) {
    const integrations = await storage.listIntegrations(userId);
    const integration = integrations.find((i) => i.provider === provider);
    if (!integration) throw new Error("Integration not connected");
    if (provider === "stripe") {
      const stripe = new Stripe(integration.apiKey, { apiVersion: "2026-02-25.clover" });
      const charges = await stripe.charges.list({ limit: 100 });
      const subscriptions = await stripe.subscriptions.list({ limit: 100, status: "active" }).catch(() => ({ data: [] }));
      const customers = await stripe.customers.list({ limit: 100 }).catch(() => ({ data: [] }));
      const totalRevenue = charges.data.filter((c) => c.paid && !c.refunded).reduce((sum, c) => sum + c.amount, 0) / 100;
      return {
        provider: "stripe" as const, totalRevenue, currency: charges.data[0]?.currency?.toUpperCase() ?? "USD",
        activeSubscriptions: subscriptions.data.length, totalCustomers: customers.data.length,
        recentCharges: charges.data.slice(0, 5).map((c) => ({ amount: c.amount / 100, currency: c.currency.toUpperCase(), description: c.description ?? "Payment", date: new Date(c.created * 1000).toISOString(), status: c.status })),
      };
    }
    if (provider === "lemonsqueezy") {
      const response = await fetch("https://api.lemonsqueezy.com/v1/orders?filter[status]=paid", {
        headers: { Authorization: `Bearer ${integration.apiKey}`, Accept: "application/vnd.api+json" },
      });
      if (!response.ok) throw new Error("Lemon Squeezy API error");
      const data = await response.json() as { data?: Array<{ attributes?: { total_usd?: number; created_at?: string; status?: string; first_order_item?: { product_name?: string } } }> };
      const orders = data.data ?? [];
      return { provider: "lemonsqueezy" as const, totalRevenue: orders.reduce((sum, o) => sum + (o.attributes?.total_usd ?? 0), 0) / 100, currency: "USD", activeSubscriptions: 0, recentCharges: orders.slice(0, 5).map((o) => ({ amount: (o.attributes?.total_usd ?? 0) / 100, currency: "USD", description: o.attributes?.first_order_item?.product_name ?? "Order", date: o.attributes?.created_at ?? new Date().toISOString(), status: o.attributes?.status ?? "paid" })) };
    }
    const response = await fetch("https://api.paddle.com/transactions?status=completed&per_page=100", {
      headers: { Authorization: `Bearer ${integration.apiKey}`, "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error("Paddle API error");
    const data = await response.json() as { data?: Array<{ details?: { totals?: { total?: string }; line_items?: Array<{ price?: { description?: string } }> }; created_at?: string; status?: string }> };
    const transactions = data.data ?? [];
    return { provider: "paddle" as const, totalRevenue: transactions.reduce((sum, t) => sum + parseFloat(t.details?.totals?.total ?? "0"), 0), currency: "USD", activeSubscriptions: 0, recentCharges: transactions.slice(0, 5).map((t) => ({ amount: parseFloat(t.details?.totals?.total ?? "0"), currency: "USD", description: t.details?.line_items?.[0]?.price?.description ?? "Transaction", date: t.created_at ?? new Date().toISOString(), status: t.status ?? "completed" })) };
  }

  app.get("/api/integrations/:provider/revenue", apiRateLimiter, requireAuth, async (req, res) => {
    const user = req.user as User;
    const provider = String(req.params.provider) as "stripe" | "paddle" | "lemonsqueezy";
    if (!["stripe", "paddle", "lemonsqueezy"].includes(provider)) return res.status(400).json({ message: "Unsupported provider" });
    try {
      return res.json(await getRevenueData(provider, user.id));
    } catch {
      return res.status(502).json({ message: `Failed to fetch revenue from ${provider}` });
    }
  });

  // ── Stripe subscription checkout / change plan ─────────────────────────────
  app.post("/api/billing/checkout", authRateLimiter, requireAuth, async (req, res) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) return res.status(503).json({ message: "Billing not configured" });
    try {
      const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
      const user = req.user as User;
      const { plan, billingPeriod, currency } = z.object({
        plan: z.enum(["free", "pro", "team", "enterprise"]),
        billingPeriod: z.enum(["monthly", "annual"]).optional().default("monthly"),
        currency: z.enum(CURRENCIES).optional().default("usd"),
      }).parse(req.body);
      if (plan === "free") return res.status(400).json({ message: "Free plan cannot be purchased" });
      const priceId = stripePriceFor(plan, billingPeriod, currency);
      if (!priceId) return res.status(400).json({ message: `Plan "${plan}" is not configured for ${currency.toUpperCase()}` });
      try {
        await stripe.prices.retrieve(priceId);
      } catch {
        return res.status(400).json({ message: `Plan "${plan}" price for ${currency.toUpperCase()} is not configured correctly. Please contact support.` });
      }
      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });
      let sub = await storage.getSubscription(user.id);
      let customerId = sub?.stripeCustomerId ?? null;
      if (customerId) {
        try { const c = await stripe.customers.retrieve(customerId); if ((c as Stripe.DeletedCustomer).deleted) customerId = null; } catch { customerId = null; }
      }
      if (!customerId) {
        const created = await stripe.customers.create({ email: fullUser.email, name: fullUser.displayName ?? fullUser.username, metadata: { userId: String(fullUser.id) } });
        customerId = created.id;
        sub = await storage.createSubscription(fullUser.id, { stripeCustomerId: customerId });
      }
      const existingSubs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
      const liveSubs = existingSubs.data.filter((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due" || s.status === "unpaid").sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
      const liveSub = liveSubs[0] ?? null;
      for (const extra of liveSubs.slice(1)) { try { await stripe.subscriptions.cancel(extra.id); } catch {} }
      if (liveSub) {
        const currentItem = liveSub.items.data[0];
        if (!currentItem?.id) return res.status(409).json({ message: "Subscription is missing billable items. Please contact support." });
        if (currentItem?.price?.id === priceId && !liveSub.cancel_at_period_end) return res.status(400).json({ message: "You are already on this plan" });
        const subCurrency = liveSub.currency ?? "usd";
        if (subCurrency === currency) {
          const items = [{ id: currentItem.id, price: priceId, quantity: currentItem.quantity ?? 1 }, ...liveSub.items.data.slice(1).map((item) => ({ id: item.id, deleted: true }))] as Stripe.SubscriptionUpdateParams.Item[];
          const updatedSub = await stripe.subscriptions.update(liveSub.id, { items, proration_behavior: "create_prorations", cancel_at_period_end: false });
          const renewsAt = (updatedSub as unknown as { current_period_end?: number }).current_period_end;
          await storage.updateSubscription(fullUser.id, {
            stripeCustomerId: customerId, stripeSubscriptionId: updatedSub.id,
            plan, billingPeriod, subscriptionStatus: updatedSub.status,
            cancelAtPeriodEnd: false, planRenewsAt: renewsAt ? new Date(renewsAt * 1000) : null,
          });
          return res.json({ ok: true, message: `Switched to the ${plan} plan` });
        }
      }
      sub = await storage.updateSubscription(fullUser.id, { billingPeriod });
      const session = await stripe.checkout.sessions.create({ mode: "subscription", payment_method_types: ["card"], allow_promotion_codes: true, currency, line_items: [{ price: priceId, quantity: 1 }], customer: customerId, success_url: `${getPublicUrl(req)}/account?billing=success&plan=${plan}`, cancel_url: `${getPublicUrl(req)}/account?billing=cancelled`, metadata: { userId: String(fullUser.id), plan, currency }, subscription_data: { metadata: { userId: String(fullUser.id), plan, currency } } });
      return res.json({ url: session.url });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[billing/checkout] error:", err);
      return res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  app.post("/api/billing/cancel", authRateLimiter, requireAuth, async (req, res) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) return res.status(503).json({ message: "Billing not configured" });
    try {
      const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
      const user = req.user as User;
      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });
      const sub = await storage.getSubscription(user.id);
      if (!sub?.stripeCustomerId) return res.status(400).json({ message: "No active subscription" });
      const { immediately } = z.object({ immediately: z.boolean().optional() }).parse(req.body ?? {});
      const subs = await stripe.subscriptions.list({ customer: sub.stripeCustomerId, status: "all", limit: 100 });
      const live = subs.data.filter((s) => s.status !== "canceled" && s.status !== "incomplete_expired");
      if (live.length === 0) {
        await storage.updateSubscription(fullUser.id, { plan: "free", stripeSubscriptionId: null, subscriptionStatus: "canceled", cancelAtPeriodEnd: false, planRenewsAt: null });
        return res.json({ ok: true, cancelAtPeriodEnd: false });
      }
      let cancelAtPeriodEnd = false;
      for (const s of live) {
        if (immediately) { await stripe.subscriptions.cancel(s.id); } else { await stripe.subscriptions.update(s.id, { cancel_at_period_end: true }); cancelAtPeriodEnd = true; }
      }
      const latest = live[live.length - 1];
      const renewsAt = (latest as unknown as { current_period_end?: number }).current_period_end;
      await storage.updateSubscription(fullUser.id, { subscriptionStatus: "canceled", cancelAtPeriodEnd, planRenewsAt: renewsAt ? new Date(renewsAt * 1000) : null, ...(immediately ? { plan: "free", stripeSubscriptionId: null } : {}) });
      return res.json({ ok: true, cancelAtPeriodEnd });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[billing/cancel] error:", err);
      return res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  app.get("/api/me/plan", requireAuth, async (req, res) => {
    const user = req.user as User;
    const sub = await storage.getSubscription(user.id);
    const plan = (sub?.plan as PlanTier) || "free";
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const usageRec = await storage.getUsage(user.id);
    return res.json({
      plan, status: sub?.subscriptionStatus ?? null, cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      billingPeriod: sub?.billingPeriod ?? "monthly", renewsAt: sub?.planRenewsAt ? sub.planRenewsAt.toISOString() : null,
      limits, usage: { storageUsed: usageRec.storageUsed, projectsCount: usageRec.projectsCount, designFilesCount: usageRec.designFilesCount, versionCount: usageRec.versionCount, componentCount: usageRec.componentCount },
    });
  });

  app.get("/api/me/export", requireAuth, async (req, res) => {
    const user = req.user as User;
    const fullUser = await storage.getUserById(user.id);
    if (!fullUser) return res.status(404).json({ message: "User not found" });
    const sub = await storage.getSubscription(user.id);
    const userWorkspaces = await storage.listWorkspaces(fullUser.id);
    const exportedAt = new Date().toISOString();
    const payload = {
      exportedAt,
      account: { id: fullUser.id, username: fullUser.username, displayName: fullUser.displayName, email: fullUser.email, emailVerified: fullUser.emailVerified, pendingEmail: fullUser.pendingEmail, createdAt: fullUser.createdAt ? fullUser.createdAt.toISOString() : null },
      billing: { plan: sub?.plan ?? "free", subscriptionStatus: sub?.subscriptionStatus ?? null, cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false, planRenewsAt: sub?.planRenewsAt ? sub.planRenewsAt.toISOString() : null },
      notifications: { newsletterSubscribed: fullUser.newsletterSubscribed, transactionalEmails: true },
      workspaces: userWorkspaces.map((w) => ({ id: w.id, name: w.name, createdAt: w.createdAt ? w.createdAt.toISOString() : null })),
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"cortardo-account-export-${exportedAt.slice(0, 10)}.json\"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  });

  // ── Spaces (legacy — migrated to design tool, returns empty set) ────────────
  app.get("/api/spaces", requireAuth, async (_req, res) => {
    return res.json([]);
  });

  // ── Workspaces ─────────────────────────────────────────────────────────────
  app.get("/api/workspaces", requireAuth, async (req, res) => {
    const user = req.user as User;
    return res.json(await storage.listWorkspaces(user.id));
  });

  app.post("/api/workspaces", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const input = createWorkspaceSchema.parse(req.body);
      const workspace = await storage.createWorkspace(user.id, {
        ...input,
        slug: await generateUniqueWorkspaceSlug(input.name),
      });
      await storage.upsertOnboardingSession(user.id, { currentStep: "finalizing", workspaceStatus: "complete", workspaceId: workspace.id, workspaceName: workspace.name });
      return res.status(201).json({ ...workspace, role: "owner" });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to create workspace" });
    }
  });

  app.post("/api/workspaces/logo", requireAuth, upload.single("logo"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "Logo image is required" });
      const { url: logoUrl } = await uploadBlob({ pathname: `workspace-logos/${Date.now()}${path.extname(req.file.originalname) || ".png"}`, body: req.file.buffer, contentType: req.file.mimetype });
      return res.json({ logoUrl });
    } catch { return res.status(500).json({ message: "Failed to upload logo" }); }
  });

  app.post("/api/workspaces/:workspaceId/logo", requireAuth, upload.single("logo"), async (req, res) => {
    try {
      const user = req.user as User;
      const workspaceId = String(req.params.workspaceId);
      const workspace = await storage.getWorkspaceById(workspaceId);
      if (!workspace) return res.status(404).json({ message: "Workspace not found" });
      const access = await storage.canAccessWorkspace(user.id, workspaceId);
      if (!access.allowed || !["owner", "editor"].includes(access.role ?? "")) return res.status(403).json({ message: "Not authorized" });
      if (!req.file) return res.status(400).json({ message: "Logo image is required" });
      const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
      const filename = `workspace-logos/ws-${workspaceId}-${Date.now()}${ext}`;
      if (workspace.logoUrl) await deleteBlob(workspace.logoUrl);
      const { url: logoUrl } = await uploadBlob({ pathname: filename, body: req.file.buffer, contentType: req.file.mimetype });
      await storage.updateWorkspace(workspaceId, { logoUrl });
      return res.json({ logoUrl });
    } catch { return res.status(500).json({ message: "Failed to upload logo" }); }
  });

  app.patch("/api/workspaces/:workspaceId", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const workspaceId = String(req.params.workspaceId);
      const workspace = await storage.getWorkspaceById(workspaceId);
      if (!workspace) return res.status(404).json({ message: "Workspace not found" });
      const access = await storage.canAccessWorkspace(user.id, workspaceId);
      if (!access.allowed || !["owner", "editor"].includes(access.role ?? "")) return res.status(403).json({ message: "Not authorized" });
      const updated = await storage.updateWorkspace(workspace.id, updateWorkspaceSchema.parse(req.body));
      return res.json({ ...updated, role: access.role });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to update workspace" });
    }
  });

  app.delete("/api/workspaces/:workspaceId", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const workspaceId = String(req.params.workspaceId);
      const workspace = await storage.getWorkspaceById(workspaceId);
      if (!workspace || workspace.ownerId !== user.id) return res.status(404).json({ message: "Workspace not found" });
      await storage.deleteWorkspace(workspaceId);
      return res.json({ ok: true });
    } catch { return res.status(500).json({ message: "Failed to delete workspace" }); }
  });

  // ── Workspace Members ──────────────────────────────────────────────────────
  app.get("/api/workspaces/:workspaceId/members", requireAuth, async (req, res) => {
    const user = req.user as User;
    const workspaceId = String(req.params.workspaceId);
    const access = await storage.canAccessWorkspace(user.id, workspaceId);
    if (!access.allowed) return res.status(403).json({ message: "Not authorized" });
    return res.json(await storage.listWorkspaceMembers(workspaceId));
  });

  app.post("/api/workspaces/:workspaceId/members", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const workspaceId = String(req.params.workspaceId);
      const workspace = await storage.getWorkspaceById(workspaceId);
      if (!workspace) return res.status(404).json({ message: "Workspace not found" });
      const access = await storage.canAccessWorkspace(user.id, workspaceId);
      if (!access.allowed || !["owner", "editor"].includes(access.role ?? "")) return res.status(403).json({ message: "Not authorized" });
      const input = inviteWorkspaceMemberSchema.parse(req.body);
      const existing = await storage.getWorkspaceMemberByEmail(workspaceId, input.email);
      if (existing) return res.status(409).json({ message: "This person is already a member or has a pending invite." });
      const token = randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const invitedUser = await storage.getUserByEmail(input.email);
      const member = await storage.createWorkspaceMember(workspaceId, { email: input.email, role: input.role, userId: invitedUser?.id, inviteToken: token, inviteExpiry: expiry, status: invitedUser ? "active" : "pending" });
      const inviteUrl = `${getPublicUrl(req)}/invite/${token}`;
      const invitedByName = (user as any).displayName || user.email || "Someone";
      sendWorkspaceInviteEmail(input.email, invitedByName, workspace.name, inviteUrl).catch((err) => console.error("[workspaces] failed to send invite email:", err));
      return res.status(201).json({ ...member, inviteUrl });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to invite member" });
    }
  });

  app.patch("/api/workspaces/:workspaceId/members/:memberId", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const { workspaceId, memberId } = req.params as { workspaceId: string; memberId: string };
      const access = await storage.canAccessWorkspace(user.id, workspaceId);
      if (!access.allowed || !["owner", "editor"].includes(access.role ?? "")) return res.status(403).json({ message: "Not authorized" });
      const member = await storage.getWorkspaceMember(memberId);
      if (!member || member.workspaceId !== workspaceId) return res.status(404).json({ message: "Member not found" });
      if (member.role === "owner") return res.status(403).json({ message: "Cannot change the owner's role" });
      const updated = await storage.updateWorkspaceMember(memberId, updateWorkspaceMemberSchema.parse(req.body));
      return res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to update member" });
    }
  });

  app.delete("/api/workspaces/:workspaceId/members/:memberId", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const { workspaceId, memberId } = req.params as { workspaceId: string; memberId: string };
      const access = await storage.canAccessWorkspace(user.id, workspaceId);
      if (!access.allowed || !["owner", "editor"].includes(access.role ?? "")) return res.status(403).json({ message: "Not authorized" });
      const member = await storage.getWorkspaceMember(memberId);
      if (!member || member.workspaceId !== workspaceId) return res.status(404).json({ message: "Member not found" });
      if (member.role === "owner") return res.status(403).json({ message: "Cannot remove the workspace owner" });
      await storage.removeWorkspaceMember(memberId);
      const workspace = await storage.getWorkspaceById(workspaceId);
      const removedBy = user.displayName || user.email || "An admin";
      const actorMember = await storage.getWorkspaceMemberByUserId(workspaceId, user.id);
      if (workspace) {
        notifyWorkspaceAdminsAndOwners(workspace.id, workspace.name, member, "removed", { removedBy, excludeMemberId: actorMember?.id }).catch(() => {});
      }
      return res.json({ ok: true });
    } catch { return res.status(500).json({ message: "Failed to remove member" }); }
  });

  app.post("/api/workspaces/:workspaceId/leave", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const workspaceId = String(req.params.workspaceId);
      const workspace = await storage.getWorkspaceById(workspaceId);
      if (!workspace) return res.status(404).json({ message: "Workspace not found" });
      const access = await storage.canAccessWorkspace(user.id, workspaceId);
      if (!access.allowed) return res.status(403).json({ message: "Not authorized" });
      if (access.role === "owner") return res.status(403).json({ message: "The workspace owner cannot leave. Transfer ownership or delete the workspace instead." });
      const member = await storage.getWorkspaceMemberByUserId(workspaceId, user.id);
      if (!member) return res.status(404).json({ message: "Membership not found" });
      await storage.removeWorkspaceMember(member.id);
      notifyWorkspaceAdminsAndOwners(workspace.id, workspace.name, member, "left").catch(() => {});
      return res.json({ ok: true });
    } catch { return res.status(500).json({ message: "Failed to leave workspace" }); }
  });

  app.post("/api/workspaces/:workspaceId/members/bulk-invite", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const workspaceId = String(req.params.workspaceId);
      const workspace = await storage.getWorkspaceById(workspaceId);
      if (!workspace) return res.status(404).json({ message: "Workspace not found" });
      const access = await storage.canAccessWorkspace(user.id, workspaceId);
      if (!access.allowed || !["owner", "editor"].includes(access.role ?? "")) return res.status(403).json({ message: "Not authorized" });
      const parsed = bulkInviteMemberSchema.parse(req.body);
      const results: Array<{ email: string; success: boolean; error?: string }> = [];
      for (const email of parsed.emails) {
        try {
          const existing = await storage.getWorkspaceMemberByEmail(workspaceId, email);
          if (existing) { results.push({ email, success: false, error: "Already a member" }); continue; }
          const token = randomBytes(32).toString("hex");
          const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const invitedUser = await storage.getUserByEmail(email);
          await storage.createWorkspaceMember(workspaceId, { email, role: parsed.role, userId: invitedUser?.id, inviteToken: token, inviteExpiry: expiry, status: invitedUser ? "active" : "pending" });
          const inviteUrl = `${getPublicUrl(req)}/invite/${token}`;
          sendWorkspaceInviteEmail(email, (user as any).displayName || user.email!, workspace.name, inviteUrl).catch(() => {});
          results.push({ email, success: true });
        } catch (err) { results.push({ email, success: false, error: String(err) }); }
      }
      return res.json({ results, total: parsed.emails.length, succeeded: results.filter(r => r.success).length });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to bulk invite" });
    }
  });

  // ── Invite info ───────────────────────────────────────────────────────────
  app.get("/api/invites/:token", async (req, res) => {
    try {
      const token = String(req.params.token);
      const member = await storage.getWorkspaceMemberByToken(token);
      if (!member) return res.status(404).json({ message: "Invite not found or already used" });
      if (member.status === "declined") return res.status(410).json({ message: "Invite has been declined", declined: true });
      if (member.inviteExpiry && new Date(member.inviteExpiry) < new Date()) return res.status(410).json({ message: "Invite has expired" });
      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, member.workspaceId));
      if (!workspace) return res.status(404).json({ message: "Workspace not found" });
      return res.json({ workspaceName: workspace.name, role: member.role, status: member.status });
    } catch { return res.status(500).json({ message: "Failed to fetch invite" }); }
  });

  app.post("/api/invites/:token/accept", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const token = String(req.params.token);
      const member = await storage.getWorkspaceMemberByToken(token);
      if (!member) return res.status(404).json({ message: "Invite not found or already used" });
      if (member.status === "declined") return res.status(410).json({ message: "Invite has been declined" });
      if (member.inviteExpiry && new Date(member.inviteExpiry) < new Date()) return res.status(410).json({ message: "Invite has expired" });
      await storage.updateWorkspaceMember(member.id, { userId: user.id, status: "active", inviteToken: null, inviteExpiry: null });
      const workspace = await storage.getWorkspaceById(member.workspaceId);
      if (workspace) {
        const acceptedMember: WorkspaceMember = { ...member, userId: user.id, status: "active" };
        notifyWorkspaceAdminsAndOwners(workspace.id, workspace.name, acceptedMember, "accepted").catch(() => {});
      }
      return res.json({ ok: true, workspaceId: member.workspaceId });
    } catch { return res.status(500).json({ message: "Failed to accept invite" }); }
  });

  app.post("/api/invites/:token/decline", async (req, res) => {
    try {
      const token = String(req.params.token);
      const member = await storage.getWorkspaceMemberByToken(token);
      if (!member) return res.status(404).json({ message: "Invite not found or already used" });
      if (member.status === "declined") return res.status(410).json({ message: "Invite has been declined" });
      if (member.status === "active") return res.status(400).json({ message: "Invite has already been accepted" });
      if (member.inviteExpiry && new Date(member.inviteExpiry) < new Date()) return res.status(410).json({ message: "Invite has expired" });
      await storage.updateWorkspaceMember(member.id, { status: "declined" });
      const workspace = await storage.getWorkspaceById(member.workspaceId);
      if (workspace) {
        const declinedMember: WorkspaceMember = { ...member, status: "declined" };
        notifyWorkspaceAdminsAndOwners(workspace.id, workspace.name, declinedMember, "declined").catch(() => {});
      }
      return res.json({ ok: true });
    } catch { return res.status(500).json({ message: "Failed to decline invite" }); }
  });

  // ── Profile & account management ─────────────────────────────────────────
  app.put("/api/me", apiRateLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const input = updateProfileSchema.parse(req.body);
      const updateData: Parameters<typeof storage.updateUser>[1] = {};
      if (input.displayName !== undefined) updateData.displayName = input.displayName;
      if (input.avatarUrl !== undefined) updateData.avatarUrl = input.avatarUrl ?? undefined;
      if (input.theme !== undefined) updateData.theme = input.theme;
      if (input.email !== undefined && input.email !== user.email) {
        if ((user.emailChangeCount ?? 0) >= 2) return res.status(400).json({ message: "You can only change your email address twice." });
        const existing = await storage.getUserByEmail(input.email);
        if (existing && existing.id !== user.id) return res.status(400).json({ message: "Email already in use" });
        const pendingToken = randomBytes(32).toString("hex");
        const pendingExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        updateData.pendingEmail = input.email;
        updateData.pendingEmailToken = pendingToken;
        updateData.pendingEmailExpiry = pendingExpiry;
        sendEmailChangeVerification(input.email, pendingToken, getPublicUrl(req)).catch(() => {});
      }
      const updated = await storage.updateUser(user.id, updateData);
      if (input.displayName !== undefined) {
        await storage.upsertOnboardingSession(user.id, { currentStep: input.displayName?.trim() ? "workspace" : "profile_name", displayNameStatus: input.displayName?.trim() ? "complete" : "not_started" });
      }
      const { password: _p, emailVerificationToken: _t, emailVerificationExpiry: _e, pendingEmailToken: _pt, pendingEmailExpiry: _pe, ...safeUser } = updated;
      const emailChangePending = input.email !== undefined && input.email !== user.email;
      return res.status(200).json({ ...safeUser, emailChangePending });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.post("/api/me/avatar", requireAuth, upload.single("avatar"), async (req, res) => {
    try {
      const user = req.user as User;
      if (!req.file) return res.status(400).json({ message: "Avatar image is required" });
      const safeBasename = user.id.replace(/[^a-f0-9-]/gi, "");
      const ext = path.extname(req.file.originalname) || ".png";
      const filename = `avatars/${safeBasename}${ext}`;
      if (user.avatarUrl) await deleteBlob(user.avatarUrl);
      const { url: avatarUrl } = await uploadBlob({ pathname: filename, body: req.file.buffer, contentType: req.file.mimetype });
      const updated = await storage.updateUser(user.id, { avatarUrl });
      const { password: _p, emailVerificationToken: _t, emailVerificationExpiry: _e, pendingEmailToken: _pt, pendingEmailExpiry: _pe, ...safeUser } = updated;
      return res.json({ avatarUrl, user: safeUser });
    } catch { return res.status(500).json({ message: "Failed to upload avatar" }); }
  });

  app.get("/api/me/verify-email", async (req, res, next) => {
    const token = req.query.token as string;
    if (!token) return res.status(400).send("Missing token");
    const user = await storage.getUserByEmailVerificationToken(token);
    if (!user) return res.status(400).send("Invalid or expired verification link.");
    if (user.emailVerificationExpiry && user.emailVerificationExpiry < new Date()) return res.status(400).send("Verification link has expired. Please request a new one.");
    const verifiedUser = await storage.updateUser(user.id, { emailVerified: true, emailVerificationToken: null, emailVerificationExpiry: null });
    await storage.upsertOnboardingSession(user.id, { currentStep: user.displayName?.trim() ? "workspace" : "profile_name", emailVerificationStatus: "verified", displayNameStatus: user.displayName?.trim() ? "complete" : "not_started" });
    req.login(verifiedUser, (err) => { if (err) return next(err); return res.redirect("/auth/onboarding"); });
  });

  app.get("/api/me/verify-email-change", async (req, res) => {
    const token = req.query.token as string;
    if (!token) return res.status(400).send("Missing token");
    const user = await storage.getUserByPendingEmailToken(token);
    if (!user || !user.pendingEmail) return res.status(400).send("Invalid or expired link.");
    if (user.pendingEmailExpiry && user.pendingEmailExpiry < new Date()) return res.status(400).send("This link has expired.");
    const existing = await storage.getUserByEmail(user.pendingEmail);
    if (existing && existing.id !== user.id) return res.status(400).send("That email address is now in use by another account.");
    await storage.updateUser(user.id, { email: user.pendingEmail, emailVerified: true, emailChangeCount: (user.emailChangeCount ?? 0) + 1, pendingEmail: null, pendingEmailToken: null, pendingEmailExpiry: null });
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const stripeSub = await storage.getSubscription(user.id);
    if (stripeSecretKey && stripeSub?.stripeCustomerId) {
      const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
      stripe.customers.update(stripeSub.stripeCustomerId, { email: user.pendingEmail }).catch(() => {});
    }
    return res.redirect("/account?email-changed=1");
  });

  app.post("/api/me/resend-verification", authRateLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });
      if (fullUser.emailVerified && !fullUser.pendingEmail) return res.status(400).json({ message: "Email is already verified" });
      const token = randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const baseUrl = getPublicUrl(req);
      if (fullUser.pendingEmail) {
        await storage.updateUser(fullUser.id, { pendingEmailToken: token, pendingEmailExpiry: expiry });
        sendEmailChangeVerification(fullUser.pendingEmail, token, baseUrl);
      } else {
        await storage.updateUser(fullUser.id, { emailVerificationToken: token, emailVerificationExpiry: expiry });
        sendVerificationEmail(fullUser.email, token, baseUrl);
      }
      return res.status(200).json({ message: "Verification email sent" });
    } catch { return res.status(500).json({ message: "Unable to send verification email right now" }); }
  });

  app.put("/api/me/password", authRateLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const input = changePasswordSchema.parse(req.body);
      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });
      if (fullUser.password.startsWith("oauth_")) return res.status(400).json({ message: "OAuth accounts cannot set a password this way." });
      const valid = await comparePasswords(input.currentPassword, fullUser.password);
      if (!valid) return res.status(400).json({ message: "Current password is incorrect" });
      const hashed = await hashPassword(input.newPassword);
      await storage.updateUser(user.id, { password: hashed });
      return res.status(200).json({ message: "Password updated successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to update password" });
    }
  });

  app.post("/api/billing/success", requireAuth, async (req, res) => {
    try { z.object({ plan: z.string().optional() }).parse(req.body); } catch {}
    return res.json({ ok: true });
  });

  app.get("/api/me/notifications", requireAuth, async (req, res) => {
    const user = req.user as User;
    const full = await storage.getUserById(user.id);
    return res.json({ newsletter: full?.newsletterSubscribed ?? true, productUpdates: full?.productUpdates ?? true, securityAlerts: full?.securityAlerts ?? true, billingUpdates: full?.billingUpdates ?? true });
  });

  app.put("/api/me/notifications", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const body = z.object({ newsletter: z.boolean().optional(), productUpdates: z.boolean().optional(), securityAlerts: z.boolean().optional(), billingUpdates: z.boolean().optional() }).parse(req.body);
      const update: Record<string, boolean> = {};
      if (body.newsletter !== undefined) update.newsletterSubscribed = body.newsletter;
      if (body.productUpdates !== undefined) update.productUpdates = body.productUpdates;
      if (body.securityAlerts !== undefined) update.securityAlerts = body.securityAlerts;
      if (body.billingUpdates !== undefined) update.billingUpdates = body.billingUpdates;
      await storage.updateUser(user.id, update as any);
      return res.json(body);
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }); return res.status(500).json({ message: "Failed to update preferences" }); }
  });

  app.put("/api/me/last-workspace", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.body);
      await db.update(users).set({ lastWorkspaceId: workspaceId }).where(eq(users.id, user.id));
      return res.json({ ok: true });
    } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }); return res.status(500).json({ message: "Failed to update" }); }
  });

  app.delete("/api/me", authRateLimiter, requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const input = deleteAccountSchema.parse(req.body);
      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });
      if (!fullUser.password.startsWith("oauth_")) {
        const valid = await comparePasswords(input.password, fullUser.password);
        if (!valid) return res.status(400).json({ message: "Password is incorrect" });
      }
      const userEmail = fullUser.email;
      const userDisplayName = fullUser.displayName ?? fullUser.username;
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      const stripeSub = await storage.getSubscription(user.id);
      if (stripeSecretKey && stripeSub?.stripeCustomerId) {
        try {
          const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
          const subs = await stripe.subscriptions.list({ customer: stripeSub.stripeCustomerId, status: "all", limit: 100 });
          for (const s of subs.data.filter((s) => s.status !== "canceled" && s.status !== "incomplete_expired")) await stripe.subscriptions.cancel(s.id);
          await stripe.customers.del(stripeSub.stripeCustomerId);
        } catch (e) {
          return res.status(503).json({ message: "Couldn't reach Stripe to cancel your subscription." });
        }
      }
      await storage.deleteUser(user.id);
      sendAccountDeletionEmail(userEmail, userDisplayName).catch(() => {});
      req.logout((err) => { if (err) return res.status(500).json({ message: "Account deleted but logout failed" }); req.session.destroy(() => { res.clearCookie("connect.sid"); return res.status(200).json({ message: "Account deleted" }); }); });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      return res.status(500).json({ message: "Failed to delete account" });
    }
  });

  app.post("/api/billing/portal", authRateLimiter, requireAuth, async (req, res) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) return res.status(503).json({ message: "Billing not configured" });
    try {
      const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
      const user = req.user as User;
      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });
      let sub = await storage.getSubscription(user.id);
      let customerId = sub?.stripeCustomerId ?? null;
      if (customerId) {
        try { const c = await stripe.customers.retrieve(customerId); if ((c as Stripe.DeletedCustomer).deleted) customerId = null; } catch { customerId = null; }
      }
      if (!customerId) {
        const customers = await stripe.customers.list({ email: fullUser.email, limit: 1 });
        customerId = customers.data[0]?.id ?? null;
      }
      if (!customerId) {
        const created = await stripe.customers.create({ email: fullUser.email, name: fullUser.displayName ?? fullUser.username, metadata: { userId: String(fullUser.id) } });
        customerId = created.id;
        await storage.createSubscription(fullUser.id, { stripeCustomerId: customerId });
      }
      const portalSession = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${getPublicUrl(req)}/account` });
      return res.json({ url: portalSession.url });
    } catch { return res.status(500).json({ message: "Failed to open billing portal" }); }
  });

  // ── Stripe webhook ────────────────────────────────────────────────────────
  app.post("/api/billing/webhook", async (req, res) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeSecretKey || !webhookSecret) return res.status(503).send("Billing not configured");
    const sig = req.headers["stripe-signature"];
    const raw = req.rawBody;
    if (!sig || !raw) return res.status(400).send("Missing signature");
    const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
    let event: Stripe.Event;
    try { event = stripe.webhooks.constructEvent(raw as Buffer, sig as string, webhookSecret); } catch { return res.status(400).json({ message: "Invalid webhook signature" }); }
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const metaType = session.metadata?.type;
          if (metaType === "credit_purchase") {
          const userId = session.metadata?.userId;
          const packId = session.metadata?.packId;
          const credits = Number(session.metadata?.credits) || 0;

            if (userId && credits > 0) {
              await creditService.addCredits(userId, credits, `Credit pack purchase: ${packId}`, {
                type: "purchase",
                stripeSessionId: session.id,
                packId,
              });
            }
            break;
          }
          let subscriptionId: string | null = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
          const userIdFromMeta = session.metadata?.userId ?? null;
          if (!subscriptionId) break;
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
          const customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer.id;
          let user = await storage.getUserByStripeCustomerId(customerId);
          if (!user && userIdFromMeta) user = await storage.getUserById(String(userIdFromMeta));
          if (!user) break;
          const priceId = stripeSub.items.data[0]?.price?.id;
          const priceInfo = planInfoFromPriceId(priceId);
          const isLive = stripeSub.status === "active" || stripeSub.status === "trialing" || stripeSub.status === "past_due";
          const renewsAt = (stripeSub as unknown as { current_period_end?: number }).current_period_end;
          const prevSub = await storage.getSubscription(user.id);
          await storage.updateSubscription(user.id, {
            stripeCustomerId: customerId, stripeSubscriptionId: isLive ? stripeSub.id : null,
            plan: isLive && priceInfo ? priceInfo.plan : "free",
            billingPeriod: isLive && priceInfo ? priceInfo.billingPeriod : "monthly",
            subscriptionStatus: stripeSub.status, planRenewsAt: renewsAt ? new Date(renewsAt * 1000) : null, cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
          });
          if (isLive) {
            const customerSubs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
            for (const s of customerSubs.data) {
              if (s.id === stripeSub.id) continue;
              if (s.status === "active" || s.status === "trialing" || s.status === "past_due" || s.status === "unpaid") {
                try { await stripe.subscriptions.cancel(s.id); } catch {}
              }
            }
          }
          if (isLive && user.email && priceInfo) {
            const planLabel = priceInfo.plan.charAt(0).toUpperCase() + priceInfo.plan.slice(1);
            const isNewSub = event.type === "checkout.session.completed" || !prevSub?.stripeSubscriptionId;
            const displayName = user.displayName ?? user.username ?? "";
            sendSubscriptionUpdateEmail(user.email, displayName, planLabel, isNewSub ? "new" : "updated").catch(() => {});
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const subscriptionId = sub.id;
          const userIdFromMeta = sub.metadata?.userId ?? null;
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
          const customerId = typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer.id;
          let user = await storage.getUserByStripeCustomerId(customerId);
          if (!user && userIdFromMeta) user = await storage.getUserById(String(userIdFromMeta));
          if (!user) break;
          const priceId = stripeSub.items.data[0]?.price?.id;
          const priceInfo = planInfoFromPriceId(priceId);
          const isLive = stripeSub.status === "active" || stripeSub.status === "trialing" || stripeSub.status === "past_due";
          const renewsAt = (stripeSub as unknown as { current_period_end?: number }).current_period_end;
          const prevSub = await storage.getSubscription(user.id);
          await storage.updateSubscription(user.id, {
            stripeCustomerId: customerId, stripeSubscriptionId: isLive ? stripeSub.id : null,
            plan: isLive && priceInfo ? priceInfo.plan : "free",
            billingPeriod: isLive && priceInfo ? priceInfo.billingPeriod : "monthly",
            subscriptionStatus: stripeSub.status, planRenewsAt: renewsAt ? new Date(renewsAt * 1000) : null, cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
          });
          if (isLive && user.email && priceInfo) {
            const planLabel = priceInfo.plan.charAt(0).toUpperCase() + priceInfo.plan.slice(1);
            const isNewSub = !prevSub?.stripeSubscriptionId;
            const displayName = user.displayName ?? user.username ?? "";
            sendSubscriptionUpdateEmail(user.email, displayName, planLabel, isNewSub ? "new" : "updated").catch(() => {});
          }
          break;
        }
        case "customer.subscription.deleted": {
          const deletedSub = event.data.object as Stripe.Subscription;
          const customerId = typeof deletedSub.customer === "string" ? deletedSub.customer : deletedSub.customer.id;
          const user = await storage.getUserByStripeCustomerId(customerId);
          if (!user) break;
          const existingSub = await storage.getSubscription(user.id);
          if (existingSub?.stripeSubscriptionId && existingSub.stripeSubscriptionId !== deletedSub.id) break;
          await storage.updateSubscription(user.id, { stripeSubscriptionId: null, plan: "free", billingPeriod: "monthly", subscriptionStatus: "canceled", planRenewsAt: null, cancelAtPeriodEnd: false });
          if (user.email) {
            const displayName = user.displayName ?? user.username ?? "";
            const prevPlanLabel = existingSub?.plan ? existingSub.plan.charAt(0).toUpperCase() + existingSub.plan.slice(1) : "Pro";
            sendSubscriptionUpdateEmail(user.email, displayName, prevPlanLabel, "cancelled").catch(() => {});
          }
          break;
        }
        default: break;
      }
      return res.json({ received: true });
    } catch { return res.status(500).send("webhook handler error"); }
  });

  // ── Notification routes (stubs) ──────────────────────────────────────────
  app.get("/api/notifications", requireAuth, async (_req, res) => res.json([]));
  app.post("/api/notifications/:notificationId/read", requireAuth, async (_req, res) => res.json({ success: true }));
  app.post("/api/notifications/read-all", requireAuth, async (_req, res) => res.json({ success: true }));
  app.delete("/api/notifications/:notificationId", requireAuth, async (_req, res) => res.json({ success: true }));

  // ── Credits ─────────────────────────────────────────────────────────────
  // 1 credit = $0.001 of API usage; packs are priced at a slight discount
  // off face value. `usd` is cents.
  const CREDIT_PACKS = [
    { id: "credits_5000", credits: 5000, label: "Starter Pack", usd: 500, priceId: process.env.STRIPE_PRICE_CREDITS_5000 },
    { id: "credits_10000", credits: 10000, label: "Growth Pack", usd: 900, priceId: process.env.STRIPE_PRICE_CREDITS_10000 },
    { id: "credits_25000", credits: 25000, label: "Pro Pack", usd: 2000, priceId: process.env.STRIPE_PRICE_CREDITS_25000 },
    { id: "credits_60000", credits: 60000, label: "Team Pack", usd: 5000, priceId: process.env.STRIPE_PRICE_CREDITS_60000 },
  ] as const;

  app.get("/api/credits/packs", (_req, res) => {
    return res.json(CREDIT_PACKS.map(p => ({ id: p.id, credits: p.credits, label: p.label, usd: p.usd })));
  });

  app.get("/api/credits/balance", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const balance = await creditService.getBalance(user.id);
      const monthlyUsed = await creditService.getMonthlyUsage(user.id);
      const sub = await storage.getSubscription(user.id);
      const plan = (sub?.plan as PlanTier) || "free";
      const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
      return res.json({
        balance: balance.balance,
        dailyUsed: balance.dailyUsed,
        lifetimePurchased: balance.lifetimePurchased,
        lifetimeUsed: balance.lifetimeUsed,
        monthlyUsed,
        monthlyAllowance: limits.aiCredits.monthly,
        dailyAllowance: limits.aiCredits.daily,
      });
    } catch { return res.status(500).json({ message: "Failed to fetch balance" }); }
  });

  app.get("/api/credits/transactions", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Number(req.query.offset) || 0;
      const txs = await storage.getCreditTransactions(user.id, limit, offset);
      return res.json(txs);
    } catch { return res.status(500).json({ message: "Failed to fetch transactions" }); }
  });

  app.post("/api/credits/buy", authRateLimiter, requireAuth, async (req, res) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) return res.status(503).json({ message: "Billing not configured" });
    try {
      const stripe = new Stripe(stripeSecretKey, { apiVersion: STRIPE_API_VERSION });
      const user = req.user as User;
      const { packId } = z.object({ packId: z.string() }).parse(req.body);
      const pack = CREDIT_PACKS.find(p => p.id === packId);
      if (!pack) return res.status(400).json({ message: "Invalid credit pack" });
      if (!pack.priceId) return res.status(400).json({ message: "Credit pack not configured" });

      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });

      let sub = await storage.getSubscription(user.id);
      let customerId = sub?.stripeCustomerId ?? null;
      if (customerId) {
        try { const c = await stripe.customers.retrieve(customerId); if ((c as Stripe.DeletedCustomer).deleted) customerId = null; } catch { customerId = null; }
      }
      if (!customerId) {
        const created = await stripe.customers.create({ email: fullUser.email, name: fullUser.displayName ?? fullUser.username, metadata: { userId: String(fullUser.id) } });
        customerId = created.id;
        sub = await storage.createSubscription(fullUser.id, { stripeCustomerId: customerId });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price: pack.priceId, quantity: 1 }],
        customer: customerId,
        success_url: `${getPublicUrl(req)}/account?credits=bought&pack=${pack.id}`,
        cancel_url: `${getPublicUrl(req)}/account?credits=cancelled`,
        metadata: { type: "credit_purchase", userId: String(fullUser.id), packId: pack.id, credits: String(pack.credits) },
      });

      return res.json({ url: session.url });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[credits/buy] error:", err);
      return res.status(500).json({ message: "Failed to create checkout session" });
    }
  });
}
