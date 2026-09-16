import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  Loader,
  Lock,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { Button, IconButton } from "@/components/button";
import { Badge, ListSkeleton } from "@/components/ds";
import { SettingsSection, SettingsRow } from "@/components/settings-ui";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useClaimGithubInstallation,
  useDisconnectGithubInstallation,
  useGithubStatus,
  useRepositories,
  useStartGithubInstall,
} from "@/hooks/use-github";

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

const COMING_SOON: { name: string; description: string }[] = [
  { name: "Bitbucket", description: "Review pull requests and map your repositories." },
  { name: "GitLab", description: "Review merge requests and map your repositories." },
  { name: "Slack", description: "Send review summaries to your channels." },
  { name: "Linear", description: "Turn review findings into tracked issues." },
];

function PageHeader({
  title,
  description,
  back,
}: {
  title: string;
  description: string;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-7">
      <h1 className="font-sans text-[15px] font-medium leading-tight text-foreground">{title}</h1>
      <div className="mt-0.5 flex items-center justify-between gap-3">
        <p className="text-[12px] font-[450] leading-snug text-fg-warm">{description}</p>
        {back && (
          <Link
            href={back.href}
            className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-fg-muted no-underline transition-colors hover:text-foreground"
          >
            {back.label}
            <ArrowRight size={12} />
          </Link>
        )}
      </div>
    </header>
  );
}

