import { randomBytes } from "crypto";
import { eq, desc, count, inArray } from "drizzle-orm";
import {
  users,
  subscriptions,
  onboardingSessions,
  auditLogs,
  workspaces,
  ONBOARDING_STEPS,
  type User,
  type Subscription,
  type OnboardingSession,
  type OnboardingStep,
} from "@shared/schema";
import { BaseRepository } from "./base.repository";

function stepRank(step: string | null | undefined) {
  const index = ONBOARDING_STEPS.indexOf(step as OnboardingStep);
  return index === -1 ? 0 : index;
}

function monotonicOnboardingSessionPatch(
  existing: OnboardingSession | undefined,
  data: Partial<OnboardingSession>,
): Partial<OnboardingSession> {
  if (!data.currentStep) return data;
  const currentStep = stepRank(data.currentStep) >= stepRank(existing?.currentStep)
    ? data.currentStep : existing?.currentStep;
  return { ...data, currentStep };
}

export type UserUpdateData = Partial<Pick<User,
  "displayName" | "avatarUrl" | "googleId" | "email" | "password" |
  "emailVerified" | "emailVerificationToken" | "emailVerificationExpiry" |
  "pendingEmail" | "pendingEmailToken" | "pendingEmailExpiry" |
  "passwordResetToken" | "passwordResetExpiry" |
  "newsletterSubscribed" | "productUpdates" | "securityAlerts" | "billingUpdates" |
  "emailChangeCount" |
  "theme" | "totpSecret" | "totpEnabled" | "onboardingStep" | "lastWorkspaceId"
>>;

export class UserRepository extends BaseRepository {
  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async createUser(data: {
    username: string; email: string; password: string;
    displayName?: string; avatarUrl?: string; googleId?: string;
    emailVerified?: boolean; emailVerificationToken?: string;
    emailVerificationExpiry?: Date; onboardingStep?: number;
  }): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        ...data, publicId: this.generatePublicId('USER'),
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

  async updateUser(id: string, data: UserUpdateData): Promise<User> {
    const [user] = await this.db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { auditLogs, usage, workspaces, apiIntegrations, subscriptions } = await import("@shared/schema");

      await tx.delete(onboardingSessions).where(eq(onboardingSessions.userId, id));
      await tx.delete(auditLogs).where(eq(auditLogs.userId, id));
      await tx.delete(subscriptions).where(eq(subscriptions.userId, id));
      await tx.delete(usage).where(eq(usage.userId, id));
      await tx.delete(workspaces).where(eq(workspaces.ownerId, id));
      await tx.delete(apiIntegrations).where(eq(apiIntegrations.userId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
  }

  async getSubscriptionByUserId(userId: string): Promise<Subscription | undefined> {
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    return sub;
  }

  async createSubscription(userId: string, data?: Partial<Subscription>): Promise<Subscription> {
    const [sub] = await this.db.insert(subscriptions).values({
      userId,
      ...data,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: subscriptions.userId,
      set: { ...data, updatedAt: new Date() },
    }).returning();
    return sub;
  }

  async updateSubscription(userId: string, data: Partial<Subscription>): Promise<Subscription> {
    const [sub] = await this.db.update(subscriptions).set({ ...data, updatedAt: new Date() }).where(eq(subscriptions.userId, userId)).returning();
    return sub;
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId));
    if (!sub) return undefined;
    const [user] = await this.db.select().from(users).where(eq(users.id, sub.userId));
    return user;
  }

  async getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.emailVerificationToken, token));
    return user;
  }

  async getUserByPendingEmailToken(token: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.pendingEmailToken, token));
    return user;
  }

  async getUserByPasswordResetToken(token: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.passwordResetToken, token));
    return user;
  }

  async getOnboardingSession(userId: string): Promise<OnboardingSession | undefined> {
    const [session] = await this.db.select().from(onboardingSessions).where(eq(onboardingSessions.userId, userId));
    return session;
  }

  async createOnboardingSession(userId: string, data: Partial<OnboardingSession> = {}): Promise<OnboardingSession> {
    const existing = await this.getOnboardingSession(userId);
    const patch = monotonicOnboardingSessionPatch(existing, data);
    const [session] = await this.db.insert(onboardingSessions).values({
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

  async listAllUsers(): Promise<User[]> {
    return this.db.select().from(users).orderBy(users.createdAt);
  }

  async getTotalStats(days: number): Promise<{ totalUsers: number; totalWorkspaces: number }> {
    const [userCount] = await this.db.select({ count: count() }).from(users);
    const [wsCount] = await this.db.select({ count: count() }).from(workspaces);
    return {
      totalUsers: Number(userCount?.count ?? 0),
      totalWorkspaces: Number(wsCount?.count ?? 0),
    };
  }

  async createAuditLog(userId: string, action: string, details?: string, ipAddress?: string): Promise<void> {
    await this.db.insert(auditLogs).values({ userId, action, details: details ?? null, ipAddress: ipAddress ?? null });
  }

  async getAuditLogs(userId: string, limit = 50): Promise<Array<{ id: string; action: string; details: string | null; createdAt: Date }>> {
    return this.db.select({
      id: auditLogs.id, action: auditLogs.action, details: auditLogs.details, createdAt: auditLogs.createdAt,
    }).from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  private generatePublicId(prefix: string): string {
    const bytes = randomBytes(12);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars[bytes[i] % 36];
      if (i === 3 || i === 7) result += '-';
    }
    return `${prefix}-${result}`;
  }
}
