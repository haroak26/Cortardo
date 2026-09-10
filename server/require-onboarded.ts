import type { Request, Response, NextFunction } from "express";
import { buildOnboardingSession } from "./onboarding-session";
import type { User } from "@shared/schema";

export function requireOnboarded(allowedPaths?: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (allowedPaths?.some(path => req.path.startsWith(path))) {
      return next();
    }

    const user = req.user as User;
    const session = await buildOnboardingSession(user);

    if (session.currentStep !== "complete") {
      return res.status(403).json({
        message: "Please complete onboarding first",
        code: "ONBOARDING_INCOMPLETE",
        currentStep: session.currentStep,
      });
    }

    next();
  };
}