function GithubStatusError({ error, onRetry }: { error: Error | null | undefined; onRetry: () => void }) {
  return (
    <SettingsSection title="GitHub">
      <div className="flex items-start gap-3 py-4">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} />
        <div className="text-[13px] leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Could not load GitHub status</p>
          <p className="mt-1">{error?.message || "Please try again."}</p>
          <Button design="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

function GithubUnconfigured() {
  return (
    <SettingsSection title="GitHub">
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

function SecureLock() {
  return (
    <span title="Secure connection" className="inline-flex shrink-0 items-center">
      <Lock size={13} className="text-success" strokeWidth={2.5} aria-label="Secure connection" />
    </span>
  );
}

export function GithubIntegrationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();

  const statusQuery = useGithubStatus(activeWorkspaceId);

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

  let body: ReactNode;

  if (statusQuery.isLoading) {
    body = <ListSkeleton rows={5} />;
  } else if (statusQuery.isError) {
    body = <GithubStatusError error={statusQuery.error as Error} onRetry={() => statusQuery.refetch()} />;
  } else if (!statusQuery.data) {
    // Workspace (and therefore the status query) may not be ready yet.
    body = <ListSkeleton rows={5} />;
  } else if (!statusQuery.data.configured) {
    body = <GithubUnconfigured />;
  } else {
    const installation = statusQuery.data.installations[0] ?? null;
    const connected = statusQuery.data.installations.length > 0;

    body = (
      <div className="space-y-8">
        <SettingsSection title="Connected">
          <Link href="/account/integrations/github" className="block no-underline">
            <div className="-mx-[12px] flex min-h-11 cursor-pointer items-center justify-between gap-3 px-[12px] py-[12px] transition-colors hover:bg-surface-hover/60">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium leading-snug text-fg-strong">GitHub</p>
                <p className="mt-0.5 text-[12px] font-[450] leading-snug text-fg-warm">
                  {connected
                    ? installation?.accountLogin
                      ? `@${installation.accountLogin}`
                      : "GitHub App installation"
                    : "Review pull requests and map your repositories."}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {installation?.suspended ? (
                  <Badge tone="warning">Suspended</Badge>
                ) : connected ? (
                  <SecureLock />
                ) : null}
                <ChevronRight size={14} strokeWidth={2.5} className="text-fg-faint" />
              </div>
            </div>
          </Link>
        </SettingsSection>

        <SettingsSection title="Coming soon">
          {COMING_SOON.map((integration) => (
            <SettingsRow key={integration.name} label={integration.name} description={integration.description} />
          ))}
        </SettingsSection>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect the tools Cortardo works with."
      />
      {body}
    </div>
  );
}

export function GithubIntegrationDetailsPage() {
  const { toast } = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const [, setLocation] = useLocation();

  const statusQuery = useGithubStatus(activeWorkspaceId);
  const reposQuery = useRepositories(activeWorkspaceId);
  const startInstall = useStartGithubInstall();
  const claimInstall = useClaimGithubInstallation();
  const disconnect = useDisconnectGithubInstallation();

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

  let body: ReactNode;

  if (statusQuery.isLoading) {
    body = <ListSkeleton rows={5} />;
  } else if (statusQuery.isError) {
    body = <GithubStatusError error={statusQuery.error as Error} onRetry={() => statusQuery.refetch()} />;
  } else if (!statusQuery.data) {
    body = <ListSkeleton rows={5} />;
  } else if (!statusQuery.data.configured) {
    body = <GithubUnconfigured />;
  } else {
    const installations = statusQuery.data.installations;
    body = (
      <div className="space-y-8">
        {statusQuery.data.pendingInstallation && (
          <SettingsSection title="Finish connecting">
            <SettingsRow
              label="GitHub installation"
              description="Your GitHub install is waiting to be linked to this workspace."
            >
              <Button size="sm" onClick={handleClaim} isLoading={claimInstall.isPending}>
                <CheckCircle2 size={15} />
                Finish connecting
              </Button>
            </SettingsRow>
          </SettingsSection>
        )}

        <SettingsSection
          title="Connection"
          action={
            installations.length === 0 ? (
              <Button size="sm" onClick={handleConnect} isLoading={startInstall.isPending}>
                <ExternalLink size={14} />
                Connect GitHub
              </Button>
            ) : undefined
          }
        >
          {installations.length === 0 ? (
            <SettingsRow
              label="GitHub"
              description="Not connected — connect to review pull requests and map repositories."
            />
          ) : (
            installations.map((installation) => (
              <SettingsRow
                key={installation.id}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>@{installation.accountLogin ?? "unknown"}</span>
                    {installation.suspended ? (
                      <Badge tone="warning" size="sm">Suspended</Badge>
                    ) : (
                      <SecureLock />
                    )}
                  </span>
                }
                description={installation.accountType === "Organization" ? "Organization" : "Personal account"}
              >
                <IconButton
                  icon={Unplug}
                  design="ghost"
                  size="sm"
                  title="Disconnect"
                  aria-label="Disconnect"
                  disabled={disconnect.isPending}
                  onClick={() => handleDisconnect(installation.id, installation.accountLogin)}
                >
                  {disconnect.isPending ? (
                    <Loader className="h-[14px] w-[14px] animate-spin" aria-hidden="true" />
                  ) : undefined}
                </IconButton>
              </SettingsRow>
            ))
          )}
        </SettingsSection>

        <SettingsSection
          title="Repositories"
          action={
            <Button
              design="outline"
              size="sm"
              onClick={() => setLocation("/review/repositories")}
            >
              <GitPullRequest size={14} />
              Manage Repositories
            </Button>
          }
        >
          <SettingsRow
            label="Connected Repositories"
            description="Repositories this workspace can review and map."
          >
            <span className="text-[13.5px] tabular-nums text-muted-foreground">
              {reposQuery.isLoading ? "…" : `${reposQuery.data?.length ?? 0}`}
            </span>
          </SettingsRow>
          <SettingsRow
            label="Codebase Maps Ready"
            description="Repositories with an up-to-date codebase map."
          >
            <span className="text-[13.5px] tabular-nums text-muted-foreground">
              {reposQuery.isLoading
                ? "…"
                : `${(reposQuery.data ?? []).filter((repo) => repo.codegraphStatus === "ready").length}`}
            </span>
          </SettingsRow>
        </SettingsSection>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="GitHub"
        description="Review pull requests and map your repositories."
        back={{ href: "/account/integrations", label: "Integrations" }}
      />
      {body}
    </div>
  );
}
