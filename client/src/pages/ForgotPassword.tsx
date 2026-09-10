import { useState } from "react";
import { Link } from "wouter";
import { CortardoLogoMark } from "@/components/CortardoLogo";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(data.message ?? "Request failed");
      }
      setSubmitted(true);
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

          {submitted ? (
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">Check your email</h1>
                <p className="text-[13px] text-fg-muted leading-relaxed">
                  If an account exists for{" "}
                  <span className="font-medium text-foreground">{email}</span>, we&apos;ve sent a
                  password reset link. It expires in 1 hour.
                </p>
                <p className="text-[12px] text-fg-muted">
                  Don&apos;t see it? Check your spam folder, or{" "}
                  <Button
                    onClick={() => setSubmitted(false)}
                    design="ghost"
                    size="xs"
                    className="underline underline-offset-4 p-0 h-auto"
                  >
                    try again
                  </Button>
                  .
                </p>
              </div>
              <Link
                href="/auth/login"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border px-6 text-[14px] font-medium text-foreground transition-colors hover:bg-surface-hover"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <div className="space-y-7">
              <div className="space-y-1">
                <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">Forgot your password?</h1>
                <p className="text-[13px] text-fg-muted font-medium">
                  Enter the email address for your account and we&apos;ll send you a reset link.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-[13px] font-medium text-foreground">Email</label>
                  <TextInput
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    data-testid="input-forgot-email"
                  />
                </div>

                {error && (
                  <p className="text-[13px] text-danger font-medium">{error}</p>
                )}

                <Button
                  type="submit"
                  size="md"
                  className="w-full"
                  isLoading={loading}
                  data-testid="button-send-reset"
                >
                  Send reset link
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
