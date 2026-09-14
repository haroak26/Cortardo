import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FolderGit2,
  GitPullRequest,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/button";
import { Badge, ListSkeleton } from "@/components/ds";
import { SettingsSection, SettingsRow } from "@/components/settings-ui";
import { RepositoryPicker } from "@/components/github/RepositoryPicker";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useClaimGithubInstallation,
  useDisconnectGithubInstallation,
  useGithubStatus,
  useRepositories,
  useStartGithubInstall,
  useSyncGithubInstallation,
  type GithubInstallationSummary,
} from "@/hooks/use-github";
import { useLocation } from "wouter";

const RESULT_MESSAGES: Record<
  string,
  { title: string; description?: string; variant: "success" | "destructive" | "default" }
> = {
  connected: {
    title: "GitHub connected",
    description: "Cortardo can now review pull requests on the repositories you selected.",
    variant: "success",
  },
  pending: {
    title: "Finish connecting GitHub",
    description: "Your GitHub install is waiting to be linked to this workspace.",
    variant: "default",
  },
  error: {
    title: "Could not connect GitHub",
    description: "The install could not be completed. Please try again.",
    variant: "destructive",
  },
  state_error: {
    title: "GitHub install expired",
    description: "Start the connection again from this page.",
    variant: "destructive",
  },
  access_denied: {
    title: "Access denied",
    description: "You do not have access to the workspace this install was started from.",
    variant: "destructive",
  },
  unconfigured: {
    title: "GitHub App is not configured",
    description: "Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY on the server.",
    variant: "destructive",
  },
};

