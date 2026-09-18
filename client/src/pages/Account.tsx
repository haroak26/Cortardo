import React, { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useUser, useLogout, usePlan } from "@/hooks/use-user";
import { wipeAppCache } from "@/lib/queryClient";
import { useTheme } from "@/hooks/use-theme";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardSpeed01Icon, Edit01Icon } from "@hugeicons/core-free-icons";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  Check, Clock, Download, Lock, ChevronRight, ChevronDown, ArrowLeft, ArrowRight,
  User, CreditCard, Globe,
  Zap, Trash2, Smartphone, Key, Unplug,
  Plus, Loader, AlertCircle, X, Menu,
  Users,
} from "lucide-react";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { OtpInput } from "@/components/otp-input";
import { Badge, ListSkeleton, MetricCard } from "@/components/ds";
import { OpenDropdown, OpenDropdownBackdrop, OpenDropdownItem, OpenDropdownMenu } from "@/components/open-dropdown";
import { TinyToggle } from "@/components/ui/tiny-toggle";
import {
  SettingsSection,
  SettingsRow,
  SettingsTextRow,
  SettingsDisplayRow,
  SettingsSwitchRow,
  SettingsButtonRow,
  SaveButton,
  SettingsLock,
} from "@/components/settings-ui";

import TeamPageView from "@/pages/TeamPage";
import { GithubIntegrationsPage, GithubIntegrationDetailsPage } from "@/components/account/GithubIntegrationSection";
import { PLAN_LIMITS, type PlanTier } from "@shared/schema";
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from "@/lib/billing";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────────────

type Plan = PlanTier;

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

function StatusPill({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span className="text-[11px] font-medium text-emerald-600">Verified</span>
    );
  }
  return (
    <span className="text-[11px] font-medium text-amber">Unverified</span>
  );
}

function PlanBadge({ plan }: { plan: Plan }) {
  return (
    <Badge tone="brand" size="sm">
      {plan.charAt(0).toUpperCase() + plan.slice(1)}
    </Badge>
  );
}

// ── Editable field row ─────────────────────────────────────────────────────

function EditableRow({
  label, description, value, onSave, type = "text", placeholder, readOnly, disabled, onDirtyChange, onRegisterSave,
}: {
  label: string; description?: string; value: string;
  onSave?: (v: string) => Promise<void>; type?: string; placeholder?: string;
  readOnly?: boolean; disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onRegisterSave?: (save: () => Promise<void>, cancel: () => void) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const initialValue = value;
  draftRef.current = draft;
  const dirty = draft !== value;
  dirtyRef.current = dirty;
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);

  const save = useCallback(async () => {
    if (!dirtyRef.current || !onSave) return;
    setSaving(true); setError(null);
    try { await onSave(draftRef.current); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  }, [onSave]);

  useEffect(() => {
    onRegisterSave?.(save, () => setDraft(initialValue));
  }, [save, initialValue]);

  return (
    <SettingsRow label={label} description={description}>
      {readOnly || disabled ? (
        <TextInput value={value || placeholder} disabled size="sm" className="min-w-0 w-full sm:w-64" />
      ) : (
        <div className="flex flex-col gap-2 min-w-0 w-full sm:w-64">
          <TextInput
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            size="sm"
            className="min-w-0 w-full"
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
      )}
    </SettingsRow>
  );
}

// ── Profile page ───────────────────────────────────────────────────────────

function AvatarUpload({ user, onUpdated }: { user: any; onUpdated: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/me/avatar", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message ?? "Upload failed");
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ avatarUrl: null }),
      });
      if (!res.ok) throw new Error("Failed to remove avatar");
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove avatar");
    } finally {
      setUploading(false);
    }
  };

  const initials = (user.displayName || user.username || "U")
    .split(/\s+/)
    .map((p: string) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return (
    <SettingsRow label="Logo / Avatar" description="Shown on your profile and review comments.">
      <div className="flex flex-col gap-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={handleUpload}
          className="hidden"
          id="avatar-upload"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label="Change avatar"
          className="group relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-full border-none bg-transparent p-0 disabled:cursor-default"
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="Avatar" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground">
              <span className="text-[15px] font-semibold text-white">{initials || "U"}</span>
            </span>
          )}
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-full bg-black/45 transition-opacity",
              uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {uploading ? (
              <Loader className="h-4 w-4 animate-spin text-white" />
            ) : (
              <HugeiconsIcon icon={Edit01Icon} size={16} strokeWidth={1.75} className="text-white" />
            )}
          </span>
        </button>
        {error && <p className="text-[11px] text-destructive m-0">{error}</p>}
      </div>
    </SettingsRow>
  );
}

