import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/button";
import { CortardoLogoMark } from "@/components/CortardoLogo";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchAppData, activateEncryptedCache } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { AuthOnboardingShell } from "@/components/onboarding/AuthOnboardingShell";
import { ProfileNameStep } from "@/components/onboarding/ProfileNameStep";
import { WorkspaceNameStep } from "@/components/onboarding/WorkspaceNameStep";
import { FinalizingStep } from "@/components/onboarding/FinalizingStep";
import type { OnboardingClientSession } from "@/components/onboarding/types";

const STEP_ORDER = ["profile_name", "workspace", "finalizing"] as const;

function serverStepToVisualIndex(session: OnboardingClientSession): number {
  const map: Record<string, number> = {
    "profile_name": 0,
    "workspace": 1,
    "finalizing": 2,
  };
  return map[session.currentStep] ?? 0;
}

async function parseMutationResponse(res: Response): Promise<OnboardingClientSession> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message ?? "Request failed";
    const err = new Error(message);
    (err as any).status = res.status;
    throw err;
  }
  return body;
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: user, isLoading: userLoading } = useUser();
  const mountedRef = useRef(true);
  const sessionFetchAttempted = useRef(false);

  const [session, setSession] = useState<OnboardingClientSession | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [visualStep, setVisualStep] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const applySession = useCallback(async (nextSession: OnboardingClientSession) => {
    if (!mountedRef.current) return;
    queryClient.setQueryData(["/api/onboarding/session"], nextSession);
    setSession(nextSession);
    const stepIdx = serverStepToVisualIndex(nextSession);
    setVisualStep((current) => current === null ? stepIdx : Math.max(current, stepIdx));
    if (nextSession.currentStep === "complete") {
      await queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      await queryClient.refetchQueries({ queryKey: ["/api/me"] });
      await queryClient.refetchQueries({ queryKey: ["/api/workspaces"] });
      await activateEncryptedCache();
      await prefetchAppData(queryClient);
      setLocation("/workspace/home");
    }
  }, [queryClient, setLocation]);

  const mutateSession = useCallback(async (url: string, body?: unknown) => {
    setIsLoading(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const nextSession = await parseMutationResponse(res);
      await applySession(nextSession);
      return nextSession;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [applySession]);

  useEffect(() => {
    if (!user || sessionFetchAttempted.current) return;
    sessionFetchAttempted.current = true;

    const controller = new AbortController();
    fetch("/api/onboarding/session", { credentials: "include", signal: controller.signal })
      .then(parseMutationResponse)
      .then(applySession)
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to load onboarding");
      });

    return () => controller.abort();
  }, [user, applySession]);

  const handleNameNext = useCallback(async () => {
    if (!displayName.trim()) { setError("Please enter your name"); return; }
    setError("");
    try {
      await mutateSession("/api/onboarding/profile", { displayName: displayName.trim() });
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to save name");
    }
  }, [displayName, mutateSession, queryClient]);

  const handleWorkspaceNext = useCallback(async () => {
    if (!workspaceName.trim()) { setError("Enter a workspace name"); return; }
    setError("");
    try {
      await mutateSession("/api/onboarding/workspace", { name: workspaceName.trim() });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to save workspace");
    }
  }, [workspaceName, mutateSession]);

  const handleFinish = useCallback(async () => {
    setError("");
    try {
      await mutateSession("/api/onboarding/complete");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to complete onboarding");
    }
  }, [mutateSession]);

  const step = session ? visualStep ?? serverStepToVisualIndex(session) : null;
  const stepTitles = ["What's your name?", "Name your workspace", "You're all set!"];
  const stepSubtitles = ["How should we address you?", "Pick a name for your workspace", "Your account is ready"];

  if (error && !session) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 max-w-sm mx-auto text-center px-6">
        <p className="text-[13px] text-[hsl(var(--danger))] font-medium">{error}</p>
        <Button design="primary" size="sm" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  if (userLoading || step === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <div className="opacity-50">
            <CortardoLogoMark size={22} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-pulse" style={{ animationDelay: "160ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-fg-faint animate-pulse" style={{ animationDelay: "320ms" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthOnboardingShell
      currentStep={step}
      furthestStep={step}
      stepTitles={stepTitles}
      stepSubtitles={stepSubtitles}
      error={error}
      onStepClick={(index) => { setError(""); setVisualStep(index); }}
    >
      {step === 0 && (
        <ProfileNameStep
          displayName={displayName}
          onChange={setDisplayName}
          onSubmit={handleNameNext}
          isLoading={isLoading}
        />
      )}
      {step === 1 && (
        <WorkspaceNameStep
          workspaceName={workspaceName}
          onChange={setWorkspaceName}
          onSubmit={handleWorkspaceNext}
          isLoading={isLoading}
        />
      )}
      {step === 2 && (
        <FinalizingStep
          workspaceName={session?.workspace?.name || workspaceName}
          onFinish={handleFinish}
          isLoading={isLoading}
        />
      )}
    </AuthOnboardingShell>
  );
}
