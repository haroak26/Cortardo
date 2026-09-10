import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { OtpInput } from "@/components/otp-input";
import { CortardoLogoMark } from "@/components/CortardoLogo";


export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resending, setResending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get("verified");
    if (verified) {
      setChallengeId(verified);
      pollStatus(verified);
    }
  }, []);

  async function pollStatus(cid: string) {
    try {
      const res = await fetch(`/api/admin/login/2fa/status?challengeId=${encodeURIComponent(cid)}`, { credentials: "include" });
      const data = await res.json();
      if (data.verified) {
        setLocation("/admin");
        return;
      }
    } catch {}
    pollRef.current = setTimeout(() => pollStatus(cid), 1500);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Login failed" }));
        throw new Error(err.message ?? "Login failed");
      }
      const data = await res.json();
      setChallengeId(data.challengeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!challengeId || otpCode.trim().length !== 6) return;
    setVerifyingCode(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login/2fa/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code: otpCode.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Invalid code" }));
        throw new Error(data.message ?? "Invalid code");
      }
      pollStatus(challengeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setVerifyingCode(false);
    }
  };

  const resendCode = async () => {
    if (!challengeId) return;
    setResending(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login/2fa/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ challengeId }),
      });
      if (!res.ok) throw new Error("Failed to resend");
      const data = await res.json();
      setChallengeId(data.challengeId);
      setOtpCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden lds-auth-page">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px] space-y-7">
          <Link href="/" className="inline-block text-foreground hover:opacity-70 transition-opacity">
            <CortardoLogoMark size={22} />
          </Link>

          <div className="space-y-1">
            <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">Admin</h1>
            <p className="text-[13px] text-fg-muted font-medium">Sign in to the admin panel</p>
          </div>

          {!challengeId ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-[13px] font-medium text-foreground">Admin email</label>
                <TextInput
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-[13px] font-medium text-foreground">Password</label>
                <div className="relative">
                  <TextInput
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-14"
                  />
                  <Button
                    design="ghost"
                    size="xs"
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2"
                    tabIndex={-1}
                  >
                    {showPassword ? "HIDE" : "SHOW"}
                  </Button>
                </div>
              </div>

              {error && <p className="text-[13px] text-danger font-medium">{error}</p>}

              <Button type="submit" size="md" className="w-full" isLoading={loading}>
                Sign in
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface-muted p-4 space-y-3">
                <label className="text-[13px] font-medium text-foreground">Verification Code</label>
                <p className="text-[12px] text-fg-muted leading-relaxed">
                  A 6-digit code has been sent to your admin email. Enter it below to complete sign-in.
                </p>
                <OtpInput
                  value={otpCode}
                  onChange={setOtpCode}
                  onComplete={verifyCode}
                  autoFocus
                />
                {error && <p className="text-[13px] text-danger font-medium">{error}</p>}
                <Button design="ghost"
                  type="button"
                  size="md"
                  className="w-full"
                  onClick={verifyCode}
                  isLoading={verifyingCode}
                >
                  Verify code
                </Button>
                <Button
                  design="ghost"
                  size="xs"
                  type="button"
                  className="w-full"
                  onClick={resendCode}
                  disabled={resending}
                  isLoading={resending}
                >
                  Resend code
                </Button>
              </div>
            </div>
          )}

          <p className="text-center text-[13px] text-fg-muted font-medium">
            <a href="/" className="text-foreground font-medium underline underline-offset-4 hover:opacity-70 transition-opacity">
              Back to Cortardo
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
