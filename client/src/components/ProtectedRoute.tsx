import React from "react";
import { Redirect, useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";
import { useWorkspace } from "@/contexts/workspace-context";
import { LoginLoadingScreen } from "@/components/LoginLoadingScreen";

const ONBOARDING_COMPLETE_STEP = 5;

interface ProtectedRouteProps {
  component: React.ComponentType;
}

export function ProtectedRoute({ component: Component }: ProtectedRouteProps) {
  const [currentPath] = useLocation();
  const { data: user, isLoading: userLoading } = useUser();
  const { isLoading: workspaceLoading } = useWorkspace();

  const isOnboardingPage = currentPath === "/auth/onboarding";
  const loading = userLoading || (!isOnboardingPage && !!(user && workspaceLoading));

  if (loading) {
    if (isOnboardingPage) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-border border-t-foreground/60 rounded-full animate-spin" />
        </div>
      );
    }
    // Cold cache miss — show the branded loading screen briefly while data refetches.
    return <LoginLoadingScreen />;
  }

  if (!user) {
    return <Redirect to="/auth/login" />;
  }

  const onboardingStep = (user as { onboardingStep?: number }).onboardingStep ?? 0;
  const isOnboardingComplete = onboardingStep >= ONBOARDING_COMPLETE_STEP;

  if (!isOnboardingComplete && !isOnboardingPage) {
    return <Redirect to="/auth/onboarding" />;
  }

  if (isOnboardingComplete && isOnboardingPage) {
    return <Redirect to="/home" />;
  }

  return <Component />;
}