export function GithubIntegrationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const [, setLocation] = useLocation();
  const [pickerInstallation, setPickerInstallation] = useState<GithubInstallationSummary | null>(null);

  const statusQuery = useGithubStatus(activeWorkspaceId);
  const reposQuery = useRepositories(activeWorkspaceId);
  const startInstall = useStartGithubInstall();
  const claimInstall = useClaimGithubInstallation();
  const syncInstall = useSyncGithubInstallation();
  const disconnect = useDisconnectGithubInstallation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("github");
    if (!result) return;
    const workspaceId = params.get("workspaceId");
    if (workspaceId && workspaceId !== activeWorkspaceId) {
      setActiveWorkspaceId(workspaceId);
    }
    queryClient.invalidateQueries({ queryKey: ["/api/github/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/repositories"] });
    const message = RESULT_MESSAGES[result] ?? {
      title: "GitHub connection updated",
      variant: "default" as const,
    };
    toast(message);
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = () => {
    if (!activeWorkspaceId) return;
    startInstall.mutate(activeWorkspaceId, {
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
      onError: (error) =>
        toast({
          title: "Could not start GitHub install",
          description: (error as Error).message,
          variant: "destructive",
        }),
    });
  };

  const handleClaim = () => {
    claimInstall.mutate(undefined, {
      onSuccess: () =>
        toast({
          title: "GitHub connected",
          description: "Repositories are now available.",
          variant: "success",
        }),
      onError: (error) =>
        toast({
          title: "Could not finish the connection",
          description: (error as Error).message,
          variant: "destructive",
        }),
    });
  };

  const handleSync = (installationId: string) => {
    syncInstall.mutate(installationId, {
      onSuccess: ({ repositories }) =>
        toast({
          title: "Repositories synced",
          description: `${repositories} repositories are available.`,
          variant: "success",
        }),
      onError: (error) =>
        toast({ title: "Sync failed", description: (error as Error).message, variant: "destructive" }),
    });
  };

  const handleDisconnect = (installationId: string, login: string | null) => {
    const label = login ? `@${login}` : "this installation";
    if (
      !window.confirm(
        `Disconnect ${label}? This uninstalls the Cortardo app from GitHub and removes its repositories, reviews, and codebase maps from this workspace.`,
      )
    ) {
      return;
    }
    disconnect.mutate(
      { id: installationId },
      {
        onSuccess: () =>
          toast({
            title: "GitHub disconnected",
            description: "The Cortardo app was uninstalled from GitHub.",
            variant: "success",
          }),
        onError: (error) =>
          toast({ title: "Disconnect failed", description: (error as Error).message, variant: "destructive" }),
      },
    );
  };

  if (statusQuery.isLoading) return <ListSkeleton rows={5} />;

  const status = statusQuery.data;

  if (statusQuery.isError) {
    return (
      <SettingsSection
        title="GitHub"
      >
        <div className="flex items-start gap-3 py-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} />
          <div className="text-[13px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Could not load GitHub status</p>
            <p className="mt-1">{(statusQuery.error as Error)?.message || "Please try again."}</p>
            <Button design="outline" size="sm" className="mt-3" onClick={() => statusQuery.refetch()}>
              <RefreshCw size={14} />
              Retry
            </Button>
          </div>
        </div>
      </SettingsSection>
    );
  }

  // Workspace (and therefore the status query) may not be ready yet.
  if (!status) return <ListSkeleton rows={5} />;

  if (!status.configured) {
    return (
      <SettingsSection
        title="GitHub"
      >
        <div className="flex items-start gap-3 py-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber" strokeWidth={1.5} />
          <div className="text-[13px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">GitHub App is not configured</p>
            <p className="mt-1">
              Add <code className="rounded bg-surface-hover px-1 py-0.5 text-[12px]">GITHUB_APP_ID</code>,{" "}
              <code className="rounded bg-surface-hover px-1 py-0.5 text-[12px]">GITHUB_APP_SLUG</code>,{" "}
              <code className="rounded bg-surface-hover px-1 py-0.5 text-[12px]">GITHUB_APP_PRIVATE_KEY</code> and{" "}
              <code className="rounded bg-surface-hover px-1 py-0.5 text-[12px]">GITHUB_WEBHOOK_SECRET</code> to the
              server environment, then restart.
            </p>
          </div>
        </div>
      </SettingsSection>
    );
  }

  const installations = status.installations;

  return (
    <div className="space-y-8">
      {status.pendingInstallation && (
        <SettingsSection
          title="Finish connecting"
        >
          <SettingsRow label="GitHub installation">
            <Button size="sm" onClick={handleClaim} isLoading={claimInstall.isPending}>
              <CheckCircle2 size={15} />
              Finish connecting
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection
        title="GitHub"
        action={
          <Button size="sm" onClick={handleConnect} isLoading={startInstall.isPending}>
            <ExternalLink size={14} />
            {installations.length === 0 ? "Connect GitHub" : "Add installation"}
          </Button>
        }
      >
        {installations.length === 0 ? (
          <div className="py-4 text-[13px] text-muted-foreground">
            No GitHub installation is connected to this workspace yet.
          </div>
        ) : (
          installations.map((installation) => (
            <SettingsRow
              key={installation.id}
              label={
                <span className="flex flex-wrap items-center gap-2">
                  <span>@{installation.accountLogin ?? "unknown"}</span>
                  <Badge tone={installation.suspended ? "warning" : "success"} size="sm">
                    {installation.suspended
                      ? "Suspended"
                      : installation.accountType === "Organization"
                        ? "Organization"
                        : "Connected"}
                  </Badge>
                </span>
              }
            >
              <Button
                design="outline"
                size="sm"
                onClick={() => setPickerInstallation(installation)}
              >
                <FolderGit2 size={14} />
                Choose repos
              </Button>
              <Button
                design="outline"
                size="sm"
                onClick={() => handleSync(installation.id)}
                isLoading={syncInstall.isPending}
              >
                <RefreshCw size={14} />
                Sync
              </Button>
              <Button
                design="ghost"
                size="sm"
                onClick={() => handleDisconnect(installation.id, installation.accountLogin)}
                isLoading={disconnect.isPending}
              >
                <Unplug size={14} />
                Disconnect
              </Button>
            </SettingsRow>
          ))
        )}
      </SettingsSection>

      <SettingsSection
        title="Repositories"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {installations[0] && (
              <Button
                design="outline"
                size="sm"
                onClick={() => setPickerInstallation(installations[0])}
              >
                <FolderGit2 size={14} />
                Choose repositories
              </Button>
            )}
            <Button
              design="outline"
              size="sm"
              onClick={() => setLocation("/review/repositories")}
            >
              <GitPullRequest size={14} />
              Manage repositories
            </Button>
          </div>
        }
      >
        <SettingsRow label="Connected repositories">
          <span className="text-[13.5px] tabular-nums text-muted-foreground">
            {reposQuery.isLoading ? "…" : `${reposQuery.data?.length ?? 0}`}
          </span>
        </SettingsRow>
        <SettingsRow label="Codebase maps ready">
          <span className="text-[13.5px] tabular-nums text-muted-foreground">
            {reposQuery.isLoading
              ? "…"
              : `${(reposQuery.data ?? []).filter((repo) => repo.codegraphStatus === "ready").length}`}
          </span>
        </SettingsRow>
      </SettingsSection>

      <RepositoryPicker
        open={Boolean(pickerInstallation)}
        onOpenChange={(open) => {
          if (!open) setPickerInstallation(null);
        }}
        installation={pickerInstallation}
      />
    </div>
  );
}
