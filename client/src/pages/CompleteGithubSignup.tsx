import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Loader } from "lucide-react";
import { CortardoLogoMark } from "@/components/CortardoLogo";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { useUser } from "@/hooks/use-user";
import { prefetchAppData, activateEncryptedCache } from "@/lib/queryClient";

export default function CompleteGithubSignup() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: user, isLoading: userLoading } = useUser();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [skippedPassword, setSkippedPassword] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);

  const hasPassword = useMemo(() => !!user?.hasPassword, [user]);
  const isLoading = userLoading;
  const passwordDone = hasPassword || skippedPassword;

  useEffect(() => {
    if (user?.displayName && !displayName) {
      setDisplayName(user.displayName);
    }
  }, [user?.displayName]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation("/auth/login");
      return;
    }
    if (passwordDone && nameSaved) {
      activateEncryptedCache().then(() => {
        prefetchAppData(queryClient).then(() => setTimeout(() => setLocation("/auth/onboarding"), 500));
      });
    }
  }, [isLoading, user, passwordDone, nameSaved, setLocation, queryClient]);

  const linkPassword = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/me/link-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ message: "Failed to link password" }));
        throw new Error(payload.message ?? "Failed to link password");
      }
      return res.json();
    },
    onSuccess: async () => {
      setPasswordError("");
      await queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      await activateEncryptedCache();
      await prefetchAppData(queryClient);
    },
  });

  const saveName = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ displayName: name }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ message: "Failed to save name" }));
        throw new Error(payload.message ?? "Failed to save name");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      setNameSaved(true);
      setNameError("");
    },
  });

  if (isLoading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <Loader className="h-5 w-5 animate-spin text-fg-muted" />
      </div>
    );
  }

  if (!user) return null;

  const showNameStep = !user.displayName && !nameSaved;

  const onPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    if (password.length < 8) { setPasswordError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setPasswordError("Passwords do not match."); return; }
    await linkPassword.mutateAsync().catch((err: unknown) => {
      setPasswordError(err instanceof Error ? err.message : "Failed to link password");
    });
  };

  const onNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError("");
    if (!displayName.trim()) { setNameError("Name is required."); return; }
    await saveName.mutateAsync(displayName.trim()).catch((err: unknown) => {
      setNameError(err instanceof Error ? err.message : "Failed to save name");
    });
  };

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden lds-auth-page">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px] space-y-7">
          <Link href="/" className="inline-block text-foreground hover:opacity-70 transition-opacity">
            <CortardoLogoMark size={22} />
          </Link>

          <div className="space-y-1">
            <h1 className="text-[22px] text-foreground font-medium tracking-[-0.4px]">
              Finish setting up your account
            </h1>
            <p className="text-[13px] text-fg-muted font-medium">
              Signed in via GitHub as{" "}
              <strong className="text-foreground">{user.displayName ?? user.email}</strong>.
            </p>
          </div>

          <div className="space-y-2">
            {showNameStep && (
              <div className="rounded-xl border border-border px-3 py-2.5 flex items-start gap-2">
                <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${nameSaved ? "text-emerald-500" : "text-fg-faint"}`} />
                <div>
                  <p className="text-[13px] font-medium text-foreground">Set your display name</p>
                  <p className="text-[11px] text-fg-faint">How others see you in Cortardo.</p>
                </div>
              </div>
            )}
            <div className="rounded-xl border border-border px-3 py-2.5 flex items-start gap-2">
              <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${passwordDone ? "text-emerald-500" : "text-fg-faint"}`} />
              <div>
                <p className="text-[13px] font-medium text-foreground">
                  Set a backup password{" "}
                  <span className="text-[11px] font-normal text-fg-faint">(optional)</span>
                </p>
                <p className="text-[11px] text-fg-faint">Sign in with email + password in addition to GitHub.</p>
              </div>
            </div>
          </div>

          {showNameStep && !nameSaved && (
            <form onSubmit={onNameSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="displayName" className="text-[13px] font-medium text-foreground">Your Full Name</label>
                <TextInput
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  autoFocus
                  autoComplete="name"
                />
              </div>
              {nameError && <p className="text-[13px] text-danger font-medium">{nameError}</p>}
              <Button type="submit" size="md" className="w-full" isLoading={saveName.isPending}>
                Save name
              </Button>
              <Button
                type="button"
                design="ghost"
                size="xs"
                className="w-full"
                onClick={() => setNameSaved(true)}
              >
                Skip for now
              </Button>
            </form>
          )}

          {(nameSaved || !showNameStep) && !passwordDone && (
            <form onSubmit={onPasswordSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-[13px] font-medium text-foreground">New password</label>
                <TextInput
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="confirm" className="text-[13px] font-medium text-foreground">Confirm password</label>
                <TextInput
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Repeat password"
                />
              </div>
              {passwordError && <p className="text-[13px] text-danger font-medium">{passwordError}</p>}
              <Button
                type="submit"
                size="md"
                className="w-full"
                isLoading={linkPassword.isPending}
              >
                Save password
              </Button>
              <Button
                type="button"
                design="ghost"
                size="xs"
                className="w-full"
                onClick={() => setSkippedPassword(true)}
              >
                Skip — I&apos;ll only sign in with GitHub
              </Button>
            </form>
          )}

          {(nameSaved || !showNameStep) && passwordDone && (
            <Button onClick={() => setLocation("/auth/onboarding")} size="md" className="w-full">
              Continue to onboarding <ArrowRight size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
