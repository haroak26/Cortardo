import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";

export type Workspace = {
  id: string;
  name: string;
  logoUrl?: string | null;
  publicKey: string;
  role: string;
  confidenceThreshold: number;
};

type WorkspaceContextType = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  isLoading: boolean;
  switchingWorkspace: boolean;
  switchingWsPhase: 'idle' | 'logging-out' | 'signing-in';
  switchingWsName: string;
};

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

function WorkspaceProviderInner({ children }: { children: React.ReactNode }) {
  const { data: user } = useUser();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      const stored = window.localStorage.getItem("cortardo.activeWorkspaceId");
      if (stored) return stored;
      return null;
    } catch {
      return null;
    }
  });

  // Use lastWorkspaceId from user data when available
  useEffect(() => {
    if (!selectedId && user && (user as any).lastWorkspaceId) {
      setSelectedId((user as any).lastWorkspaceId);
    }
  }, [user?.id]);

  const queryClient = useQueryClient();
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [switchingWsPhase, setSwitchingWsPhase] = useState<'idle' | 'logging-out' | 'signing-in'>('idle');
  const [switchingWsName, setSwitchingWsName] = useState('');

  const { data: rawWorkspaces = [], isLoading } = useQuery<Workspace[], Error, Workspace[]>({
    queryKey: ["/api/workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces", { credentials: "include" });
      if (res.status === 401) return [];
      if (!res.ok) throw new Error("Failed to fetch workspaces");
      return res.json();
    },
    select: (data) => (Array.isArray(data) ? data : []),
    enabled: !!user,
  });

  const workspaces = useMemo(() => rawWorkspaces, [rawWorkspaces]);

  const activeWorkspaceId = selectedId ?? workspaces[0]?.id ?? null;
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const setActiveWorkspaceId = (id: string) => {
    if (id === activeWorkspaceId) return;
    // Instant switch — scoped queries revalidate in the background while
    // cached data keeps the UI populated (no artificial interstitial).
    setSelectedId(id);
    try { window.localStorage.setItem("cortardo.activeWorkspaceId", id); } catch {}
    // Invalidate scoped data so stale cross-workspace data is cleared
    queryClient.invalidateQueries({ queryKey: ['/api/spaces'] });
    // Persist to server
    fetch('/api/me/last-workspace', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: id }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!activeWorkspaceId) return;
    try { window.localStorage.setItem("cortardo.activeWorkspaceId", activeWorkspaceId); } catch {}
  }, [activeWorkspaceId]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspaceId,
        activeWorkspace,
        setActiveWorkspaceId,
        isLoading,
        switchingWorkspace,
        switchingWsPhase,
        switchingWsName,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  return <WorkspaceProviderInner>{children}</WorkspaceProviderInner>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
