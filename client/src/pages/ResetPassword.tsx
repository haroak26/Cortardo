import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { CortardoLogoMark } from "@/components/CortardoLogo";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { PasswordToggle } from "@/components/password-toggle";
import { PasswordStrength } from "@/components/password-strength";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) setToken(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!token) {
      setError("Invalid reset link. Please request a new one.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({ message: "Request failed" }));
      if (!res.ok) throw new Error(data.message ?? "Failed to reset password");
      setSuccess(true);
      setTimeout(() => navigate("/auth/login"), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden lds-auth-page">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px] space-y-7">
          <CortardoLogoMark size={22} />

          {success ? (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">Password updated</h1>
                <p className="text-[13px] text-fg-muted font-medium">
                  Your password has been changed. Redirecting to sign in…
                </p>
              </div>
              <Link
                href="/auth/login"
                className="text-[13px] font-medium text-foreground hover:opacity-70 transition-opacity"
              >
                Sign in now →
              </Link>
            </div>
          ) : (
            <div className="space-y-7">
              <div className="space-y-1">
                <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">Set a new password</h1>
                <p className="text-[13px] text-fg-muted font-medium">
                  Choose a strong password for your Cortardo account.
                </p>
              </div>

              {!token && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
                  <p className="text-[13px] text-danger font-medium">
                    This reset link is missing a token. Please request a new one.
                  </p>
                  <Link
                    href="/auth/forgot-password"
                    className="mt-2 inline-block text-[13px] font-medium text-danger underline underline-offset-4"
                  >
                    Request new link
                  </Link>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="new-password" className="text-[13px] font-medium text-foreground">New password</label>
                  <div className="relative">
                    <TextInput
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Min. 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus
                      className="pr-12"
                      data-testid="input-new-password"
                    />
                    <PasswordToggle
                      visible={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 border-transparent hover:bg-surface-hover"
                      tabIndex={-1}
                    />
                  </div>
                  <PasswordStrength password={password} />
                </div>

                {error && (
                  <p className="text-[13px] text-danger font-medium">{error}</p>
                )}

                <Button
                  type="submit"
                  size="md"
                  className="w-full"
                  isLoading={loading}
                  disabled={!token}
                  data-testid="button-reset-password"
                >
                  Update password
                </Button>
              </form>

              <Link
                href="/auth/login"
                className="flex items-center justify-center gap-2 text-[13px] text-fg-muted hover:text-foreground transition-colors font-medium"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
