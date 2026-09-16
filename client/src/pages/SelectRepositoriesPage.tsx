import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Lock, Plus, RefreshCw } from 'lucide-react';
import { ReviewPageShell } from '@/components/review/bits';
import { Button } from '@/components/button';
import { SettingsSection, SettingsRow } from '@/components/settings-ui';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useGithubStatus,
  useInstallationRepositories,
  useStartGithubInstall,
  useUpdateRepositorySelection,
  type GithubInstallationSummary,
  type InstallationRepository,
} from '@/hooks/use-github';

function SecureLock() {
  return (
    <span title="Secure connection" className="inline-flex shrink-0 items-center">
      <Lock size={13} className="text-success" strokeWidth={2.5} aria-label="Secure connection" />
    </span>
  );
}

function RowSkeleton() {
  return (
    <div className="flex min-h-11 animate-pulse flex-row items-center justify-between gap-3 py-[12px]">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3.5 w-40 rounded bg-surface-hover" />
        <div className="h-2.5 w-56 rounded bg-surface-hover" />
      </div>
      <div className="h-6 w-16 shrink-0 rounded bg-surface-hover" />
    </div>
  );
}

export default function SelectRepositoriesPage() {
  const { toast } = useToast();
  const { activeWorkspaceId } = useWorkspace();

  const statusQuery = useGithubStatus(activeWorkspaceId);
  const startInstall = useStartGithubInstall();
  const installation: GithubInstallationSummary | null = statusQuery.data?.installations[0] ?? null;

  const catalogQuery = useInstallationRepositories(installation?.id ?? null);
  const updateSelection = useUpdateRepositorySelection();

  const [connectOpen, setConnectOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const repositories = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const connected = useMemo(() => repositories.filter((repo) => repo.imported), [repositories]);
  const available = useMemo(() => repositories.filter((repo) => !repo.imported), [repositories]);

  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !installation || !catalogQuery.data) return;
    if (connected.length === 0 && available.length > 0) {
      autoOpened.current = true;
      setConnectOpen(true);
    }
  }, [installation, catalogQuery.data, connected.length, available.length]);

  const handleConnectGitHub = () => {
    if (!activeWorkspaceId) return;
    startInstall.mutate(activeWorkspaceId, {
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
      onError: (error) =>
        toast({
          title: 'Could not open GitHub',
          description: (error as Error).message,
          variant: 'destructive',
        }),
    });
  };

  const handleConnect = (repository: InstallationRepository) => {
    if (!installation) return;
    setConnectingId(repository.externalId);
    const next = new Set([...connected.map((repo) => repo.externalId), repository.externalId]);
    updateSelection.mutate(
      { installationId: installation.id, externalIds: [...next] },
      {
        onSuccess: () => {
          toast({
            title: 'Repository connected',
            description: `${repository.fullName} — building its codebase map now.`,
            variant: 'success',
          });
          setConnectingId(null);
        },
        onError: (error) => {
          toast({
            title: 'Could not connect repository',
            description: (error as Error).message,
            variant: 'destructive',
          });
          setConnectingId(null);
        },
      },
    );
  };

  return (
    <ReviewPageShell
      title="Manage Repositories"
      description={
        installation
          ? `Repositories Cortardo reviews and maps for @${installation.accountLogin ?? 'this installation'}.`
          : 'Connect repositories for Cortardo to review and map.'
      }
    >
      <div className="space-y-8">
        {statusQuery.isLoading ? (
          <SettingsSection title="Repositories">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </SettingsSection>
        ) : !installation ? (
          <SettingsSection title="Repositories">
            <SettingsRow
              label="GitHub"
              description="Not connected — connect to review pull requests and map repositories."
            >
              <Button size="sm" onClick={handleConnectGitHub} isLoading={startInstall.isPending}>
                <ExternalLink size={14} />
                Connect GitHub
              </Button>
            </SettingsRow>
          </SettingsSection>
        ) : (
          <SettingsSection
            title="Repositories"
            action={
              <Button
                design="outline"
                size="sm"
                aria-expanded={connectOpen}
                onClick={() => setConnectOpen((open) => !open)}
              >
                <Plus size={14} />
                Connect More
              </Button>
            }
          >
            {catalogQuery.isLoading ? (
              <>
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </>
            ) : catalogQuery.isError ? (
              <SettingsRow
                label="Could not load repositories"
                description={(catalogQuery.error as Error)?.message || 'Please try again.'}
              >
                <Button design="outline" size="sm" onClick={() => catalogQuery.refetch()}>
                  <RefreshCw size={14} />
                  Retry
                </Button>
              </SettingsRow>
            ) : connected.length === 0 ? (
              <SettingsRow
                label="No repositories connected"
                description="Connect repositories for Cortardo to review. Each one gets a codebase map and automatic pull request reviews."
              />
            ) : (
              connected.map((repo) => (
                <SettingsRow
                  key={repo.externalId}
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{repo.fullName}</span>
                      <SecureLock />
                    </span>
                  }
                  description={
                    <span className="font-mono">
                      {repo.defaultBranch}
                      {repo.codegraphStatus === 'ready' && repo.codegraphFileCount > 0
                        ? ` · ${repo.codegraphFileCount.toLocaleString()} files`
                        : ''}
                    </span>
                  }
                />
              ))
            )}
          </SettingsSection>
        )}

        {installation && connectOpen && (
          <SettingsSection
            title="Available repositories"
            action={
              <Button design="ghost" size="sm" onClick={() => setConnectOpen(false)}>
                Done
              </Button>
            }
          >
            {available.length === 0 ? (
              <SettingsRow
                label="No more repositories available"
                description="This GitHub installation does not have access to any other repositories yet."
              >
                <Button design="outline" size="sm" onClick={handleConnectGitHub} isLoading={startInstall.isPending}>
                  <ExternalLink size={14} />
                  Manage GitHub access
                </Button>
              </SettingsRow>
            ) : (
              available.map((repo) => (
                <SettingsRow
                  key={repo.externalId}
                  label={<span className="font-mono">{repo.fullName}</span>}
                  description={<span className="font-mono">{repo.defaultBranch}</span>}
                >
                  <Button
                    design="outline"
                    size="xs"
                    disabled={updateSelection.isPending}
                    isLoading={connectingId === repo.externalId}
                    onClick={() => handleConnect(repo)}
                  >
                    Connect
                  </Button>
                </SettingsRow>
              ))
            )}
          </SettingsSection>
        )}
      </div>
    </ReviewPageShell>
  );
}
