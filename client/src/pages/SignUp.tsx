import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { CortardoLogoMark } from "@/components/CortardoLogo";
import { PasswordStrength } from "@/components/password-strength";

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

export default function SignUp() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json().catch(() => ({ message: "Something went wrong" }));
      if (!res.ok) throw new Error(data.message ?? "Failed to create account");
      const verificationEmail = data.email ?? email.trim().toLowerCase();
      window.localStorage.setItem("cortardo.pendingVerificationEmail", verificationEmail);
      setLocation(`/auth/verify-email?email=${encodeURIComponent(verificationEmail)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
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
            <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">Create your account</h1>
            <p className="text-[13px] text-fg-muted">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-foreground font-semibold hover:opacity-70 transition-opacity">
                Sign in
              </Link>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="signup-email" className="text-[13px] font-medium text-foreground">Email</label>
              <TextInput
                id="signup-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="signup-password" className="text-[13px] font-medium text-foreground">Password</label>
              <div className="relative">
                <TextInput
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <PasswordStrength password={password} />
            </div>

            {error && (
              <p className="text-[13px] text-danger font-medium">{error}</p>
            )}

            <Button type="submit" size="md" className="w-full" isLoading={submitting} disabled={!email || !password || password.length < 8}>
              Create account
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background px-3 text-fg-faint">or</span>
              </div>
            </div>

            <Button design="outline" size="md" href="/auth/google" className="w-full">
              <GoogleIcon />Google
            </Button>

            <p className="text-center text-[12px] text-fg-faint">
              By signing up, you agree to our{" "}
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
