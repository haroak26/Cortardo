import React from "react";
import { useLocation } from "wouter";
import { Loader, MailCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchAppData, activateEncryptedCache } from "@/lib/queryClient";
import { Button } from "@/components/button";

export default function LoadingVerification() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const challenge = params.get("challenge") ?? "";
  const [message, setMessage] = React.useState("Waiting for your login two-factor email confirmation...");
  const [resending, setResending] = React.useState(false);

  React.useEffect(() => {
    if (!challenge) {
      setLocation("/auth/login");
      return;
    }
    const poll = async () => {
      const res = await fetch(`/api/login/2fa/status?challengeId=${encodeURIComponent(challenge)}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.verified && data.user) {
        queryClient.setQueryData(["/api/me"], data.user);
        await activateEncryptedCache();
        await prefetchAppData(queryClient);
        setLocation("/workspace/home");
      }
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => window.clearInterval(id);
  }, [challenge, queryClient, setLocation]);

  const resend = async () => {
    setResending(true);
    try {
      const res = await fetch("/api/login/2fa/resend", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.message ?? "Unable to resend the login 2FA email.");
        return;
      }
      if (data.challengeId) {
        setLocation(`/auth/loading-verification?challenge=${encodeURIComponent(data.challengeId)}`);
      }
      setMessage("Login 2FA email sent. Check your inbox.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden lds-auth-page">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px] space-y-7">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <MailCheck className="h-7 w-7" />
            </div>
            <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">Login 2FA verification</h1>
            <p className="text-[13px] text-fg-muted font-medium">{message}</p>
            <div className="flex items-center justify-center gap-2 text-[13px] text-fg-muted font-medium">
              <Loader className="h-4 w-4 animate-spin" />
              Signing you in after login 2FA verification
            </div>
            <Button design="ghost" size="md" className="w-full" onClick={resend} isLoading={resending}>
              Resend login 2FA email
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
