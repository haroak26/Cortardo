import { useEffect, useMemo, useRef, useState } from "react";
import {
  Crown02Icon,
  UserCircleIcon,
  Shield01Icon,
  Mail01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Check, Copy, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";

export interface CollabPanelProps {
  /** Workspace the current project belongs to — members are invited here. */
  workspaceId: string | null;
  /** Role of the current user within that workspace, used when the owner
      isn't represented by a membership row (fallback only). */
  myRoleFallback?: string | null;
  /** Full-screen page layout (mobile) vs. editor sidebar column. */
  page?: boolean;
}

interface RawMember {
  id: string;
  workspaceId: string;
  userId: string | null;
  email: string;
  role: string;
  status: string;
  displayName: string | null;
  avatarUrl: string | null;
  inviteToken: string | null;
  inviteExpiry: string | null;
  createdAt: string;
}

type InviteRole = "editor" | "viewer";

const INVITE_ROLES: { id: InviteRole; label: string; icon: typeof UserCircleIcon }[] = [
  { id: "editor", label: "Editor", icon: UserCircleIcon },
  { id: "viewer", label: "Viewer", icon: Shield01Icon },
];

const ROLE_META: Record<string, { label: string; icon: typeof UserCircleIcon; className: string }> = {
  owner: { label: "Owner", icon: Crown02Icon, className: "bg-warning/10 text-warning" },
  admin: { label: "Admin", icon: Crown02Icon, className: "bg-warning/10 text-warning" },
  editor: { label: "Editor", icon: UserCircleIcon, className: "bg-brand/10 text-brand" },
  viewer: { label: "Viewer", icon: Shield01Icon, className: "bg-surface-hover text-fg-muted" },
};

const AVATAR_COLORS = [
  "#284B63",
  "#4A7A96",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#F97316",
];

const CAN_MANAGE_ROLES = ["owner", "admin", "editor"];

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

function memberName(m: Pick<RawMember, "displayName" | "email">) {
  return m.displayName || m.email.split("@")[0];
}

export function CollabPanel({ workspaceId, myRoleFallback, page }: CollabPanelProps) {
  const queryClient = useQueryClient();
  const { data: user } = useUser();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; link?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const membersKey = workspaceId ? [`/api/workspaces/${workspaceId}/members`] : null;

  const { data: rawMembers, isLoading, isError } = useQuery<RawMember[]>({
    queryKey: membersKey ?? [],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load members");
      return res.json();
    },
    enabled: !!workspaceId,
    staleTime: 15_000,
  });

  const members = useMemo(() => rawMembers ?? [], [rawMembers]);

  const meMember = useMemo(
    () => members.find((m) => m.userId === user?.id),
    [members, user?.id],
  );

  const myRole = meMember?.role ?? myRoleFallback ?? "viewer";
  const canInvite = CAN_MANAGE_ROLES.includes(myRole);

  const others = useMemo(() => {
    const list = members.filter((m) => m.userId !== user?.id && m.status !== "declined");
    const rank: Record<string, number> = { owner: 0, admin: 1, editor: 2, viewer: 3 };
    return [...list].sort((a, b) => (rank[a.role] ?? 4) - (rank[b.role] ?? 4));
  }, [members, user?.id]);

  const activeCount = others.filter((m) => m.status === "active").length;
  const pendingMembers = others.filter((m) => m.status === "pending");

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) setInvited(null);
  }, [workspaceId]);

  const inviteMutation = useMutation({
    mutationFn: async ({ email: to, role: withRole }: { email: string; role: InviteRole }) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: to, role: withRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to send invite");
      return data as RawMember & { inviteUrl?: string };
    },
    onSuccess: (data, vars) => {
      setInvited({ email: vars.email, link: data.inviteUrl });
      setEmail("");
      setInviteError(null);
      queryClient.invalidateQueries({ queryKey: membersKey ?? [] });
    },
    onError: (err) => {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to cancel invite");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersKey ?? [] });
    },
    onError: () => {
      setCancellingId(null);
    },
  });

  const submit = () => {
    const to = email.trim();
    if (!to || !workspaceId || inviteMutation.isPending) return;
    setInvited(null);
    inviteMutation.mutate({ email: to, role });
  };

  const copyLink = () => {
    if (!invited?.link) return;
    navigator.clipboard.writeText(invited.link).catch(() => {});
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const cancelInvite = (memberId: string) => {
    setCancellingId(memberId);
    cancelMutation.mutate(memberId);
  };

  const myName = user?.displayName || user?.username || user?.email?.split("@")[0] || "You";
  const myAvatarColor = "hsl(var(--brand))";

  const totalMembers = activeCount + 1;

  return (
    <div className={cn("flex flex-col", page ? "w-full mx-auto max-w-[560px] px-4 py-5" : "px-1.5 pt-1 pb-2")}>
      {/* ── Header (sidebar column only — the mobile page has its own top bar) ── */}
      {!page && (
        <div className="flex items-center justify-between gap-2 px-2.5 pt-1.5 pb-1">
          <span className="text-[11.5px] font-semibold text-foreground">Collab</span>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-[9.5px] font-medium text-fg-faint tabular-nums">
              {totalMembers} member{totalMembers === 1 ? "" : "s"}
            </span>
            {canInvite && (
              <a
                href="/team/manage"
                className="text-[9.5px] font-semibold text-fg-muted hover:text-brand transition-colors shrink-0 border-none bg-transparent cursor-pointer no-underline"
              >
                Manage team
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Invite composer ── */}
      {canInvite ? (
        <div className={cn("rounded-[12px] bg-surface-hover", page ? "p-3.5" : "px-2.5 py-2.5 mt-1")}>
          <div>
            <p className="text-[10.5px] font-semibold text-foreground leading-tight">Invite teammates</p>
            <p className={cn("text-[9px] text-fg-faint leading-relaxed", page ? "mt-1" : "mt-[2px]")}>
              They join your workspace and can see this project.
            </p>
          </div>

          <div
            className={cn(
              "flex items-center gap-1.5 mt-2 px-2 rounded-[8px] bg-background border border-transparent transition-colors",
              page ? "h-[34px]" : "h-[28px]",
              "focus-within:border-brand/50",
              inviteError && "border-danger/40"
            )}
          >
            <HugeiconsIcon icon={Mail01Icon} size={13} strokeWidth={1.75} className="text-fg-faint shrink-0" />
            <input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setInviteError(null);
                setInvited(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="name@company.com"
              type="email"
              aria-label="Email to invite"
              className="flex-1 min-w-0 bg-transparent outline-none text-[11px] font-[450] text-foreground placeholder:text-fg-faint p-0 border-none"
            />
            {inviteMutation.isPending && <Loader2 size={12} className="animate-spin text-fg-faint shrink-0" />}
          </div>

          <div className={cn("flex items-center gap-1.5", page ? "mt-2.5" : "mt-1.5")}>
            <div className="flex items-center gap-0.5 flex-1 min-w-0">
              {INVITE_ROLES.map((r) => {
                const Icon = r.icon;
                const active = role === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRole(r.id)}
                    className={cn(
                      "flex items-center justify-center gap-1 flex-1 rounded-[7px] text-[9.5px] font-semibold transition-colors border-none cursor-pointer",
                      page ? "h-[26px]" : "h-[22px]",
                      active
                        ? "bg-background text-brand shadow-sm"
                        : "bg-transparent text-fg-muted hover:text-foreground hover:bg-background/50"
                    )}
                  >
                    <HugeiconsIcon icon={Icon} size={10} strokeWidth={1.75} />
                    {r.label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={submit}
              disabled={!email.trim() || !workspaceId || inviteMutation.isPending}
              className={cn(
                "flex items-center justify-center px-3 rounded-[8px] text-[10px] font-semibold transition-all border-none cursor-pointer shrink-0",
                page ? "h-[26px]" : "h-[22px]",
                "bg-brand text-white hover:bg-[hsl(var(--brand-hover))] active:scale-[0.97]",
                "disabled:opacity-40 disabled:pointer-events-none"
              )}
            >
              Send invite
            </button>
          </div>

          {inviteError && <p className="mt-1.5 text-[9.5px] font-medium text-danger">{inviteError}</p>}

          {invited && (
            <div className={cn("flex items-center gap-2 rounded-[8px] bg-success/10 px-2", page ? "py-1.5 mt-2" : "py-1 mt-1.5")}>
              <span className="flex items-center justify-center w-[16px] h-[16px] rounded-full bg-success/15 shrink-0">
                <Check size={10} strokeWidth={3} className="text-success" />
              </span>
              <p className="text-[9.5px] text-fg-soft leading-snug flex-1 min-w-0">
                <span className="font-semibold text-foreground">Invite sent</span> to{" "}
                <span className="truncate font-medium">{invited.email}</span>
              </p>
              {invited.link && (
                <button
                  onClick={copyLink}
                  className={cn(
                    "flex items-center gap-1 px-2 rounded-[6px] text-[9px] font-semibold border-none cursor-pointer shrink-0 transition-colors",
                    copied ? "text-success bg-success/15" : "text-fg-muted hover:text-foreground hover:bg-surface-hover"
                  )}
                >
                  {copied ? <Check size={9} strokeWidth={3} /> : <Copy size={9} />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={cn("rounded-[12px] border border-dashed border-border/70 px-3 py-2.5 flex items-start gap-2.5", page ? "mt-4" : "mt-1")}>
          <span className="flex items-center justify-center w-[20px] h-[20px] rounded-[6px] bg-surface-hover shrink-0">
            <HugeiconsIcon icon={Shield01Icon} size={11} strokeWidth={1.75} className="text-fg-muted" />
          </span>
          <p className="text-[10px] text-fg-muted leading-relaxed">
            You have <span className="font-semibold text-foreground">view-only</span> access. Ask the
            workspace owner to invite teammates to this project.
          </p>
        </div>
      )}

      {/* ── Pending invites ── */}
      {canInvite && pendingMembers.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between px-2.5 pb-0.5">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-fg-faint">
              Invites sent
            </p>
            <span className="text-[9px] font-medium text-fg-faint tabular-nums">
              {pendingMembers.length}
            </span>
          </div>
          <div className="space-y-[1px]">
            {pendingMembers.map((m) => {
              const name = memberName(m);
              return (
                <div
                  key={m.id}
                  className="group flex items-center gap-2 px-2.5 py-[5px] rounded-[8px] hover:bg-surface-hover/60 transition-colors"
                >
                  <span className="flex items-center justify-center w-[22px] h-[22px] rounded-[6px] bg-warning/10 shrink-0">
                    <HugeiconsIcon icon={Mail01Icon} size={10} strokeWidth={1.75} className="text-warning" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground truncate leading-[14px]">{name}</p>
                    <p className="text-[9px] text-fg-faint truncate leading-[12px]">{m.email}</p>
                  </div>
                  <span className="flex items-center gap-1 px-1.5 h-[16px] rounded-full bg-warning/10 text-warning text-[8.5px] font-semibold shrink-0">
                    <span className="w-[4px] h-[4px] rounded-full bg-warning" />
                    Pending
                  </span>
                  <button
                    onClick={() => cancelInvite(m.id)}
                    aria-label={`Cancel invite for ${name}`}
                    className="flex items-center justify-center w-[20px] h-[20px] rounded-[6px] text-fg-faint hover:text-danger hover:bg-danger/10 border-none cursor-pointer transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 bg-transparent"
                  >
                    {cancellingId === m.id ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <X size={11} strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── People ── */}
      <div className={cn("min-h-0", page ? "mt-5" : "mt-2.5")}>
        <div className="flex items-center justify-between px-2.5 pb-0.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-fg-faint">People</p>
          <span className="text-[9px] font-medium text-fg-faint tabular-nums">{members.length}</span>
        </div>

        <div className={cn("space-y-[1px]", page && "mt-1")}>
          {/* You */}
          <div className="flex items-center gap-2.5 px-2.5 py-[6px] rounded-[8px]">
            <span className="relative shrink-0">
              <span
                className="flex items-center justify-center w-[24px] h-[24px] rounded-full text-[8px] font-bold text-white shrink-0"
                style={{ background: myAvatarColor }}
              >
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  initialsOf(myName)
                )}
              </span>
              <span className="absolute -bottom-[1px] -right-[1px] w-[8px] h-[8px] rounded-full border-[1.5px] border-background bg-success" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-foreground truncate leading-[14px]">
                {myName}
                <span className="ml-1.5 text-[8.5px] font-bold text-brand bg-brand/10 rounded-full px-1.5 py-[1px] align-middle">
                  You
                </span>
              </p>
              <p className="text-[9px] text-fg-faint truncate leading-[13px]">{user?.email}</p>
            </div>
            <span
              className={cn(
                "flex items-center gap-1 px-1.5 h-[17px] rounded-[5px] text-[8.5px] font-semibold shrink-0",
                ROLE_META[myRole]?.className ?? "bg-surface-hover text-fg-muted"
              )}
            >
              <HugeiconsIcon icon={ROLE_META[myRole]?.icon ?? UserIcon} size={9} strokeWidth={2} />
              {ROLE_META[myRole]?.label ?? myRole}
            </span>
          </div>

          {/* Others */}
          {others.length === 0 ? (
            !isLoading && (
              <div className="mt-1.5 rounded-[10px] border border-dashed border-border/70 px-3 py-4 text-center">
                {canInvite ? (
                  <>
                    <div className="flex items-center justify-center -space-x-1.5 mb-2">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="flex items-center justify-center w-[22px] h-[22px] rounded-full border-2 border-background text-[7.5px] font-bold text-fg-faint"
                          style={{ background: "hsl(var(--surface-hover))" }}
                        >
                          {i === 1 ? <HugeiconsIcon icon={UserIcon} size={9} strokeWidth={1.5} /> : ""}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10.5px] font-semibold text-foreground">No collaborators yet</p>
                    <p className="text-[9px] text-fg-faint mt-[3px] leading-relaxed">
                      Invite teammates to review and build screens together in real time.
                    </p>
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={UserIcon} size={15} strokeWidth={1.5} className="text-fg-muted mb-1.5 mx-auto" />
                    <p className="text-[10.5px] font-semibold text-foreground">You're working solo</p>
                    <p className="text-[9px] text-fg-faint mt-[3px] leading-relaxed">
                      Invites are managed by the workspace owner.
                    </p>
                  </>
                )}
              </div>
            )
          ) : (
            <>
              {others
                .filter((m) => m.status === "active")
                .map((m, i) => {
                  const name = memberName(m);
                  const meta = ROLE_META[m.role] ?? ROLE_META.viewer;
                  const Icon = meta.icon;
                  return (
                    <div
                      key={m.id}
                      className="group flex items-center gap-2.5 px-2.5 py-[6px] rounded-[8px] hover:bg-surface-hover/60 transition-colors"
                    >
                      <span className="relative shrink-0">
                        <span
                          className="flex items-center justify-center w-[24px] h-[24px] rounded-full text-[8px] font-bold text-white shrink-0"
                          style={{ background: m.avatarUrl ? undefined : AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                        >
                          {m.avatarUrl ? (
                            <img src={m.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                          ) : (
                            initialsOf(name)
                          )}
                        </span>
                        <span className="absolute -bottom-[1px] -right-[1px] w-[8px] h-[8px] rounded-full border-[1.5px] border-background bg-success" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-foreground truncate leading-[14px]">{name}</p>
                        <p className="text-[9px] text-fg-faint truncate leading-[13px]">{m.email}</p>
                      </div>
                      <span
                        className={cn(
                          "flex items-center gap-1 px-1.5 h-[17px] rounded-[5px] text-[8.5px] font-semibold shrink-0",
                          meta.className
                        )}
                      >
                        <HugeiconsIcon icon={Icon} size={9} strokeWidth={2} />
                        {meta.label}
                      </span>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      </div>

      {isLoading && workspaceId && (
        <div className="px-2.5 py-2 flex items-center justify-center gap-1.5">
          <Loader2 size={11} className="animate-spin text-fg-faint" />
          <span className="text-[9.5px] text-fg-faint">Loading members…</span>
        </div>
      )}

      {isError && (
        <div className="px-2.5 py-2 text-center">
          <p className="text-[9.5px] text-fg-faint">Couldn't load members — try again later.</p>
        </div>
      )}

      {page && canInvite && (
        <div className="mt-4 pt-3 border-t border-border/40 flex justify-center">
          <a
            href="/team/manage"
            className="text-[11px] font-semibold text-fg-muted hover:text-brand transition-colors border-none bg-transparent cursor-pointer no-underline"
          >
            Manage team
          </a>
        </div>
      )}
    </div>
  );
}
