import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { CortardoLogoMark } from "@/components/CortardoLogo";
import { EmailVerificationStep } from "@/components/onboarding/EmailVerificationStep";
import type { OnboardingClientSession } from "@/components/onboarding/types";

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const email = useMemo(() => {
    const queryEmail = new URLSearchParams(window.location.search).get("email");
    return (
      queryEmail ??
      window.localStorage.getItem("cortardo.pendingVerificationEmail") ??
      ""
    ).toLowerCase().trim();
  }, []);

  useEffect(() => {
    if (!email) return;
    window.localStorage.setItem("cortardo.pendingVerificationEmail", email);
    if (!new URLSearchParams(window.location.search).get("email")) {
      window.history.replaceState(
        null,
        "",
        `/auth/verify-email?email=${encodeURIComponent(email)}`,
      );
    }

    let cancelled = false;
    fetch(`/api/auth/verification-session?email=${encodeURIComponent(email)}`, {
      credentials: "include",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.message ?? "Verification session unavailable");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.email) {
          window.localStorage.setItem("cortardo.pendingVerificationEmail", data.email);
        }
        if (data.emailVerificationStatus === "expired") {
          setError("Verification code expired. Please request a new one.");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Verification session unavailable");
        }
      });

    return () => { cancelled = true; };
  }, [email]);

  const handleVerified = async (session: OnboardingClientSession) => {
    queryClient.setQueryData(["/api/onboarding/session"], session);

    const meRes = await fetch("/api/me", { credentials: "include" });
    if (meRes.ok) {
      queryClient.setQueryData(["/api/me"], await meRes.json());
    }

    window.localStorage.removeItem("cortardo.pendingVerificationEmail");
    setLocation("/auth/onboarding");
  };

  if (!email) {
    return (
<div className="h-[100dvh] flex bg-background overflow-hidden lds-auth-page">
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[360px] space-y-7">
            <Link href="/"><CortardoLogoMark size={22} /></Link>
            <div className="space-y-1">
              <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">No email provided</h1>
              <p className="text-[13px] text-fg-muted">Please start the sign up process first.</p>
            </div>
            <Link
              href="/auth/signup"
              className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground text-[14px] font-medium hover:bg-primary/90 transition-colors"
            >
              Back to sign up
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden lds-auth-page">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px] space-y-7">
          <Link href="/"><CortardoLogoMark size={22} /></Link>

          <div className="space-y-1">
            <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">
              Check your email
            </h1>
            <p className="text-[13px] text-fg-muted leading-relaxed">
              We sent a 6-digit code to{" "}
              <strong className="text-foreground font-medium">{email}</strong>
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[hsl(var(--danger-muted))] border border-[hsl(var(--danger)/0.15)]">
              <p className="text-[13px] font-medium text-[hsl(var(--danger))]">{error}</p>
            </div>
          )}

          <EmailVerificationStep email={email} onVerified={handleVerified} />

          <div className="flex justify-center">
            <Link
              href="/auth/signup"
              className="text-[12px] text-fg-muted underline underline-offset-4 hover:text-foreground transition-colors"
            >
              Not your email? Start over
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
