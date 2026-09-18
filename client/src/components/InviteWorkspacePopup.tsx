import React, { useEffect, useRef, useState } from "react";
import { Plus, X, ChevronDown, ChevronUp, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface InviteWorkspacePopupProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
}

type Role = "admin" | "editor" | "viewer";

type Invitee = {
  id: string;
  email: string;
  role: Role;
  status?: "pending" | "declined";
};

type MemberRow = {
  id: string;
  email: string;
  role: Role;
  status: string;
};

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

function StatusIcon({ status }: { status?: string }) {
  if (status === "pending") {
    return (
      <span title="Pending" className="shrink-0">
        <Clock size={13} className="text-amber-500" />
      </span>
    );
  }
  if (status === "declined") {
    return (
      <span title="Declined" className="shrink-0">
        <XCircle size={13} className="text-red-500" />
      </span>
    );
  }
  return null;
}

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

export function InviteWorkspacePopup({ open, onClose, workspaceId }: InviteWorkspacePopupProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [roleMenuOpen, setRoleMenuOpen] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setInvitees([]);
      setError("");
      setRoleMenuOpen(null);
      setTimeout(() => emailRef.current?.focus(), 60);
      if (workspaceId) {
        fetch(`/api/workspaces/${workspaceId}/members`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : []))
          .then((data) =>
            setMembers(
              Array.isArray(data)
                ? data
                    .filter((m: any) => m.role !== "owner")
                    .map((m: any) => ({ id: m.id, email: m.email, role: m.role as Role, status: m.status ?? "" }))
                : [],
            ),
          )
          .catch(() => setMembers([]));
      }
    }
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (roleMenuOpen) setRoleMenuOpen(null);
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, roleMenuOpen]);

  if (!open) return null;

  const emailValid = email.trim().length >= 3 && email.includes("@");
  const alreadyAdded = [...members, ...invitees].some(
    (i) => i.email.toLowerCase() === email.trim().toLowerCase(),
  );

  const addInvitee = () => {
    const trimmed = email.trim();
    if (!emailValid || alreadyAdded) return;
    setInvitees((prev) => [
      ...prev,
      { id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11), email: trimmed, role: "editor" },
    ]);
    setEmail("");
    setTimeout(() => emailRef.current?.focus(), 0);
  };

  const updateRole = (id: string, role: Role) => {
    setInvitees((prev) => prev.map((i) => (i.id === id ? { ...i, role } : i)));
  };

  const updateMemberRole = async (id: string, role: Role) => {
    setRoleMenuOpen(null);
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)));
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error("Failed to update role");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  const removeInvitee = (id: string) => {
    setInvitees((prev) => prev.filter((i) => i.id !== id));
  };

  const removeMember = async (id: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove member");
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (invitees.length === 0 || !workspaceId) return;
    setSending(true);
    const failures: string[] = [];
    try {
      for (const invitee of invitees) {
        try {
          const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ email: invitee.email, role: invitee.role }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.message ?? json.error ?? "Failed to invite");
        } catch (err) {
          failures.push(`${invitee.email}: ${err instanceof Error ? err.message : "Something went wrong"}`);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      if (failures.length === 0) {
        toast({ title: `${invitees.length} invitation${invitees.length > 1 ? "s" : ""} sent`, variant: "success" });
        onClose();
      } else {
        setError(failures.join("\n"));
      }
    } finally {
      setSending(false);
    }
  };

  const renderRow = ({
    id,
    email,
    role,
    status,
    onRoleChange,
    onRemove,
  }: {
    id: string;
    email: string;
    role: Role;
    status?: string;
    onRoleChange: (role: Role) => void;
    onRemove: () => void;
  }) => (
    <div key={id} className="flex items-center gap-2 py-1">
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">{email}</span>
        <StatusIcon status={status} />
      </span>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setRoleMenuOpen(roleMenuOpen === id ? null : id)}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-foreground cursor-pointer border-none bg-transparent"
        >
          {roleLabel(role)}
          <ChevronDown
            size={13}
            className={`text-foreground shrink-0 transition-transform duration-200 ease-out ${roleMenuOpen === id ? 'rotate-180' : ''}`}
          />
        </button>
        {roleMenuOpen === id && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setRoleMenuOpen(null)} />
            <div className="absolute right-0 top-full mt-1 z-20 min-w-[130px] bg-background border border-[hsl(var(--surface-hover))] rounded-[12px] p-1 flex flex-col gap-1 shadow-md">
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onRoleChange(opt.value); setRoleMenuOpen(null); }}
                  className={`flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-left transition-colors border-none cursor-pointer ${
                    opt.value === role ? "bg-surface-hover text-fg-soft" : "text-fg-soft hover:bg-surface-hover"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center justify-center w-6 h-6 rounded-[8px] text-fg-muted hover:text-foreground hover:bg-surface-active transition-colors border-none bg-transparent cursor-pointer shrink-0"
        aria-label={`Remove ${email}`}
      >
        <X size={13} />
      </button>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-transparent"
      onClick={onClose}
    >
      <form
        onSubmit={handleInvite}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[340px] bg-background border border-[hsl(var(--surface-hover))] rounded-[12px] shadow-xl p-3 flex flex-col gap-3 animate-in zoom-in-95 fade-in-0 duration-150"
      >
        <div>
          <label className="block text-[12px] font-medium text-foreground mb-1.5">Email address</label>
          <div className="flex items-center gap-2">
            <TextInput
              ref={emailRef}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addInvitee();
                }
              }}
              placeholder="colleague@example.com"
              type="email"
              size="sm"
              className="w-full"
            />
            <Button
              type="button"
              size="sm"
              onClick={addInvitee}
              disabled={!emailValid || alreadyAdded}
              aria-label="Add email"
            >
              <Plus size={14} />
            </Button>
          </div>
          {alreadyAdded && <p className="text-[11px] text-fg-muted mt-1">Already added.</p>}
        </div>

        {(members.length > 0 || invitees.length > 0) && (
          <div className="flex flex-col gap-1">
            {members.map((m) =>
              renderRow({
                id: m.id,
                email: m.email,
                role: m.role,
                status: m.status,
                onRoleChange: (role) => updateMemberRole(m.id, role),
                onRemove: () => removeMember(m.id),
              }),
            )}
            {invitees.map((i) =>
              renderRow({
                id: i.id,
                email: i.email,
                role: i.role,
                status: i.status,
                onRoleChange: (role) => updateRole(i.id, role),
                onRemove: () => removeInvitee(i.id),
              }),
            )}
          </div>
        )}

        {error && <p className="text-[12px] text-destructive whitespace-pre-line">{error}</p>}

        <Button type="submit" size="sm" disabled={invitees.length === 0 || !workspaceId || sending} isLoading={sending}>
          {invitees.length > 0 ? `Send ${invitees.length} invite${invitees.length > 1 ? "s" : ""}` : "Send invite"}
        </Button>
      </form>
    </div>
  );
}