import { storage } from "./storage";
import {
  ONBOARDING_STEPS,
  type OnboardingSession,
  type OnboardingStep,
  type User,
} from "@shared/schema";

const LEGACY_COMPLETE_STEP = 5;

export const legacyStepToOnboardingStep = (step: number): OnboardingStep => {
  if (step >= LEGACY_COMPLETE_STEP) return "complete";
  switch (step) {
    case 0: return "profile_name";
    case 1: return "workspace";
    case 2: return "finalizing";
    default: return "profile_name";
  }
};

const onboardingStepToLegacyStep = (step: string): number => {
  switch (step) {
    case "signup":
    case "email_verification":
    case "profile_name": return 0;
    case "workspace": return 1;
    case "finalizing": return 2;
    case "complete": return LEGACY_COMPLETE_STEP;
    default: return 0;
  }
};

export const maxLegacyStep = (current: number | null | undefined, next: number) => Math.max(current ?? 0, next);

export const maxOnboardingStep = (current: string | null | undefined, next: OnboardingStep): OnboardingStep => {
  const currentRank = ONBOARDING_STEPS.indexOf((current ?? "signup") as OnboardingStep);
  const nextRank = ONBOARDING_STEPS.indexOf(next);
  return nextRank >= currentRank ? next : (current as OnboardingStep);
};

const statusFrom = (done: boolean, started = false) => done ? "complete" : started ? "pending" : "not_started";

export type CanonicalOnboardingSession = Omit<OnboardingSession, never> & {
  legacyStep: number;
  total: number;
  steps: readonly string[];
  profile: { displayName: string };
  workspace: { id: string | null; name: string };
};

export async function buildOnboardingSession(user: User): Promise<CanonicalOnboardingSession> {
  const existing = await storage.getOnboardingSession(user.id);

  const tokenExpired = !!user.emailVerificationExpiry && new Date() > user.emailVerificationExpiry;
  const emailVerificationStatus = user.emailVerified
    ? "verified"
    : tokenExpired
      ? "expired"
      : user.emailVerificationToken
        ? "sent"
        : existing?.emailVerificationStatus === "sent" || existing?.emailVerificationStatus === "expired"
          ? existing.emailVerificationStatus
          : "pending";
  const displayNameStatus = statusFrom(!!user.displayName?.trim());
  const workspaceStatus = statusFrom(!!existing?.workspaceName);

  let currentStep: OnboardingStep = "signup";
  if (existing?.currentStep === "complete" || existing?.status === "complete" || (user.onboardingStep ?? 0) >= LEGACY_COMPLETE_STEP) {
    currentStep = "complete";
  } else if (!user.emailVerified) {
    currentStep = "email_verification";
  } else if (displayNameStatus !== "complete") {
    currentStep = "profile_name";
  } else if (workspaceStatus !== "complete") {
    currentStep = "workspace";
  } else {
    currentStep = "finalizing";
  }

  if (existing?.currentStep && currentStep !== "complete") {
    currentStep = maxOnboardingStep(existing.currentStep, currentStep);
  }

  const completedAt = currentStep === "complete" ? existing?.completedAt ?? new Date() : null;
  const status = currentStep === "complete" ? "complete" : "active";
  const session = await storage.upsertOnboardingSession(user.id, {
    status,
    currentStep,
    emailVerificationStatus,
    displayNameStatus,
    workspaceStatus,
    workspaceId: existing?.workspaceId ?? null,
    workspaceName: existing?.workspaceName ?? null,
    completedAt,
  });

  return {
    ...session,
    legacyStep: onboardingStepToLegacyStep(session.currentStep),
    total: LEGACY_COMPLETE_STEP,
    steps: ONBOARDING_STEPS,
    profile: { displayName: user.displayName ?? "" },
    workspace: { id: existing?.workspaceId ?? null, name: existing?.workspaceName ?? "" },
  };
}