function ProfilePage({ user, updateProfile, emailVerified, pendingEmail, onResend, isResending, refetch, saveAccountSettings }: any) {
  const [theme, setTheme] = useState(user?.theme ?? "system");
  const [themeOpen, setThemeOpen] = useState(false);
  const [sectionDirty, setSectionDirty] = useState(false);
  const sectionSaveRef = useRef<() => Promise<void>>();
  const sectionCancelRef = useRef<() => void>();

  useTheme(theme);

  return (
    <div className="py-4 space-y-8">
      {(!emailVerified || pendingEmail) && (
        <VerificationBanner emailVerified={emailVerified} pendingEmail={pendingEmail} onResend={onResend} isResending={isResending} />
      )}
      <SettingsSection title="Identity">
        <AvatarUpload user={user} onUpdated={refetch} />
        <EditableRow
          label="Full Name"
          description="Displayed to your team and on review comments."
          value={user.displayName || ""}
          placeholder="Your display name"
          onSave={(v) => updateProfile("displayName", v)}
          onRegisterSave={(save, cancel) => { sectionSaveRef.current = save; sectionCancelRef.current = cancel; }}
          onDirtyChange={setSectionDirty}
        />
        <SettingsDisplayRow label="Email Address" description="Used to sign in and receive account emails.">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] text-fg-strong font-medium">{user.email}</span>
          </div>
        </SettingsDisplayRow>
        {sectionDirty && (
          <div className="flex justify-end pt-2">
            <SaveButton
              onSave={() => sectionSaveRef.current?.()}
              onCancel={() => { sectionCancelRef.current?.(); setSectionDirty(false); }}
              hasChanges={sectionDirty}
              saveLabel="Save Changes"
            />
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Preferences">
        <SettingsRow label="Theme" description="Choose how Cortardo looks to you.">
          <div className="relative min-w-[120px]">
            <OpenDropdown
              open={themeOpen}
              onClick={() => setThemeOpen((open) => !open)}
              value={THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
              aria-label="Theme"
            />
            {themeOpen && (
              <>
                <OpenDropdownBackdrop onClick={() => setThemeOpen(false)} />
                <OpenDropdownMenu align="right" className="min-w-[150px]">
                  {THEME_OPTIONS.map((option) => (
                    <OpenDropdownItem
                      key={option.value}
                      selected={option.value === theme}
                      onClick={() => {
                        setTheme(option.value);
                        updateProfile("theme", option.value);
                        setThemeOpen(false);
                      }}
                    >
                      {option.label}
                    </OpenDropdownItem>
                  ))}
                </OpenDropdownMenu>
              </>
            )}
          </div>
        </SettingsRow>
        <SettingsRow label="Product updates" description="Occasional emails about new features and improvements.">
          <TinyToggle
            checked={user.productUpdates ?? true}
            onCheckedChange={(v) => saveAccountSettings.mutate({ productUpdates: v })}
          />
        </SettingsRow>
        <SettingsRow label="Security alerts" description="Get notified about sign-ins and account changes.">
          <div className="flex items-center gap-2">
            <span className="flex h-4 items-center">
              <Lock
                size={13}
                strokeWidth={2.5}
                className="text-toggle-on grayscale opacity-50"
                aria-hidden="true"
              />
            </span>
            <span className="grayscale">
              <TinyToggle checked disabled aria-label="Security alerts are always on" title="Security alerts are always on" />
            </span>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function PasswordRow() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault(); setError(null);
    if (next !== confirm) return setError("Passwords don't match");
    if (next.length < 8) return setError("Minimum 8 characters");
    setSaving(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({ message: "Failed" })); throw new Error(d.message); }
      setSuccess(true); setCurrent(""); setNext(""); setConfirm("");
      setTimeout(() => { setSuccess(false); setOpen(false); }, 2000);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  if (!open) {
    return (
      <SettingsRow label="Password" description="Change the password used to sign in.">
        <Button design="pill-ghost" size="xs" onClick={() => setOpen(true)}>Change password</Button>
      </SettingsRow>
    );
  }

  return (
    <>
      <SettingsRow label="Change password" description="Enter your current password, then set a new one." align="start">
        <form onSubmit={submit} className="flex flex-col gap-2.5 w-full sm:w-48">
          {[
            { label: "Current password", val: current, set: setCurrent },
            { label: "New password", val: next, set: setNext },
            { label: "Confirm password", val: confirm, set: setConfirm },
          ].map((f) => (
            <div key={f.label} className="flex flex-col gap-0.5">
              <label className="text-[11px] font-semibold text-foreground">{f.label}</label>
              <TextInput type="password" value={f.val} onChange={(e) => f.set(e.target.value)} required size="sm" />
            </div>
          ))}
          {error && <p className="text-[12px] text-destructive m-0">{error}</p>}
          {success && (
            <p className="flex items-center gap-1 text-[12px] font-semibold text-emerald-600 m-0">
              <Check className="h-3 w-3" /> Updated
            </p>
          )}
        </form>
      </SettingsRow>
      <div className="flex justify-end">
        <SaveButton
          pill
          onSave={() => submit()}
          onCancel={() => { setCurrent(''); setNext(''); setConfirm(''); setError(null); }}
          isSaving={saving}
          hasChanges={!!current || !!next || !!confirm}
          saveLabel="Update"
        />
      </div>
    </>
  );
}

// ── Delete ─────────────────────────────────────────────────────────────────

function DeleteRow({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (confirm !== username) return setError(`Type "${username}" to confirm`);
    setDeleting(true);
    try {
      const res = await fetch("/api/me", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({ message: "Failed" })); throw new Error(d.message); }
      qc.setQueryData(["/api/me"], null);
      await wipeAppCache();
      navigate("/");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setDeleting(false); }
  };

  if (!open) {
    return (
      <SettingsRow label="Delete account" description="Permanently delete your account and all data.">
        <Button design="pill-destructive" size="xs" onClick={() => setOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" /> Delete account
        </Button>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow label="Delete account" description="This can't be undone. Type your username and password to confirm." align="start">
      <form onSubmit={submit} className="flex flex-col gap-2.5 w-full sm:w-48">
        <div className="flex flex-col gap-0.5">
          <label className="text-[11px] font-semibold text-foreground">Your password</label>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} required size="sm" />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[11px] font-semibold text-foreground">Type "{username}" to confirm</label>
          <TextInput type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} required size="sm" />
        </div>
        {error && <p className="text-[12px] text-destructive m-0">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button design="pill-destructive" size="xs" type="submit" disabled={deleting} isLoading={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
          <Button design="pill-ghost" size="xs" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
        </div>
      </form>
    </SettingsRow>
  );
}

// ── Billing ────────────────────────────────────────────────────────────────



// ── VerificationBanner ─────────────────────────────────────────────────────

function VerificationBanner({ emailVerified, pendingEmail, onResend, isResending }: any) {
  if (emailVerified && !pendingEmail) return null;
  return (
    <div className="flex items-start gap-3 pb-4 mb-6 border-b border-border">
      <Clock className="h-4 w-4 text-amber mt-0.5 shrink-0" />
          <div>
            <p className="text-[13px] font-semibold text-amber">
              Pending verification
            </p>
            <p className="text-[12px] text-amber mt-0.5">
          {pendingEmail ? <>Verification sent to <strong>{pendingEmail}</strong></> : "Check your inbox for a verification link."}
        </p>
      </div>
      <Button design="ghost" size="xs" onClick={onResend} disabled={isResending}>
        {isResending ? "Sending…" : "Resend"}
      </Button>
    </div>
  );
}

// ── Sub-pages ──────────────────────────────────────────────────────────────

type AccountLink = { label: string; href: string; hint: string; icon: React.ReactNode };
type AccountNavGroup = { label: string; items: AccountLink[] };

const ACCOUNT_NAV: AccountNavGroup[] = [
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/account/profile", hint: "Name, email, username", icon: <User className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} /> },
      { label: "Sessions", href: "/account/sessions", hint: "Devices where you're signed in", icon: <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} /> },
    ],
  },
  {
    label: "Billing",
    items: [
      { label: "Billing", href: "/account/billing", hint: "Plans & payment", icon: <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} /> },
      { label: "Usage", href: "/account/usage", hint: "Emails, inboxes & domains", icon: <HugeiconsIcon icon={DashboardSpeed01Icon} size={16} strokeWidth={1.5} className="shrink-0 text-muted-foreground" /> },
    ],
  },
  {
    label: "Security & Auth",
    items: [
      { label: "Security", href: "/account/security", hint: "Password & sign out", icon: <Lock className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} /> },
      { label: "Authentication", href: "/account/authentication", hint: "Two-factor authentication", icon: <Key className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} /> },
      { label: "Integrations", href: "/account/integrations", hint: "GitHub & connected apps", icon: <Unplug className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} /> },
    ],
  },
  {
    label: "Danger Zone",
    items: [
      { label: "Danger Zone", href: "/account/actions", hint: "Sign out & delete account", icon: <Zap className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.5} /> },
    ],
  },
];

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    owner: "bg-brand/10 text-brand",
    editor: "bg-violet-50 text-violet-600",
    viewer: "bg-gray-50 text-gray-500",
  };
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${colors[role] ?? colors.viewer}`}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}



function AccountOverview({ user, planLabel, currentPlan }: any) {
  const initials = (user.displayName || user.username)
    .split(" ")
    .map((w: string) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return (
    <div className="py-4">
      {/* Hero row */}
      <div className="flex items-center justify-between gap-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[hsl(220_14%_91%)] shrink-0 text-[15px] font-bold text-foreground">
            {initials}
          </div>
          <div>
            <p className="text-[15px] font-semibold text-foreground m-0">{user.displayName || user.username}</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">@{user.username}</p>
          </div>
        </div>
        <PlanBadge plan={currentPlan} />
      </div>

      {/* Quick links */}
      <SettingsSection title="Account settings">
        {ACCOUNT_NAV.map((group) => (
          <div key={group.label}>
            {group.items.map((link) => (
              <a key={link.href} href={link.href} className="block no-underline group">
                <div className="flex items-center justify-between gap-3 py-3 border-b border-[hsl(var(--surface-hover))] last:border-b-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {link.icon}
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-foreground leading-snug">{link.label}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground leading-snug">{link.hint}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0" strokeWidth={1.5} />
                </div>
              </a>
            ))}
          </div>
        ))}
      </SettingsSection>

    </div>
  );
}

function TwoFactorSection() {
  const [view, setView] = useState<'idle' | 'setup' | 'verify'>('idle');
  const [secret, setSecret] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [emailTwoFactor, setEmailTwoFactor] = useState(true);
  const { data: user } = useUser();

  useEffect(() => {
    if (user?.totpEnabled) setEnabled(true);
  }, [user?.totpEnabled]);

  const handleSetup = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/me/2fa/totp/setup', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to setup');
      const data = await res.json();
      setSecret(data.secret);
      setQrCode(data.qrCode);
      setView('setup');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setSaving(false); }
  };

  const handleEnable = async () => {
    if (verifyCode.length !== 6) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/me/2fa/totp/enable', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode, secret }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Invalid code'); }
      setEnabled(true);
      setView('idle');
      setVerifyCode('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid code'); }
    finally { setSaving(false); }
  };

  const handleDisable = async () => {
    if (!disablePassword) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/me/2fa/totp/disable', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Failed'); }
      setEnabled(false);
      setDisablePassword('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <SettingsSection title="Two-factor authentication">
      {view === 'idle' && (
        <>
          <SettingsRow
            label="Authenticator App"
            description="Use an authenticator app as a second sign-in factor."
          >
            {enabled ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-emerald-600 flex items-center gap-1"><Check size={12} /> Enabled</span>
                <Button design="ghost" size="xs" onClick={() => setView('setup')}>Reconfigure</Button>
              </div>
            ) : (
              <Button design="pill-secondary" size="xs" onClick={handleSetup} isLoading={saving}>
                Get Started
              </Button>
            )}
          </SettingsRow>
          <SettingsRow
            label="2FA"
            description="Send a one-time code to your email when you sign in."
          >
            <TinyToggle
              checked={emailTwoFactor}
              onCheckedChange={setEmailTwoFactor}
              aria-label="Toggle email two-factor authentication"
            />
          </SettingsRow>
        </>
      )}

      {view === 'setup' && (
        <div className="py-4 space-y-4">
          {qrCode && (
            <div className="flex justify-center">
              <img src={qrCode} alt="TOTP QR Code" className="w-40 h-40" />
            </div>
          )}
          {secret && (
            <div className="text-center">
              <p className="text-[11px] text-muted-foreground mb-1">Or enter this code manually:</p>
              <code className="text-[12px] font-mono bg-surface-hover px-3 py-1.5 rounded-lg select-all">{secret}</code>
            </div>
          )}
          {enabled && (
            <SettingsRow label="Disable 2FA" description="Confirm your password to turn off two-factor.">
              <div className="flex items-center gap-2">
                <TextInput type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} placeholder="Current password" size="sm" className="w-36" />
                <Button size="xs" design="destructive" onClick={handleDisable} isLoading={saving} disabled={!disablePassword}>Disable</Button>
              </div>
            </SettingsRow>
          )}
          {!enabled && (
            <>
              <div>
                <label className="text-[11px] font-semibold text-foreground block mb-1">Verify code</label>
                <div className="flex items-center gap-2">
                  <OtpInput value={verifyCode} onChange={setVerifyCode} onComplete={handleEnable} className="w-32" />
                  <Button size="xs" onClick={handleEnable} isLoading={saving} disabled={verifyCode.length !== 6}>Enable</Button>
                  <Button design="ghost" size="xs" onClick={() => { setView('idle'); setError(''); }}>Cancel</Button>
                </div>
              </div>
            </>
          )}
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
      )}
    </SettingsSection>
  );
}

function SessionsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/me/sessions"],
    queryFn: async () => {
      const res = await fetch("/api/me/sessions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/me/sessions/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to revoke session");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/sessions"] });
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/me/sessions/revoke-all", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to revoke sessions");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/sessions"] });
    },
  });

  const sessions = data?.sessions ?? [];
  const currentSession = sessions.find((s: any) => s.isCurrent);
  const otherSessions = sessions.filter((s: any) => !s.isCurrent);

  const formatTime = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const deviceIcon = (device: string) => {
    switch (device) {
      case "iPhone": case "Phone": return "📱";
      case "iPad": case "Tablet": return "📟";
      default: return "💻";
    }
  };

  return (
    <SettingsSection
      title="Active Sessions"
      action={
        otherSessions.length > 0 ? (
          <button
            type="button"
            onClick={() => revokeAllMutation.mutate()}
            disabled={revokeAllMutation.isPending}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] font-medium text-fg-muted transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            {revokeAllMutation.isPending ? "Revoking…" : "Revoke all"}
          </button>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="py-6 text-center">
          <Loader className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-[12.5px] font-[450] text-fg-warm">No active sessions found.</p>
        </div>
      ) : (
        <>
          {currentSession && (
            <SettingsRow
              label={
                <span className="flex items-center gap-3">
                  <span className="text-[16px] shrink-0">{deviceIcon(currentSession.device)}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">
                        {currentSession.browser ?? "Unknown browser"} — {currentSession.os ?? "Unknown OS"}
                      </span>
                      <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-600">
                        Current
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] font-[450] text-fg-warm">
                      {currentSession.location && `${currentSession.location} · `}Active now
                    </span>
                  </span>
                </span>
              }
            />
          )}
          {otherSessions.map((session: any) => (
            <SettingsRow
              key={session.id}
              label={
                <span className="flex items-center gap-3">
                  <span className="text-[16px] shrink-0">{deviceIcon(session.device)}</span>
                  <span className="min-w-0">
                    <span className="block truncate">
                      {session.browser ?? "Unknown browser"} — {session.os ?? "Unknown OS"}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] font-[450] text-fg-warm">
                      {session.location && `${session.location} · `}{formatTime(session.lastActiveAt)}
                    </span>
                  </span>
                </span>
              }
            >
              <button
                type="button"
                onClick={() => revokeMutation.mutate(session.id)}
                disabled={revokeMutation.isPending}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] font-medium text-fg-muted transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
              >
                Revoke
              </button>
            </SettingsRow>
          ))}
        </>
      )}
    </SettingsSection>
  );
}

function SecurityPage() {
  const logout = useLogout();
  return (
    <div className="py-4 space-y-8">
      <SettingsSection title="Password">
        <PasswordRow />
      </SettingsSection>
      <SettingsSection title="Sign Out">
        <SettingsRow label="Sign out" description="End your session on this device.">
          <Button design="pill-secondary" size="xs" onClick={() => logout.mutate()} disabled={logout.isPending} isLoading={logout.isPending}>
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function AuthenticationPage() {
  return (
    <div className="py-4 space-y-8">
      <TwoFactorSection />
    </div>
  );
}

function SessionsPage() {
  return (
    <div className="py-4 space-y-8">
      <SessionsSection />
    </div>
  );
}

function BillingPage({ planInfo, checkoutMutation, portalMutation }: any) {
  const currentPlan: Plan = planInfo?.plan ?? "free";
  const limits = PLAN_LIMITS[currentPlan] ?? PLAN_LIMITS.free;
  const price = limits.prices.monthly;
  const renewsLabel = planInfo?.renewsAt
    ? new Date(planInfo.renewsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const { data: transactionsData } = useQuery<{ transactions: Array<{ id: string; description: string; amount: number; date: string; status: string }> }>({
    queryKey: ['/api/credits/transactions'],
    queryFn: async () => {
      const res = await fetch('/api/credits/transactions', { credentials: 'include' });
      if (!res.ok) return { transactions: [] };
      return res.json();
    },
    retry: false,
  });

  const transactions = transactionsData?.transactions ?? [];
  const paidTiers: PlanTier[] = ["pro", "team", "enterprise"];

  return (
    <div className="py-4 space-y-6">
      <section className="w-full">
        <header className="flex items-end justify-between gap-3">
          <h2 className="font-sans text-[15px] font-medium leading-tight text-foreground">Current Plan</h2>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] font-medium text-fg-muted transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
            >
              {portalMutation.isPending ? "Opening…" : "Manage Subscription"}
              <ArrowRight size={12} />
            </button>
          </div>
        </header>
        <div className="mt-[14px]">
          <MetricCard
            label={`${limits.label} Plan`}
            value={`${CURRENCIES[currency].symbol}${Math.round(price / CURRENCIES[currency].usdPerUnit)}`}
            hint={renewsLabel ? `Renews ${renewsLabel}` : "Billed monthly"}
          />
        </div>
      </section>

      <SettingsSection
        title="Change Plan"
        action={
          <div className="relative min-w-[120px]">
            <OpenDropdown
              open={currencyOpen}
              onClick={() => setCurrencyOpen((open) => !open)}
              value={currency}
              aria-label="Currency"
            />
            {currencyOpen && (
              <>
                <OpenDropdownBackdrop onClick={() => setCurrencyOpen(false)} />
                <OpenDropdownMenu align="right" className="min-w-[170px]">
                  {CURRENCY_CODES.map((code) => (
                    <OpenDropdownItem
                      key={code}
                      selected={code === currency}
                      onClick={() => {
                        setCurrency(code as CurrencyCode);
                        setCurrencyOpen(false);
                      }}
                    >
                      {CURRENCIES[code].label}
                    </OpenDropdownItem>
                  ))}
                </OpenDropdownMenu>
              </>
            )}
          </div>
        }
      >
        {paidTiers.map((key) => {
          const tierLimits = PLAN_LIMITS[key];
          const usdPerUnit = CURRENCIES[currency].usdPerUnit;
          const convertedPrice = Math.round(tierLimits.prices.monthly / usdPerUnit);
          const isCurrent = key === currentPlan;
          return (
            <SettingsRow
              key={key}
              label={tierLimits.label}
              description={`${CURRENCIES[currency].symbol}${convertedPrice}/mo`}
            >
              <Button
                design={isCurrent ? "pill-secondary" : "pill"}
                size="xs"
                onClick={() => checkoutMutation.mutate({ plan: key, currency: currency.toLowerCase() })}
                disabled={isCurrent || checkoutMutation.isPending}
                isLoading={checkoutMutation.isPending}
              >
                {isCurrent ? "Current plan" : "Select"}
              </Button>
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title="Transaction History">
        {transactions.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-[12.5px] font-[450] text-fg-warm">No transactions yet.</p>
          </div>
        ) : (
          transactions.map((t) => (
            <SettingsRow key={t.id} label={t.description} description={t.date}>
              <span className={`text-[13.5px] font-semibold tabular-nums ${t.amount > 0 ? 'text-emerald-600' : 'text-foreground'}`}>
                {t.amount > 0 ? '+' : ''}{t.amount}
              </span>
            </SettingsRow>
          )))}
      </SettingsSection>
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[hsl(var(--surface-hover))] py-1">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full cursor-pointer bg-none border-none text-left py-2.5"
      >
        <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
        <ChevronDown size={14} className="text-fg-muted shrink-0 transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      {open && (
        <div className="pb-3 text-[12px] text-foreground leading-relaxed space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

function DataPage({
  exportInsights,
}: any) {
  return (
    <div className="py-4 space-y-8">
      <SettingsSection title="Export Your Data">
        <SettingsRow label="Account Export">
          <Button design="ghost" size="xs" onClick={exportInsights}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Privacy & Legal">
        <div>
          <CollapsibleSection title="GDPR Rights (UK / EEA)" defaultOpen>
            <p>Under the UK GDPR and EU GDPR, you have the following rights over your personal data:</p>
            <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
              <li><strong className="text-foreground">Right to access</strong> — <button onClick={exportInsights} className="text-brand underline bg-none border-none cursor-pointer p-0 text-[12px]">Download your data</button> using the Export button.</li>
              <li><strong className="text-foreground">Right to rectification</strong> — Update your profile information in the Profile settings.</li>
              <li><strong className="text-foreground">Right to restrict processing</strong> — Contact us to request processing restrictions.</li>
              <li><strong className="text-foreground">Right to data portability</strong> — Your data is available for export in machine-readable JSON format.</li>
              <li><strong className="text-foreground">Right to object</strong> — You can opt out of product update emails in Notifications settings.</li>
            </ul>
            <p className="text-muted-foreground">To exercise any of these rights, email <span className="font-mono text-foreground">privacy@cortardo.com</span>. We will respond within 30 days.</p>
          </CollapsibleSection>

          <CollapsibleSection title="California Privacy Rights (CCPA / CPRA)">
            <p>If you are a California resident, the California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA) provide you with additional rights:</p>
            <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
              <li><strong className="text-foreground">Right to know</strong> — <button onClick={exportInsights} className="text-brand underline bg-none border-none cursor-pointer p-0 text-[12px]">Download your data</button> to see the categories and specific pieces of personal information we collect.</li>
              <li><strong className="text-foreground">Right to delete</strong> — Request deletion of your personal information (see Danger zone).</li>
              <li><strong className="text-foreground">Right to correct</strong> — Update inaccurate personal information in your Profile settings.</li>
              <li><strong className="text-foreground">Right to opt out of sale/share</strong> — We do not sell or share your personal information for cross-context behavioral advertising.</li>
              <li><strong className="text-foreground">Right to non-discrimination</strong> — We will not discriminate against you for exercising your CCPA/CPRA rights.</li>
            </ul>
            <p className="text-muted-foreground">To submit a request under CCPA/CPRA, email <span className="font-mono text-foreground">privacy@cortardo.com</span>. We will acknowledge receipt within 10 business days and respond within 45 days.</p>
          </CollapsibleSection>

          <CollapsibleSection title="Data Retention">
            <p>We retain your personal data only as long as necessary to provide our services and for legitimate business purposes:</p>
            <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
              <li><strong className="text-foreground">Account data</strong> — Retained until you delete your account.</li>
              <li><strong className="text-foreground">Email messages</strong> — Retained until the associated inbox is deleted.</li>
              <li><strong className="text-foreground">Analytics data</strong> — Retained for 24 months.</li>
              <li><strong className="text-foreground">Billing records</strong> — Retained for 7 years as required by tax law.</li>
            </ul>
          </CollapsibleSection>
        </div>
      </SettingsSection>
    </div>
  );
}

function ActionsPage({ username }: { username: string }) {
  const logout = useLogout();
  return (
    <div className="py-4 space-y-8">
      <SettingsSection title="Session">
        <SettingsRow label="Sign out" description="End your session on this device.">
          <Button design="pill-secondary" size="xs" onClick={() => logout.mutate()} disabled={logout.isPending} isLoading={logout.isPending}>
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Delete account">
        <DeleteRow username={username} />
      </SettingsSection>
    </div>
  );
}

function UsageBar({ current, limit, label, description, unit = "", decimals = 0 }: { current: number; limit: number | "unlimited"; label: string; description?: string; unit?: string; decimals?: number }) {
  const fmt = (n: number) => decimals > 0 ? `${unit}${n.toFixed(decimals)}` : `${unit}${n.toLocaleString()}`;
  if (limit === "unlimited") {
    return (
      <SettingsRow label={label} description={description}>
        <span className="text-[13.5px] font-medium text-fg-strong">
          {fmt(current)}
          <span className="text-fg-warm"> / Unlimited</span>
        </span>
      </SettingsRow>
    );
  }
  const pct = Math.min(Math.round((current / limit) * 100), 100);
  const color = pct >= 80 ? "bg-red-500" : pct >= 60 ? "bg-yellow-500" : "bg-brand";
  return (
    <SettingsRow label={label} description={description}>
      <div className="flex items-center gap-3 w-full sm:w-64">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        </div>
          <span className="text-[13.5px] font-medium text-fg-strong shrink-0 tabular-nums">
            {fmt(current)}
            <span className="text-fg-warm"> / {fmt(limit)}</span>
          </span>
      </div>
    </SettingsRow>
  );
}

function UsagePage({ planInfo }: any) {
  const plan = (planInfo?.plan ?? "free") as PlanTier;
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const usage = planInfo?.usage ?? {};

  const pctUsed = (current: number, limit: number | "unlimited") =>
    limit === "unlimited" ? 0 : Math.min(Math.round((current / limit) * 100), 100);

  const overall = limits.projects === "unlimited" ? 50 : pctUsed(usage.projectsCount ?? 0, limits.projects);

  return (
    <div className="py-4 space-y-6">
      <MetricCard
        label={`${limits.label} plan`}
        value={`${overall}%`}
        hint={`Resets ${planInfo?.renewsAt ? new Date(planInfo.renewsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'monthly'}`}
      />

      <SettingsSection title="Detailed Usage">
        <UsageBar
          label="Repositories"
          description="Repositories connected to this workspace."
          current={usage.projectsCount ?? 0}
          limit={limits.projects}
        />
        <UsageBar
          label="Review files"
          description="Files reviewed by the bot this billing period."
          current={usage.designFilesCount ?? 0}
          limit={limits.designFiles}
        />
      </SettingsSection>
    </div>
  );
}

function AgentPage() {
  return (
    <div className="py-4">
      <SettingsSection title="Your Agents">
        <SettingsRow label="No agents yet">
          <Button size="xs">
            <Zap className="h-3.5 w-3.5" /> Create agent
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

// ─── Root export ───────────────────────────────────────────────────────────

const SECTION_TITLES: Record<string, string> = {
  "": "Account",
  "profile": "Profile",
  "security-auth": "Security",
  "security": "Security",
  "settings": "Settings",
  "authentication": "Authentication",
  "sessions": "Sessions",
  "billing": "Billing",
  "usage": "Usage",
  "integrations": "Integrations",
  "integrations/github": "GitHub",
  "team": "Team",
  "actions": "Danger Zone",
};

export default function Account() {
  const { data: user, isLoading, refetch } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location] = useLocation();
  const section = location.startsWith("/account/") ? location.slice("/account/".length) : "";

  const exportInsights = async () => {
    try {
      const r = await fetch("/api/me/export", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      const blob = await r.blob();
      const disposition = r.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="?([^"]+)"?/i)?.[1] ?? `cortardo-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", variant: "success" });
    } catch (err) { toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" }); }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") { toast({ title: "Email verified", variant: "success" }); refetch(); window.history.replaceState({}, "", window.location.pathname); }
    if (params.get("email-changed") === "1") { toast({ title: "Email updated", variant: "success" }); refetch(); window.history.replaceState({}, "", window.location.pathname); }
    if (params.get("billing") === "success") {
      const plan = params.get("plan") ?? "free";
      fetch("/api/billing/success", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ plan }) }).catch(console.error);
      toast({ title: "Subscription active!", variant: "success" }); window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const resendMutation = useMutation({
    mutationFn: async () => { const r = await fetch("/api/me/resend-verification", { method: "POST", credentials: "include" }); if (!r.ok) throw new Error("Failed"); },
    onSuccess: () => toast({ title: "Verification email sent", variant: "success" }),
    onError: (err) => toast({ title: "Failed", description: (err as Error).message, variant: "destructive" }),
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ plan, billingPeriod, currency }: { plan: PlanTier; billingPeriod?: string; currency?: string }) => {
      const r = await fetch("/api/billing/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ plan, billingPeriod: billingPeriod ?? "monthly", currency: currency?.toLowerCase() ?? "usd" }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: "Failed to create checkout session" }));
        throw new Error(err.message ?? "Failed to create checkout session");
      }
      return r.json() as Promise<{ url?: string; ok?: boolean; message?: string }>;
    },
    onSuccess: (d) => {
      if (d.url) { window.location.href = d.url; return; }
      if (d.ok) {
        toast({ title: "Plan updated", description: d.message, variant: "success" });
        queryClient.invalidateQueries({ queryKey: ["/api/me/plan"] });
        return;
      }
      toast({ title: "Billing unavailable", variant: "destructive" });
    },
    onError: (err) => toast({ title: "Billing unavailable", description: (err as Error).message, variant: "destructive" }),
  });

  type PlanInfo = {
    plan: PlanTier; status: string | null; cancelAtPeriodEnd: boolean;
    billingPeriod: "monthly" | "annual";
    renewsAt: string | null;
    limits: { label: string; prices: { monthly: number; annual: number } };
    usage: {};
  };
  const { data: planInfo } = useQuery<PlanInfo>({
    queryKey: ["/api/me/plan"], enabled: !!user,
    refetchInterval: 30000, refetchOnWindowFocus: true,
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/billing/portal", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ url: string }>;
    },
    onSuccess: (d) => { if (d.url) window.location.href = d.url; },
    onError: (err) => toast({ title: "Portal unavailable", description: (err as Error).message, variant: "destructive" }),
  });

  const saveAccountSettings = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const r = await fetch("/api/me", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("Failed"); return r.json();
    },
    onSuccess: (updated) => { queryClient.setQueryData(["/api/me"], updated); toast({ title: "Saved", variant: "success" }); },
    onError: (err) => toast({ title: "Failed to save", description: (err as Error).message, variant: "destructive" }),
  });

  const updateProfile = async (field: "displayName" | "email" | "theme", value: string) => {
    const r = await fetch("/api/me", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ [field]: value }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({ message: "Failed" })); throw new Error(d.message ?? "Failed"); }
    const updated = await r.json();
    queryClient.setQueryData(["/api/me"], updated);
    if (field === "email" && updated.emailChangePending) {
      toast({ title: "Verification sent", description: `Check ${value} to confirm.`, variant: "success" });
    } else {
      toast({ title: "Profile updated", variant: "success" });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col justify-center">
        <ListSkeleton rows={8} />
      </div>
    );
  }

  if (!user) return null;

  const displayName = (user as any).displayName;
  const email = (user as any).email ?? "";
  const emailVerified = (user as any).emailVerified ?? false;
  const pendingEmail = (user as any).pendingEmail;
  const currentPlan = planInfo?.plan ?? "free";
  const planLabel = planInfo?.limits?.label ?? "Free";

const contentBySection: Record<string, React.ReactNode> = {
  "": <AccountOverview user={user} planLabel={planLabel} currentPlan={currentPlan} />,
  "profile": <ProfilePage user={user} updateProfile={updateProfile} emailVerified={emailVerified} pendingEmail={pendingEmail} onResend={() => resendMutation.mutate()} isResending={resendMutation.isPending} refetch={refetch} saveAccountSettings={saveAccountSettings} />,
  "security-auth": <SecurityPage />,
  "security": <SecurityPage />,
  "settings": <SecurityPage />,
  "authentication": <AuthenticationPage />,
  "sessions": <SessionsPage />,
  "billing": <BillingPage planInfo={planInfo} checkoutMutation={checkoutMutation} portalMutation={portalMutation} />,
  "usage": <UsagePage planInfo={planInfo} />,
  "integrations": <GithubIntegrationsPage />,
  "integrations/github": <GithubIntegrationDetailsPage />,
  "team": <TeamPageView />,

  "actions": <ActionsPage username={user.username} />,
};

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 min-w-0 bg-page border-b border-[hsl(var(--surface-hover))] overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8">
          {contentBySection[section] ?? contentBySection["profile"]}
        </div>
      </div>
    </div>
  );
}
