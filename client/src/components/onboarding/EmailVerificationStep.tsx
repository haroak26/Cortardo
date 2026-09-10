import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/button";
import { OtpInput } from "@/components/otp-input";
import type { OnboardingClientSession } from "./types";

type Props = {
  email: string;
  onVerified: (session: OnboardingClientSession) => void;
  onError?: (error: string) => void;
};

export function EmailVerificationStep({ email, onVerified, onError }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const handleVerify = async (completedCode: string) => {
    if (!email || !completedCode || completedCode.length !== 6) return;
    setError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          code: completedCode,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Invalid verification code" }));
        throw new Error(data.message ?? "Invalid verification code");
      }
      const session = await res.json();
      onVerified(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      setError(msg);
      onError?.(msg);
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    setResendSuccess(false);
    setError("");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Failed to resend code" }));
        throw new Error(data.message ?? "Failed to resend code");
      }
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={handleVerify}
          disabled={verifying}
          autoFocus
        />
      </div>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      <div className="flex flex-col items-center gap-3 pt-2">
        <Button design="ghost" size="xs" type="button" onClick={handleResend} disabled={resending}>
          <RefreshCw size={12} className={resending ? "animate-spin" : ""} />
          {resendSuccess ? "Code resent!" : "Resend code"}
        </Button>
      </div>
    </div>
  );
}
