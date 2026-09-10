import type { Express, RequestHandler, Response } from "express";
import { z } from "zod";
import { storage } from "./storage";
import {
  OnboardingError,
  createOrUpdateWorkspace,
  saveProfileName,
} from "./onboarding";
import {
  createWorkspaceSchema,
  onboardingStepSchema,
  updateProfileSchema,
  updateWorkspaceSchema,
  type OnboardingSession,
  type User,
} from "@shared/schema";
import {
  buildOnboardingSession,
  legacyStepToOnboardingStep,
  maxLegacyStep,
  maxOnboardingStep,
} from "./onboarding-session";
import { sendWelcomeEmail } from "./email";

type RegisterOnboardingRoutesOptions = {
  requireAuth: RequestHandler;
};

function sendOnboardingError(res: Response, err: unknown, fallbackMessage: string) {
  if (err instanceof OnboardingError) {
    return res.status(err.status).json({
      message: err.message,
      code: err.code,
      details: err.details,
    });
  }
  console.error(`[onboarding] Unhandled error: ${fallbackMessage}`, err);
  return res.status(500).json({ message: fallbackMessage, code: "ONBOARDING_MUTATION_FAILED" });
}

async function getFreshUserSession(userId: string) {
  const updated = await storage.getUserById(userId);
  if (!updated) throw new OnboardingError("USER_NOT_FOUND", "User not found", 404);
  return buildOnboardingSession(updated);
}

export function registerOnboardingRoutes(app: Express, { requireAuth }: RegisterOnboardingRoutesOptions) {
  app.get("/api/onboarding/session", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      return res.json(await getFreshUserSession(user.id));
    } catch (err) {
      console.error("[onboarding/session]", err);
      return sendOnboardingError(res, err, "Failed to get onboarding session");
    }
  });

  app.get("/api/me/onboarding", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const session = await getFreshUserSession(user.id);
      return res.json({ step: session.legacyStep, total: session.total, session });
    } catch (err) {
      console.error("[onboarding/get]", err);
      return sendOnboardingError(res, err, "Failed to get onboarding status");
    }
  });

  app.post("/api/me/onboarding", requireAuth, async (req, res) => {
    try {
      const { step } = onboardingStepSchema.parse(req.body);
      const user = req.user as User;
      const fullUser = await storage.getUserById(user.id);
      if (!fullUser) return res.status(404).json({ message: "User not found" });
      const existingSession = await storage.getOnboardingSession(user.id);
      const requestedLegacyStep = step;
      const acceptedLegacyStep = maxLegacyStep(fullUser.onboardingStep, requestedLegacyStep);
      const requestedStep = legacyStepToOnboardingStep(requestedLegacyStep);
      const currentStep = maxOnboardingStep(existingSession?.currentStep, requestedStep);
      const patch: Partial<OnboardingSession> = {
        currentStep,
        status: currentStep === "complete" ? "complete" : existingSession?.status ?? "active",
        completedAt: currentStep === "complete" ? new Date() : existingSession?.completedAt ?? null,
      };
      if (currentStep === "complete") {
        patch.emailVerificationStatus = "verified";
        patch.displayNameStatus = "complete";
        patch.workspaceStatus = "complete";
        if ((fullUser.onboardingStep ?? 0) < 5) {
          sendWelcomeEmail(fullUser.email, fullUser.displayName || fullUser.email, {
            workspaceName: existingSession?.workspaceName || undefined,
          }).catch((err) => console.error("[onboarding] failed to send welcome email:", err));
        }
      }
      await storage.upsertOnboardingSession(user.id, patch);
      const updated = await storage.updateUser(user.id, { onboardingStep: acceptedLegacyStep });
      const session = await buildOnboardingSession(updated);
      return res.json({ ok: true, step: session.legacyStep, total: session.total, ignored: acceptedLegacyStep !== requestedLegacyStep, session });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[onboarding/set]", err);
      return sendOnboardingError(res, err, "Failed to save onboarding step");
    }
  });

  app.post("/api/onboarding/profile", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const { displayName } = updateProfileSchema.required({ displayName: true }).pick({ displayName: true }).parse(req.body);
      const updated = await saveProfileName(user.id, displayName);
      return res.json(await buildOnboardingSession(updated));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, code: "INVALID_PROFILE_NAME" });
      console.error("[onboarding/profile]", err);
      return sendOnboardingError(res, err, "Failed to save profile");
    }
  });

  app.post("/api/onboarding/workspace", requireAuth, async (req, res) => {
    try {
      const user = req.user as User;
      const input = createWorkspaceSchema.parse(req.body);
      await createOrUpdateWorkspace(user.id, input.name, input.logoUrl);
      return res.json(await getFreshUserSession(user.id));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, code: "INVALID_WORKSPACE" });
      console.error("[onboarding/workspace]", err);
      return sendOnboardingError(res, err, "Failed to save workspace");
    }
  });
}
