import { randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { sendWelcomeEmail } from "./email";
import {
  onboardingSessions,
  users,
  workspaces,
  type OnboardingSession,
  type User,
  type Workspace,
} from "@shared/schema";

const LEGACY_COMPLETE_STEP = 6;

export type OnboardingErrorCode =
  | "USER_NOT_FOUND"
  | "WORKSPACE_NOT_FOUND";

export class OnboardingError extends Error {
  code: OnboardingErrorCode;
  status: number;
  details?: Record<string, unknown>;

  constructor(code: OnboardingErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "OnboardingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const ONBOARDING_PROGRESS_ORDER = [
  "signup",
  "email_verification",
  "profile_name",
  "workspace",
  "finalizing",
  "complete",
] as const;

function stepRank(step: string | null | undefined) {
  const index = ONBOARDING_PROGRESS_ORDER.indexOf(step as (typeof ONBOARDING_PROGRESS_ORDER)[number]);
  return index === -1 ? 0 : index;
}

function maxOnboardingStep(current: string | null | undefined, next: string | null | undefined) {
  return stepRank(next) >= stepRank(current) ? next : current;
}

function monotonicSessionPatch(existing: OnboardingSession | undefined, data: Partial<OnboardingSession>): Partial<OnboardingSession> {
  if (!data.currentStep) return data;
  return {
    ...data,
    currentStep: maxOnboardingStep(existing?.currentStep, data.currentStep) as OnboardingSession["currentStep"],
  };
}

async function requireUser(userId: string, tx: any = db): Promise<User> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  if (!user) throw new OnboardingError("USER_NOT_FOUND", "User not found", 404);
  return user;
}

async function getSession(userId: string, tx: any = db): Promise<OnboardingSession | undefined> {
  const [session] = await tx.select().from(onboardingSessions).where(eq(onboardingSessions.userId, userId));
  return session;
}

async function upsertSession(userId: string, data: Partial<OnboardingSession>, tx: any = db): Promise<OnboardingSession> {
  const existing = await getSession(userId, tx);
  const patch = monotonicSessionPatch(existing, data);
  const [session] = await tx.insert(onboardingSessions).values({
    userId,
    ...patch,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: onboardingSessions.userId,
    set: {
      ...patch,
      updatedAt: new Date(),
    },
  }).returning();
  return session;
}

async function updateUserStep(userId: string, currentStep: number | null | undefined, nextStep: number, tx: any = db): Promise<User> {
  const [user] = await tx.update(users)
    .set({ onboardingStep: Math.max(currentStep ?? 0, nextStep) })
    .where(eq(users.id, userId))
    .returning();
  if (!user) throw new OnboardingError("USER_NOT_FOUND", "User not found", 404);
  return user;
}

async function lockOnboardingForUser(userId: string, tx: any = db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

export async function saveProfileName(userId: string, displayName: string): Promise<User> {
  return db.transaction(async (tx) => {
    await lockOnboardingForUser(userId, tx);
    const user = await requireUser(userId, tx);
    const trimmed = displayName.trim();
    const [updated] = await (tx).update(users)
      .set({ displayName: trimmed, onboardingStep: Math.max(user.onboardingStep, 1) })
      .where(eq(users.id, userId))
      .returning();
    await upsertSession(userId, { currentStep: "workspace", displayNameStatus: "complete" }, tx);
    return updated;
  });
}

export async function createOrUpdateWorkspace(userId: string, workspaceName: string, logoUrl?: string, slug?: string): Promise<Workspace> {
  let sendWelcome = false;
  let userEmail = "";
  let userDisplayName = "";
  const workspace = await db.transaction(async (tx) => {
    await lockOnboardingForUser(userId, tx);
    const user = await requireUser(userId, tx);
    const existingSession = await getSession(userId, tx);
    const resolvedSlug = slug || workspaceName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "") || `ws-${randomBytes(4).toString("hex")}`;
    const values = { name: workspaceName.trim(), slug: resolvedSlug, logoUrl: logoUrl ?? null };
    let workspace: Workspace;

    if (existingSession?.workspaceId) {
      const [existingWorkspace] = await (tx).select().from(workspaces).where(and(eq(workspaces.id, existingSession.workspaceId), eq(workspaces.ownerId, userId)));
      if (existingWorkspace) {
        const [updated] = await (tx).update(workspaces).set(values).where(eq(workspaces.id, existingWorkspace.id)).returning();
        workspace = updated;
      } else {
        const [created] = await (tx).insert(workspaces).values({ ownerId: userId, ...values }).returning();
        workspace = created;
      }
    } else {
      const [created] = await (tx).insert(workspaces).values({ ownerId: userId, ...values }).returning();
      workspace = created;
    }

    await (tx).update(users).set({ lastWorkspaceId: workspace.id }).where(eq(users.id, userId));
    await upsertSession(userId, {
      currentStep: "complete",
      workspaceStatus: "complete",
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }, tx);
    await updateUserStep(userId, 0, 5, tx);

    if (existingSession?.currentStep !== "complete" && (user.onboardingStep ?? 0) < 5) {
      sendWelcome = true;
      userEmail = user.email;
      userDisplayName = user.displayName || user.email;
    }

    return workspace;
  });

  if (sendWelcome) {
    sendWelcomeEmail(userEmail, userDisplayName, { workspaceName: workspace.name }).catch((err) => console.error("[onboarding] failed to send welcome email:", err));
  }

  return workspace;
}
