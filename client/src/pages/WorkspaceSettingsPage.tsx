import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit01Icon } from "@hugeicons/core-free-icons";
import { ReviewPageShell } from "@/components/review/bits";
import {
  SettingsDisplayRow,
  SettingsRow,
  SettingsSection,
  SettingsTextRow,
  SaveButton,
} from "@/components/settings-ui";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { ListSkeleton } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { useWorkspace, type Workspace } from "@/contexts/workspace-context";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

function workspaceInitials(name: string | null | undefined): string {
  const str = (name || "?").trim();
  const parts = str.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return str[0]?.toUpperCase() ?? "?";
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <ReviewPageShell
      title="Workspace"
      description="Manage your workspace details, logo, and preferences."
      back={{ href: "/workspace/home", label: "Back to workspace" }}
      maxWidth="max-w-3xl"
    >
      {children}
    </ReviewPageShell>
  );
}

function DeleteWorkspaceRow({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (confirm !== workspace.name) return setError(`Type "${workspace.name}" to confirm`);
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ message: "Failed to delete workspace" }));
        throw new Error(d.message ?? "Failed to delete workspace");
      }
      try { window.localStorage.removeItem("cortardo.activeWorkspaceId"); } catch {}
      await queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      toast({ title: "Workspace deleted", variant: "success" });
      navigate("/workspace/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete workspace");
      setDeleting(false);
    }
  };

  if (!open) {
    return (
      <SettingsRow
        label="Delete workspace"
        description="Permanently removes the workspace and its data."
      >
        <Button design="pill-destructive" size="xs" onClick={() => setOpen(true)}>
          Delete workspace
        </Button>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow
      label="Delete workspace"
      description="This can't be undone. Type the workspace name to confirm."
      align="start"
    >
      <form onSubmit={submit} className="flex w-full flex-col gap-2.5 sm:w-48">
        <div className="flex flex-col gap-0.5">
          <label className="text-[11px] font-semibold text-foreground">
            Type "{workspace.name}" to confirm
          </label>
          <TextInput
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            size="sm"
            required
          />
        </div>
        {error && <p className="m-0 text-[12px] text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button design="pill-destructive" size="xs" type="submit" disabled={deleting} isLoading={deleting}>
            Delete
          </Button>
          <Button
            design="pill-ghost"
            size="xs"
            onClick={() => { setOpen(false); setConfirm(""); setError(null); }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </SettingsRow>
  );
}

export default function WorkspaceSettingsPage() {
  const { activeWorkspace: ws, isLoading: workspaceLoading } = useWorkspace();
  const { data: user, isLoading: userLoading } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoOverride, setLogoOverride] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const logoUrl = logoOverride === undefined ? ws?.logoUrl ?? null : logoOverride;
  const originalBudget = ws?.creditBudget != null ? String(ws.creditBudget) : "";

  useEffect(() => {
    if (!ws) return;
    setName(ws.name);
    setBudget(ws.creditBudget != null ? String(ws.creditBudget) : "");
    setLogoOverride(undefined);
    setError(null);
  }, [ws?.id]);

  const canEdit = ["owner", "admin", "editor"].includes(ws?.role ?? "");
  const isOwner = ws?.role === "owner";

  const dirty = !!ws && (name.trim() !== ws.name || budget.trim() !== originalBudget);

  const resetDraft = () => {
    if (!ws) return;
    setName(ws.name);
    setBudget(ws.creditBudget != null ? String(ws.creditBudget) : "");
    setError(null);
  };

  const handleSave = async () => {
    if (!ws || !canEdit || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (name.trim() !== ws.name) payload.name = name.trim();
      if (budget.trim() !== originalBudget) {
        const parsed = budget.trim() === "" ? null : Number(budget);
        if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
          throw new Error("Credit budget must be a positive number");
        }
        payload.creditBudget = parsed;
      }
      const res = await fetch(`/api/workspaces/${ws.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Failed to save workspace");
      await queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      toast({ title: "Workspace updated", variant: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workspace");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !ws) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch(`/api/workspaces/${ws.id}/logo`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Failed to upload logo");
      setLogoOverride(json.logoUrl ?? null);
      queryClient.setQueryData<Workspace[]>(["/api/workspaces"], (prev) =>
        (prev ?? []).map((w) => (w.id === ws.id ? { ...w, logoUrl: json.logoUrl ?? null } : w)),
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      toast({ title: "Logo updated", variant: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (workspaceLoading || (userLoading && !user)) {
    return (
      <PageShell>
        <ListSkeleton rows={6} />
      </PageShell>
    );
  }

  if (!ws) {
    return (
      <PageShell>
        <div className="flex h-40 items-center justify-center">
          <p className="text-[13px] text-fg-muted">Select a workspace to view its details</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="space-y-8 pb-8">
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        {!canEdit && (
          <p className="text-[13px] text-fg-muted">
            You have view-only access to this workspace. Ask an owner or admin to make changes.
          </p>
        )}

        <SettingsSection title="Workspace details">
          <SettingsRow label="Logo" description="Shown in the sidebar and on invite pages.">
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={handleLogoUpload}
                className="hidden"
                id="workspace-logo-upload"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || !canEdit}
                aria-label="Change workspace logo"
                className="group relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-[10px] border-none bg-transparent p-0 disabled:cursor-not-allowed"
              >
                {logoUrl ? (
                  <img src={logoUrl} alt={ws.name} className="h-11 w-11 rounded-[10px] object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-brand text-[15px] font-bold text-white">
                    {workspaceInitials(ws.name)}
                  </span>
                )}
                {canEdit && (
                  <span
                    className={cn(
                      "absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/45 transition-opacity",
                      uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    {uploading ? (
                      <Loader className="h-4 w-4 animate-spin text-white" />
                    ) : (
                      <HugeiconsIcon icon={Edit01Icon} size={16} strokeWidth={1.75} className="text-white" />
                    )}
                  </span>
                )}
              </button>
            </div>
          </SettingsRow>

          <SettingsTextRow
            label="Name"
            description="Displayed across the app and to your team."
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            disabled={!canEdit}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          />

          <SettingsTextRow
            label="Credit budget"
            description="Credit limit for this workspace. Leave empty for no limit."
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="No limit"
            suffix="credits"
            disabled={!canEdit}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          />
        </SettingsSection>

        <SettingsSection title="Information">
          <SettingsDisplayRow label="Workspace slug" description="Generated automatically from the workspace name.">
            <span className="text-[13px] text-muted-foreground">{ws.slug ?? ""}</span>
          </SettingsDisplayRow>
          <SettingsDisplayRow label="Your role" description="Controls what you can change in this workspace.">
            <span className="text-[13px] text-muted-foreground">
              {ROLE_LABELS[ws.role] ?? ws.role}
            </span>
          </SettingsDisplayRow>
          {ws.createdAt && (
            <SettingsDisplayRow label="Created" description="When this workspace was created.">
              <span className="text-[13px] text-muted-foreground">
                {new Date(ws.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </SettingsDisplayRow>
          )}
          <SettingsDisplayRow label="Support code" description="Share this with support to identify your workspace.">
            <span className="text-[13px] font-mono tracking-wide text-muted-foreground">
              {ws.supportCode ?? "—"}
            </span>
          </SettingsDisplayRow>
        </SettingsSection>

        {canEdit && dirty && (
          <SaveButton
            onSave={handleSave}
            onCancel={resetDraft}
            isSaving={saving}
            hasChanges={dirty}
            saveLabel="Save changes"
          />
        )}

        {isOwner && (
          <SettingsSection title="Danger zone">
            <DeleteWorkspaceRow workspace={ws} />
          </SettingsSection>
        )}
      </div>
    </PageShell>
  );
}
