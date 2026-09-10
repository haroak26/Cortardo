import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, ilike, like, lte, not, sql } from "drizzle-orm";
import { db } from "./db";
import { createHash, randomUUID, randomBytes } from "crypto";
import {
  usage,
  users,
  onboardingSessions,
  ONBOARDING_STEPS,
  workspaces,
  workspaceMembers,
  apiIntegrations,
  auditLogs,
  projects,
  designFiles,
  userCredits,
  creditTransactions,
  creditHolds,
  type User,
  type OnboardingSession,
  type OnboardingStep,
  type Workspace,
  type WorkspaceMember,
  type ApiIntegration,
  type Subscription,
  type Project,
  type DesignFile,
  type UserCredits,
  type CreditTransaction,
  type CreditHold,
  userSessions,
  type UserSession,
  components,
  assets,
  branches,
  type Branch,
} from "@shared/schema";

function stepRank(step: string | null | undefined) {
  const index = ONBOARDING_STEPS.indexOf(step as OnboardingStep);
  return index === -1 ? 0 : index;
}

function monotonicOnboardingSessionPatch(existing: OnboardingSession | undefined, data: Partial<OnboardingSession>): Partial<OnboardingSession> {
  if (!data.currentStep) return data;
  const currentStep = stepRank(data.currentStep) >= stepRank(existing?.currentStep) ? data.currentStep : existing?.currentStep;
  return { ...data, currentStep };
}

interface IPendingEmailResult {
  id: string;
  email: string;
  pendingEmail: string | null;
  pendingEmailToken: string | null;
  pendingEmailExpiry: Date | null;
}

