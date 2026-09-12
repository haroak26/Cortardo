import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { OtpInput } from "@/components/otp-input";
import { useLogin } from "@/hooks/use-user";
import { prefetchAppData, activateEncryptedCache } from "@/lib/queryClient";
import { CortardoLogoMark } from "@/components/CortardoLogo";
import { LoginLoadingScreen } from "@/components/LoginLoadingScreen";

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [isTotpChallenge, setIsTotpChallenge] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prefetching, setPrefetching] = useState(false);
  const [prefetchProgress, setPrefetchProgress] = useState<number | undefined>(undefined);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get("error");
    if (e === "google_not_configured") setError("Google sign-in is not configured yet.");
    else if (e === "google_failed")         setError("Google sign-in failed. Please try again.");
    else if (e === "oauth_failed")          setError("Sign-in failed. Please try again.");
  }, []);

  const runPrefetchAndNavigate = async () => {
    await activateEncryptedCache();
    setPrefetching(true);
    try {
      await prefetchAppData(queryClient, (step, total) => {
        setPrefetchProgress(step / total);
      });
    } catch {}
    setLocation("/workspace/home");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await login.mutateAsync({ email, password });
      if ((result as any).requiresTwoFactor) {
        setSubmitting(false);
        setChallengeId((result as any).challengeId);
        setIsTotpChallenge(!!(result as any).totpChallenge);
        setOtpCode("");
        return;
      }
      await runPrefetchAndNavigate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (!challengeId || otpCode.trim().length !== 6) return;
    setVerifyingCode(true);
    setError("");
    try {
      const endpoint = isTotpChallenge ? "/api/login/2fa/totp" : "/api/login/2fa/verify";
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code: otpCode.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Invalid code");
      const statusRes = await fetch(`/api/login/2fa/status?challengeId=${encodeURIComponent(challengeId)}`, { credentials: "include" });
      if (!statusRes.ok) throw new Error((await statusRes.json().catch(() => ({}))).message ?? "Unable to complete login");
      const status = await statusRes.json();
      if (!status.verified || !status.user) throw new Error("Verification is still pending. Please try again.");
      queryClient.setQueryData(["/api/me"], status.user);
      await runPrefetchAndNavigate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setVerifyingCode(false);
    }
  };

  if (prefetching) {
    return <LoginLoadingScreen progress={prefetchProgress} />;
  }

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden lds-auth-page">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px] space-y-7">
          <Link href="/" className="inline-block text-foreground hover:opacity-70 transition-opacity">
            <CortardoLogoMark size={22} />
          </Link>

          <div className="space-y-1">
            <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">Welcome back</h1>
            <p className="text-[13px] text-fg-muted">
              Don&apos;t have an account?{" "}
              <Link href="/auth/signup" className="text-foreground font-semibold hover:opacity-70 transition-opacity">
                Sign up
              </Link>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-[13px] font-medium text-foreground">Email</label>
              <TextInput
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                data-testid="input-email"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-[13px] font-medium text-foreground">Password</label>
                <Link
                  href="/auth/forgot-password"
                  className="text-[12px] text-fg-muted hover:text-foreground transition-colors"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <TextInput
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-[13px] text-danger font-medium" data-testid="text-login-error">{error}</p>
            )}

            {challengeId && (
              <div className="space-y-2 rounded-xl border border-border bg-surface-muted p-3">
                <label className="text-[13px] font-medium text-foreground">
                  {isTotpChallenge ? "Authenticator code" : "Email verification code"}
                </label>
                <p className="text-[11px] text-fg-muted -mt-1">
                  {isTotpChallenge
                    ? "Enter the 6-digit code from your authenticator app."
                    : "Enter the 6-digit code we emailed to this account."}
                </p>
                <OtpInput
                  value={otpCode}
                  onChange={setOtpCode}
                  onComplete={verifyCode}
                  autoFocus
                  data-testid="input-login-otp"
                />
                <Button design="ghost" type="button" size="md" className="w-full" onClick={verifyCode} isLoading={verifyingCode}>
                  Verify code
                </Button>
              </div>
            )}

            <Button
              type="submit"
              size="md"
              className="w-full"
              isLoading={submitting || login.isPending}
              disabled={!email || !password}
              data-testid="button-sign-in"
            >
              Sign in
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background px-3 text-fg-faint">or</span>
              </div>
            </div>

            <Button design="outline" size="md" href="/auth/google" className="w-full" data-testid="button-google-signin">
              <GoogleIcon />Google
            </Button>

            <p className="text-center text-[12px] text-fg-faint">
              By signing in, you agree to our{" "}
              <a href="/terms" className="text-brand underline underline-offset-2 hover:opacity-80 transition-opacity">Terms</a>{" "}
              and{" "}
              <a href="/privacy" className="text-brand underline underline-offset-2 hover:opacity-80 transition-opacity">Privacy Policy</a>.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
