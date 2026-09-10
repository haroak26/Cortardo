import React, { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { Loader, Check, X, Building2 } from "lucide-react";
import { Button } from "@/components/button";

type InviteInfo = {
  workspaceName: string;
  workspaceLogoUrl?: string | null;
  inviterEmail?: string;
  role: string;
};

export default function InviteAccept() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [, navigate] = useLocation();
  const { data: user, isLoading: userLoading } = useUser();

  const [status, setStatus] = useState<"loading" | "ready" | "accepted" | "declined" | "error">("loading");
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invites/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          if (j.declined) {
            setStatus("declined");
            return;
          }
          setErrorMsg(j.message ?? j.error ?? "Invalid or expired invite link.");
          setStatus("error");
          return;
        }
        const data = await res.json();
        setInfo(data);
        setStatus("ready");
      })
      .catch(() => {
        setErrorMsg("Failed to load invite details.");
        setStatus("error");
      });
  }, [token]);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/invites/${token}/accept`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Failed to accept invite");
      return json;
    },
    onSuccess: () => {
      setStatus("accepted");
      setTimeout(() => navigate("/home/inbox"), 2000);
    },
    onError: (e: any) => {
      setErrorMsg(e.message);
      setStatus("error");
    },
  });

  const declineMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/invites/${token}/decline`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Failed to decline invite");
      return json;
    },
    onSuccess: () => {
      setStatus("declined");
    },
    onError: (e: any) => {
      setErrorMsg(e.message);
      setStatus("error");
    },
  });

  const roleLabel: Record<string, string> = {
    owner: "Owner",
    editor: "Editor",
    viewer: "Viewer",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--surface))] px-4">
      <div className="w-full max-w-md bg-background border border-border rounded-[24px] shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-brand/5 border-b border-border px-8 py-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-[14px] bg-brand/10 mb-3">
            <Building2 size={22} className="text-brand" />
          </div>
          <h1 className="text-[20px] font-bold text-foreground">Workspace Invitation</h1>
          <p className="text-[13px] text-fg-muted mt-1">You've been invited to join a workspace</p>
        </div>

        {/* Body */}
        <div className="px-8 py-7">
          {(status === "loading" || userLoading) && (
            <div className="flex items-center justify-center py-8 gap-2 text-fg-muted">
              <Loader size={16} className="animate-spin" />
              <span className="text-[13px]">Loading invite details…</span>
            </div>
          )}

          {status === "ready" && info && (
            <div className="space-y-6">
              {/* Workspace info */}
              <div className="flex items-center gap-3 p-4 bg-surface-active rounded-[14px] border border-border/60">
                {info.workspaceLogoUrl ? (
                  <img src={info.workspaceLogoUrl} alt={info.workspaceName} className="w-10 h-10 rounded-[10px] object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-[10px] bg-brand flex items-center justify-center shrink-0">
                    <span className="text-white font-bold text-[16px]">{info.workspaceName.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground">{info.workspaceName}</div>
                </div>
              </div>

              {/* Role */}
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-fg-muted">Your role</span>
                <span className="font-semibold text-foreground">{roleLabel[info.role] ?? info.role}</span>
              </div>

              {/* Action */}
              {user ? (
                <div className="space-y-3">
                  <div className="text-[13px] text-fg-muted text-center">
                    Accepting as <span className="font-medium text-foreground">{user.email}</span>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => acceptMutation.mutate()}
                    disabled={acceptMutation.isPending}
                  >
                    {acceptMutation.isPending ? (
                      <><Loader size={13} className="animate-spin mr-2" />Accepting…</>
                    ) : (
                      <>
                        <Check size={13} className="mr-2" />
                        Accept invitation
                      </>
                    )}
                  </Button>
                  <Button
                    design="ghost"
                    size="xs"
                    className="w-full"
                    onClick={() => declineMutation.mutate()}
                    disabled={declineMutation.isPending}
                  >
                    {declineMutation.isPending ? (
                      <><Loader size={13} className="animate-spin mr-2" />Declining…</>
                    ) : (
                      <>
                        <X size={13} className="mr-2" />
                        Decline invitation
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-[13px] text-fg-muted text-center">
                    Sign in or create an account to accept this invitation.
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => navigate(`/auth/login?redirect=/invite/${token}`)}
                  >
                    Sign in to accept
                  </Button>
                  <Button
                    design="ghost"
                    size="xs"
                    className="w-full"
                    onClick={() => {
                      sessionStorage.setItem("pendingInvite", token);
                      navigate(`/auth/signup`);
                    }}
                  >
                    Create an account
                  </Button>
                </div>
              )}
            </div>
          )}

          {status === "accepted" && (
            <div className="text-center py-6 space-y-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 mb-2">
                <Check size={22} className="text-emerald-600" />
              </div>
              <div className="text-[16px] font-semibold text-foreground">Invitation accepted!</div>
              <div className="text-[13px] text-fg-muted">Redirecting you to the workspace…</div>
            </div>
          )}

          {status === "declined" && (
            <div className="text-center py-6 space-y-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-2">
                <X size={22} className="text-red-500" />
              </div>
              <div className="text-[16px] font-semibold text-foreground">Invitation declined</div>
              <div className="text-[13px] text-fg-muted">This invite has been declined and can no longer be accepted.</div>
              <Button onClick={() => navigate("/")} design="ghost" size="xs" className="hover:underline mt-2">
                Go to homepage
              </Button>
            </div>
          )}

          {status === "error" && (
            <div className="text-center py-6 space-y-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-2">
                <X size={22} className="text-red-500" />
              </div>
              <div className="text-[16px] font-semibold text-foreground">Invalid invite</div>
              <div className="text-[13px] text-fg-muted">{errorMsg ?? "This invite link is invalid or has expired."}</div>
              <Button onClick={() => navigate("/")} design="ghost" size="xs" className="hover:underline mt-2">
                Go to homepage
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