export interface IStorage {
  getUserById(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  createUser(data: { username: string; email: string; password: string; displayName?: string; avatarUrl?: string; googleId?: string; emailVerified?: boolean; emailVerificationToken?: string; emailVerificationExpiry?: Date; onboardingStep?: number }): Promise<User>;
  updateUser(id: string, data: Partial<{ displayName: string; avatarUrl: string | null; googleId: string; email: string; password: string; emailVerified: boolean; emailVerificationToken: string | null; emailVerificationExpiry: Date | null; pendingEmail: string | null; pendingEmailToken: string | null; pendingEmailExpiry: Date | null; passwordResetToken: string | null; passwordResetExpiry: Date | null; newsletterSubscribed: boolean; productUpdates: boolean; securityAlerts: boolean; billingUpdates: boolean; emailChangeCount: number; totpSecret: string | null; totpEnabled: boolean; onboardingStep: number; theme: string; lastWorkspaceId: string | null }>): Promise<User>;
  deleteUser(id: string): Promise<void>;
  getSubscription(userId: string): Promise<Subscription | undefined>;
  createSubscription(userId: string, data?: Partial<Subscription>): Promise<Subscription>;
  updateSubscription(userId: string, data: Partial<Subscription>): Promise<Subscription>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  getUserByEmailVerificationToken(token: string): Promise<User | undefined>;
  getUserByPendingEmailToken(token: string): Promise<User | undefined>;
  getUserByPasswordResetToken(token: string): Promise<User | undefined>;
  getOnboardingSession(userId: string): Promise<OnboardingSession | undefined>;
  createOnboardingSession(userId: string, data?: Partial<OnboardingSession>): Promise<OnboardingSession>;
  upsertOnboardingSession(userId: string, data: Partial<OnboardingSession>): Promise<OnboardingSession>;
  createWorkspace(ownerId: string, data: { name: string; slug: string; logoUrl?: string; creditBudget?: number | null }): Promise<Workspace>;
  updateWorkspace(workspaceId: string, data: { name?: string; logoUrl?: string; slug?: string; creditBudget?: number | null }): Promise<Workspace>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  listWorkspaces(userId: string): Promise<(Workspace & { role: string })[]>;
  getWorkspaceById(id: string): Promise<Workspace | undefined>;
  canAccessWorkspace(userId: string, workspaceId: string): Promise<{ allowed: boolean; role: string | null }>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  getWorkspaceMember(id: string): Promise<WorkspaceMember | undefined>;
  getWorkspaceMemberByEmail(workspaceId: string, email: string): Promise<WorkspaceMember | undefined>;
  getWorkspaceMemberByToken(token: string): Promise<WorkspaceMember | undefined>;
  getWorkspaceMemberByUserId(workspaceId: string, userId: string): Promise<WorkspaceMember | undefined>;
  createWorkspaceMember(workspaceId: string, data: { email: string; role: string; userId?: string; inviteToken?: string; inviteExpiry?: Date; status?: string }): Promise<WorkspaceMember>;
  updateWorkspaceMember(id: string, data: { role?: string; userId?: string; status?: string; inviteToken?: string | null; inviteExpiry?: Date | null }): Promise<WorkspaceMember>;
  removeWorkspaceMember(id: string): Promise<void>;
  listIntegrations(userId: string): Promise<ApiIntegration[]>;
  upsertIntegration(userId: string, provider: string, apiKey: string): Promise<ApiIntegration>;
  deleteIntegration(userId: string, provider: string): Promise<void>;
  getUsage(userId: string): Promise<{ storageUsed: number; projectsCount: number; designFilesCount: number; versionCount: number; componentCount: number }>;
  incrementUsage(userId: string, field: string, amount?: number): Promise<void>;
  ensureCreditRecord(userId: string): Promise<void>;
  getCredits(userId: string): Promise<{ balance: number; dailyUsed: number; lifetimePurchased: number; lifetimeUsed: number }>;
  getMonthlyCreditUsage(userId: string): Promise<number>;
  deductCredits(userId: string, amount: number, description: string, metadata: Record<string, unknown>): Promise<number>;
  addCredits(userId: string, amount: number, description: string, metadata: Record<string, unknown>): Promise<number>;
  createCreditHold(userId: string, amount: number, runId?: string): Promise<string>;
  releaseCreditHold(holdId: string, actualCredits: number): Promise<void>;
  getActiveHolds(userId: string): Promise<Array<{ id: string; amount: number; createdAt: Date }>>;
  releaseStaleHolds(): Promise<number>;
  getCreditTransactions(userId: string, limit?: number, offset?: number): Promise<CreditTransaction[]>;
  createProject(ownerId: string, workspaceId: string, data: { name: string; description?: string; color?: string; publicId?: string; kind?: string }): Promise<Project>;
  getProjectById(id: string): Promise<Project | undefined>;
  listProjects(workspaceId: string): Promise<Project[]>;
  listBranches(projectId: string): Promise<Branch[]>;
  createBranch(projectId: string, data: { name: string; createdBy?: string }): Promise<Branch>;
  createDesignFile(ownerId: string, workspaceId: string, data: { projectId: string; name: string; type?: string; description?: string; metadata?: Record<string, unknown> }): Promise<DesignFile>;
  getDesignFilesByProject(projectId: string): Promise<DesignFile[]>;
  updateProject(id: string, data: Partial<{ name: string; description: string | null; coverUrl: string | null; color: string; isArchived: boolean }>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  createAuditLog(userId: string, action: string, details?: string, ipAddress?: string): Promise<void>;
  getAuditLogs(userId: string, limit?: number): Promise<Array<{ id: string; action: string; details: string | null; createdAt: Date }>>;
  listUserSessions(userId: string): Promise<UserSession[]>;
  getUserSessionBySessionId(sessionId: string): Promise<UserSession | undefined>;
  createUserSession(userId: string, data: { sessionId: string; userAgent?: string; browser?: string; os?: string; device?: string; ipAddress?: string; location?: string }): Promise<UserSession>;
  updateUserSession(id: string, data: { isCurrent?: boolean; lastActiveAt?: Date }): Promise<UserSession>;
  deleteUserSession(id: string): Promise<void>;
  deleteUserSessionsByUserId(userId: string, excludeSessionId?: string): Promise<void>;
  listComponents(workspaceId: string): Promise<Array<{ id: string; name: string; type: string; thumbnailUrl: string | null }>>;
  listAssets(workspaceId: string): Promise<Array<{ id: string; name: string; type: string; url: string; thumbnailUrl: string | null; size: number; mimeType: string | null }>>;
  listAllUsers(): Promise<User[]>;
  getTotalStats(days?: number): Promise<{ totalUsers: number; totalWorkspaces: number }>;
}

class DatabaseStorage implements IStorage {
  // ── Users ────────────────────────────────────────────────────────────────
  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async createUser(data: {
    username: string; email: string; password: string;
    displayName?: string; avatarUrl?: string; googleId?: string;
    emailVerified?: boolean; emailVerificationToken?: string;
    emailVerificationExpiry?: Date; onboardingStep?: number;
  }): Promise<User> {
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        ...data, publicId: `usr_${randomBytes(12).toString("hex")}`,
      }).returning();
      const existing = await tx.select().from(onboardingSessions)
        .where(eq(onboardingSessions.userId, user.id)).limit(1);
      const patch = monotonicOnboardingSessionPatch(existing[0], {
        currentStep: data.emailVerified ? "profile_name" : "email_verification",
        emailVerificationStatus: data.emailVerified ? "verified" : "pending",
        displayNameStatus: data.displayName ? "complete" : "not_started",
      });
      await tx.insert(onboardingSessions).values({
        userId: user.id, ...patch, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: onboardingSessions.userId,
        set: { ...patch, updatedAt: new Date() },
      });
      return user;
    });
  }

  async updateUser(id: string, data: Record<string, unknown>): Promise<User> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(onboardingSessions).where(eq(onboardingSessions.userId, id));
      await tx.delete(auditLogs).where(eq(auditLogs.userId, id));
      await tx.delete(usage).where(eq(usage.userId, id));
      const { subscriptions } = await import("@shared/schema");
      await tx.delete(subscriptions).where(eq(subscriptions.userId, id));
      await tx.delete(workspaces).where(eq(workspaces.ownerId, id));
      await tx.delete(apiIntegrations).where(eq(apiIntegrations.userId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────
  async getSubscription(userId: string): Promise<Subscription | undefined> {
    const { subscriptions } = await import("@shared/schema");
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    return sub;
  }

  async createSubscription(userId: string, data?: Partial<Subscription>): Promise<Subscription> {
    const { subscriptions } = await import("@shared/schema");
    const existing = await this.getSubscription(userId);
    if (existing) return this.updateSubscription(userId, data ?? {});
    const [sub] = await db.insert(subscriptions).values({
      userId, ...data, updatedAt: new Date(),
    }).returning();
    return sub;
  }

  async updateSubscription(userId: string, data: Partial<Subscription>): Promise<Subscription> {
    const { subscriptions } = await import("@shared/schema");
    const [sub] = await db.update(subscriptions).set({ ...data, updatedAt: new Date() }).where(eq(subscriptions.userId, userId)).returning();
    return sub;
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const { subscriptions } = await import("@shared/schema");
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId));
    if (!sub) return undefined;
    const [user] = await db.select().from(users).where(eq(users.id, sub.userId));
    return user;
  }

  async getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.emailVerificationToken, token));
    return user;
  }

  async getUserByPendingEmailToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.pendingEmailToken, token));
    return user;
  }

  async getUserByPasswordResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.passwordResetToken, token));
    return user;
  }

  // ── Onboarding Sessions ───────────────────────────────────────────────────
  async getOnboardingSession(userId: string): Promise<OnboardingSession | undefined> {
    const [session] = await db.select().from(onboardingSessions).where(eq(onboardingSessions.userId, userId));
    return session;
  }

  async createOnboardingSession(userId: string, data: Partial<OnboardingSession> = {}): Promise<OnboardingSession> {
    const existing = await this.getOnboardingSession(userId);
    const patch = monotonicOnboardingSessionPatch(existing, data);
    const [session] = await db.insert(onboardingSessions).values({
      userId, ...patch, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: onboardingSessions.userId,
      set: { ...patch, updatedAt: new Date() },
    }).returning();
    return session;
  }

  async upsertOnboardingSession(userId: string, data: Partial<OnboardingSession>): Promise<OnboardingSession> {
    return this.createOnboardingSession(userId, data);
  }

  // ── Workspaces ────────────────────────────────────────────────────────────
  async createWorkspace(ownerId: string, data: { name: string; slug: string; logoUrl?: string; creditBudget?: number | null }): Promise<Workspace> {
    const [workspace] = await db.insert(workspaces).values({ ownerId, ...data }).returning();
    return workspace;
  }

  async updateWorkspace(workspaceId: string, data: { name?: string; logoUrl?: string; slug?: string; creditBudget?: number | null }): Promise<Workspace> {
    const [workspace] = await db.update(workspaces).set(data).where(eq(workspaces.id, workspaceId)).returning();
    return workspace;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  }

  async listWorkspaces(userId: string): Promise<(Workspace & { role: string })[]> {
    const owned = await db.select().from(workspaces).where(eq(workspaces.ownerId, userId));
    const rows: (Workspace & { role: string })[] = owned.map(w => ({ ...w, role: "owner" }));
    const memberRows = await db.select({
      workspace: workspaces,
      role: workspaceMembers.role,
    }).from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId));
    for (const mr of memberRows) {
      if (!rows.find(r => r.id === mr.workspace.id)) {
        rows.push({ ...mr.workspace, role: mr.role });
      }
    }
    return rows;
  }

  async getWorkspaceById(id: string): Promise<Workspace | undefined> {
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, id));
    return workspace;
  }

  async canAccessWorkspace(userId: string, workspaceId: string): Promise<{ allowed: boolean; role: string | null }> {
    if (userId) {
      const [ws] = await db.select().from(workspaces).where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, userId)));
      if (ws) return { allowed: true, role: "owner" };
    }
    const [member] = await db.select().from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    if (member) return { allowed: true, role: member.role };
    return { allowed: false, role: null };
  }

  // ── Workspace Members ─────────────────────────────────────────────────────
  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  }

  async getWorkspaceMember(id: string): Promise<WorkspaceMember | undefined> {
    const [member] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, id));
    return member;
  }

  async getWorkspaceMemberByEmail(workspaceId: string, email: string): Promise<WorkspaceMember | undefined> {
    const [member] = await db.select().from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.email, email)));
    return member;
  }

  async getWorkspaceMemberByToken(token: string): Promise<WorkspaceMember | undefined> {
    const [member] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.inviteToken, token));
    return member;
  }

  async getWorkspaceMemberByUserId(workspaceId: string, userId: string): Promise<WorkspaceMember | undefined> {
    const [member] = await db.select().from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    return member;
  }

  async createWorkspaceMember(workspaceId: string, data: {
    email: string; role: string; userId?: string; inviteToken?: string; inviteExpiry?: Date; status?: string;
  }): Promise<WorkspaceMember> {
    const [member] = await db.insert(workspaceMembers).values({ workspaceId, ...data }).returning();
    return member;
  }

  async updateWorkspaceMember(id: string, data: {
    role?: string; userId?: string; status?: string; inviteToken?: string | null; inviteExpiry?: Date | null;
  }): Promise<WorkspaceMember> {
    const [member] = await db.update(workspaceMembers).set(data).where(eq(workspaceMembers.id, id)).returning();
    return member;
  }

  async removeWorkspaceMember(id: string): Promise<void> {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.id, id));
  }

  // ── API Integrations ──────────────────────────────────────────────────────
  async listIntegrations(userId: string): Promise<ApiIntegration[]> {
    return db.select().from(apiIntegrations).where(eq(apiIntegrations.userId, userId));
  }

  async upsertIntegration(userId: string, provider: string, apiKey: string): Promise<ApiIntegration> {
    const [existing] = await db.select().from(apiIntegrations)
      .where(and(eq(apiIntegrations.userId, userId), eq(apiIntegrations.provider, provider)));
    if (existing) {
      const [updated] = await db.update(apiIntegrations).set({ apiKey }).where(eq(apiIntegrations.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(apiIntegrations).values({ userId, provider, apiKey }).returning();
    return created;
  }

  async deleteIntegration(userId: string, provider: string): Promise<void> {
    await db.delete(apiIntegrations).where(and(eq(apiIntegrations.userId, userId), eq(apiIntegrations.provider, provider)));
  }

  // ── Usage ─────────────────────────────────────────────────────────────────
  async getUsage(userId: string): Promise<{
    storageUsed: number; projectsCount: number; designFilesCount: number; versionCount: number; componentCount: number;
  }> {
    const [row] = await db.select().from(usage).where(eq(usage.userId, userId));
    return row ?? { storageUsed: 0, projectsCount: 0, designFilesCount: 0, versionCount: 0, componentCount: 0 };
  }

  async incrementUsage(userId: string, field: string, amount: number = 1): Promise<void> {
    const validFields = ["storage_used", "projects_count", "design_files_count", "version_count", "component_count"];
    if (!validFields.includes(field)) return;
    const col = field as keyof typeof usage.$inferInsert;
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const [existing] = await db.select().from(usage)
      .where(and(eq(usage.userId, userId), gte(usage.periodStart, periodStart)));
    if (existing) {
      await db.update(usage).set({ [col]: sql`${usage[col]} + ${amount}` }).where(eq(usage.id, existing.id));
    } else {
      await db.insert(usage).values({
        userId, [col]: amount, periodStart, periodEnd,
      } as any);
    }
  }

  // ── Credits ────────────────────────────────────────────────────────────
  async ensureCreditRecord(userId: string): Promise<void> {
    const [existing] = await db.select().from(userCredits).where(eq(userCredits.userId, userId));
    if (!existing) {
      await db.insert(userCredits).values({ userId });
    }
  }

  async getCredits(userId: string): Promise<{ balance: number; dailyUsed: number; lifetimePurchased: number; lifetimeUsed: number }> {
    await this.ensureCreditRecord(userId);
    const [row] = await db.select().from(userCredits).where(eq(userCredits.userId, userId));
    if (!row) return { balance: 0, dailyUsed: 0, lifetimePurchased: 0, lifetimeUsed: 0 };
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (!row.dailyResetAt || row.dailyResetAt < todayStart) {
      await db.update(userCredits).set({ dailyUsed: 0, dailyResetAt: todayStart, updatedAt: new Date() }).where(eq(userCredits.userId, userId));
      return { balance: row.balance, dailyUsed: 0, lifetimePurchased: row.lifetimePurchased, lifetimeUsed: row.lifetimeUsed };
    }
    return { balance: row.balance, dailyUsed: row.dailyUsed, lifetimePurchased: row.lifetimePurchased, lifetimeUsed: row.lifetimeUsed };
  }

  async getMonthlyCreditUsage(userId: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const result = await db.select({
      total: sql<number>`COALESCE(SUM(CASE WHEN ${creditTransactions.type} IN ('usage','usage_hold') THEN -${creditTransactions.amount} ELSE 0 END), 0)`,
    }).from(creditTransactions)
      .where(and(eq(creditTransactions.userId, userId), gte(creditTransactions.createdAt, monthStart)));
    return Number(result[0]?.total ?? 0);
  }

  async deductCredits(userId: string, amount: number, description: string, metadata: Record<string, unknown>): Promise<number> {
    await this.ensureCreditRecord(userId);
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(userCredits).where(eq(userCredits.userId, userId));
      if (!row) throw new Error("Credit record not found");
      const newBalance = Math.round((row.balance - amount) * 100) / 100;
      const newDailyUsed = Math.round((row.dailyUsed + amount) * 100) / 100;
      const newLifetimeUsed = Math.round((row.lifetimeUsed + amount) * 100) / 100;
      await tx.update(userCredits).set({
        balance: newBalance,
        dailyUsed: newDailyUsed,
        lifetimeUsed: newLifetimeUsed,
        updatedAt: new Date(),
      }).where(eq(userCredits.userId, userId));
      await tx.insert(creditTransactions).values({
        userId,
        type: "usage",
        amount: -amount,
        balanceAfter: newBalance,
        description,
        metadata,
      });
      return newBalance;
    });
  }

  async addCredits(userId: string, amount: number, description: string, metadata: Record<string, unknown>): Promise<number> {
    await this.ensureCreditRecord(userId);
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(userCredits).where(eq(userCredits.userId, userId));
      if (!row) throw new Error("Credit record not found");
      const newBalance = Math.round((row.balance + amount) * 100) / 100;
      const newLifetimePurchased = Math.round((row.lifetimePurchased + amount) * 100) / 100;
      const isPurchase = metadata?.type === "purchase" || (metadata as any)?.stripeSessionId;
      await tx.update(userCredits).set({
        balance: newBalance,
        ...(isPurchase ? { lifetimePurchased: newLifetimePurchased } : {}),
        updatedAt: new Date(),
      }).where(eq(userCredits.userId, userId));
      await tx.insert(creditTransactions).values({
        userId,
        type: isPurchase ? "purchase" : "grant",
        amount,
        balanceAfter: newBalance,
        description,
        metadata,
      });
      return newBalance;
    });
  }

  async createCreditHold(userId: string, amount: number, runId?: string): Promise<string> {
    await this.ensureCreditRecord(userId);
    const [hold] = await db.insert(creditHolds).values({
      userId,
      runId: runId ?? null,
      amount,
      status: "active",
    }).returning();
    return hold.id;
  }

  async releaseCreditHold(holdId: string, actualCredits: number): Promise<void> {
    await db.transaction(async (tx) => {
      const [hold] = await tx.select().from(creditHolds).where(eq(creditHolds.id, holdId));
      if (!hold || hold.status !== "active") return;
      const diff = Math.round((hold.amount - actualCredits) * 100) / 100;
      const [row] = await tx.select().from(userCredits).where(eq(userCredits.userId, hold.userId));
      if (!row) {
        await tx.update(creditHolds).set({ status: "released", updatedAt: new Date() }).where(eq(creditHolds.id, holdId));
        return;
      }

      const newDailyUsed = Math.round((row.dailyUsed + actualCredits) * 100) / 100;
      const newLifetimeUsed = Math.round((row.lifetimeUsed + actualCredits) * 100) / 100;

      if (diff > 0) {
        const newBalance = Math.round((row.balance + diff) * 100) / 100;
        await tx.update(userCredits).set({ balance: newBalance, dailyUsed: newDailyUsed, lifetimeUsed: newLifetimeUsed, updatedAt: new Date() }).where(eq(userCredits.userId, hold.userId));
        await tx.insert(creditTransactions).values({
          userId: hold.userId,
          type: "usage",
          amount: -actualCredits,
          balanceAfter: newBalance,
          description: `Design generation (run: ${hold.runId ?? "unknown"})`,
          metadata: { holdId, runId: hold.runId, originalHold: hold.amount, actualUsed: actualCredits },
        });
        await tx.insert(creditTransactions).values({
          userId: hold.userId,
          type: "usage_refund",
          amount: diff,
          balanceAfter: newBalance,
          description: `Refund for unused held credits (run: ${hold.runId ?? "unknown"})`,
          metadata: { holdId, runId: hold.runId, originalHold: hold.amount, actualUsed: actualCredits },
        });
      } else if (diff < 0) {
        const overage = Math.abs(diff);
        const newBalance = Math.round((row.balance - overage) * 100) / 100;
        await tx.update(userCredits).set({ balance: newBalance, dailyUsed: newDailyUsed, lifetimeUsed: newLifetimeUsed, updatedAt: new Date() }).where(eq(userCredits.userId, hold.userId));
        await tx.insert(creditTransactions).values({
          userId: hold.userId,
          type: "usage",
          amount: -actualCredits,
          balanceAfter: newBalance,
          description: `Design generation (run: ${hold.runId ?? "unknown"})`,
          metadata: { holdId, runId: hold.runId, originalHold: hold.amount, actualUsed: actualCredits },
        });
      } else {
        await tx.update(userCredits).set({ dailyUsed: newDailyUsed, lifetimeUsed: newLifetimeUsed, updatedAt: new Date() }).where(eq(userCredits.userId, hold.userId));
        await tx.insert(creditTransactions).values({
          userId: hold.userId,
          type: "usage",
          amount: -actualCredits,
          balanceAfter: row.balance,
          description: `Design generation (run: ${hold.runId ?? "unknown"})`,
          metadata: { holdId, runId: hold.runId, originalHold: hold.amount, actualUsed: actualCredits },
        });
      }

      await tx.update(creditHolds).set({
        status: diff >= 0 ? "refunded" : "released",
        updatedAt: new Date(),
      }).where(eq(creditHolds.id, holdId));
    });
  }

  async getActiveHolds(userId: string): Promise<Array<{ id: string; amount: number; createdAt: Date }>> {
    const holds = await db.select({
      id: creditHolds.id,
      amount: creditHolds.amount,
      createdAt: creditHolds.createdAt,
    }).from(creditHolds)
      .where(and(eq(creditHolds.userId, userId), eq(creditHolds.status, "active")));
    return holds;
  }

  async releaseStaleHolds(): Promise<number> {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 hours
    const result = await db.update(creditHolds).set({
      status: "cancelled",
      updatedAt: new Date(),
    }).where(and(
      eq(creditHolds.status, "active"),
      sql`${creditHolds.createdAt} < ${cutoff.toISOString()}`,
    )).returning({ id: creditHolds.id });

    return result.length;
  }

  async getCreditTransactions(userId: string, limit = 50, offset = 0): Promise<CreditTransaction[]> {
    return db.select().from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit).offset(offset);
  }

  // ── Design Files ────────────────────────────────────────────────────────
  async createDesignFile(ownerId: string, workspaceId: string, data: { projectId: string; name: string; type?: string; description?: string; metadata?: Record<string, unknown> }): Promise<DesignFile> {
    const [file] = await db.insert(designFiles).values({
      ownerId,
      workspaceId,
      projectId: data.projectId,
      publicId: `df_${randomBytes(12).toString("hex")}`,
      name: data.name,
      type: data.type || "design",
      description: data.description || null,
      metadata: (data.metadata || {}) as Record<string, unknown>,
    }).returning();
    return file;
  }

  async getDesignFilesByProject(projectId: string): Promise<DesignFile[]> {
    return db.select().from(designFiles)
      .where(and(eq(designFiles.projectId, projectId), eq(designFiles.isArchived, false)))
      .orderBy(desc(designFiles.createdAt));
  }

  // ── Projects ────────────────────────────────────────────────────────────
  async createProject(ownerId: string, workspaceId: string, data: { name: string; description?: string; color?: string; publicId?: string; kind?: string }): Promise<Project> {
    const [project] = await db.insert(projects).values({
      ownerId,
      workspaceId,
      publicId: data.publicId || `proj_${randomBytes(12).toString("hex")}`,
      name: data.name,
      description: data.description || null,
      color: data.color || "#8b5cf6",
      kind: data.kind || "cortardo",
    }).returning();
    return project;
  }

  async getProjectById(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async listProjects(workspaceId: string): Promise<Project[]> {
    return db.select().from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.isArchived, false)))
      .orderBy(desc(projects.updatedAt));
  }

  // ── Project Branches ─────────────────────────────────────────────────────
  async listBranches(projectId: string): Promise<Branch[]> {
    return db.select().from(branches)
      .where(eq(branches.projectId, projectId))
      .orderBy(asc(branches.createdAt));
  }

  async createBranch(projectId: string, data: { name: string; createdBy?: string }): Promise<Branch> {
    const [branch] = await db.insert(branches).values({
      projectId,
      name: data.name,
      createdBy: data.createdBy || null,
    }).returning();
    return branch;
  }

  async updateProject(id: string, data: Partial<{ name: string; description: string | null; coverUrl: string | null; color: string; isArchived: boolean }>): Promise<Project> {
    const [project] = await db.update(projects).set({ ...data, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  // ── Audit Logs ────────────────────────────────────────────────────────────
  async createAuditLog(userId: string, action: string, details?: string, ipAddress?: string): Promise<void> {
    await db.insert(auditLogs).values({ userId, action, details: details ?? null, ipAddress: ipAddress ?? null });
  }

  async getAuditLogs(userId: string, limit = 50): Promise<Array<{ id: string; action: string; details: string | null; createdAt: Date }>> {
    return db.select({
      id: auditLogs.id, action: auditLogs.action, details: auditLogs.details, createdAt: auditLogs.createdAt,
    }).from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  // ── User Sessions ─────────────────────────────────────────────────────────
  async listUserSessions(userId: string): Promise<UserSession[]> {
    return db.select().from(userSessions).where(eq(userSessions.userId, userId)).orderBy(desc(userSessions.lastActiveAt));
  }

  async getUserSessionBySessionId(sessionId: string): Promise<UserSession | undefined> {
    const [session] = await db.select().from(userSessions).where(eq(userSessions.sessionId, sessionId));
    return session;
  }

  async createUserSession(userId: string, data: {
    sessionId: string; userAgent?: string; browser?: string; os?: string; device?: string; ipAddress?: string; location?: string;
  }): Promise<UserSession> {
    const [session] = await db.insert(userSessions).values({ userId, ...data }).returning();
    return session;
  }

  async updateUserSession(id: string, data: { isCurrent?: boolean; lastActiveAt?: Date }): Promise<UserSession> {
    const [session] = await db.update(userSessions).set(data).where(eq(userSessions.id, id)).returning();
    return session;
  }

  async deleteUserSession(id: string): Promise<void> {
    await db.delete(userSessions).where(eq(userSessions.id, id));
  }

  async deleteUserSessionsByUserId(userId: string, excludeSessionId?: string): Promise<void> {
    const conditions = [eq(userSessions.userId, userId)];
    if (excludeSessionId) conditions.push(not(eq(userSessions.sessionId, excludeSessionId)));
    await db.delete(userSessions).where(and(...conditions));
  }

  // ── Components ────────────────────────────────────────────────────────────
  async listComponents(workspaceId: string): Promise<Array<{ id: string; name: string; type: string; thumbnailUrl: string | null }>> {
    const rows = await db
      .select({ id: components.id, name: components.name, type: components.type, thumbnailUrl: components.thumbnailUrl })
      .from(components)
      .where(eq(components.workspaceId, workspaceId));
    return rows;
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  async listAssets(workspaceId: string): Promise<Array<{ id: string; name: string; type: string; url: string; thumbnailUrl: string | null; size: number; mimeType: string | null }>> {
    const rows = await db
      .select({ id: assets.id, name: assets.name, type: assets.type, url: assets.url, thumbnailUrl: assets.thumbnailUrl, size: assets.size, mimeType: assets.mimeType })
      .from(assets)
      .where(eq(assets.workspaceId, workspaceId));
    return rows;
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  async listAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.createdAt);
  }

  async getTotalStats(days: number = 30): Promise<{ totalUsers: number; totalWorkspaces: number }> {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [wsCount] = await db.select({ count: count() }).from(workspaces);
    return { totalUsers: Number(userCount?.count ?? 0), totalWorkspaces: Number(wsCount?.count ?? 0) };
  }
}

export const storage: IStorage = new DatabaseStorage();
