import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ExternalLink, FolderGit2, Plus } from 'lucide-react';
import { ReviewPageShell } from '@/components/review/bits';
import { Badge } from '@/components/ds';
import { Button } from '@/components/button';
import { OpenDropdownBackdrop, OpenDropdownItem, OpenDropdownMenu } from '@/components/open-dropdown';
import { SettingsCardSkeleton } from '@/components/skeleton-cards';
import { SettingsRow, SettingsSection } from '@/components/settings-ui';
import { RepositoryCodebaseMapPreview } from '@/components/review/codegraph/RepositoryCodebaseMap';
import { TinyToggle } from '@/components/ui/tiny-toggle';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useGithubStatus,
  useInstallationRepositories,
  useRepositories,
  useStartGithubInstall,
  useUpdateRepository,
  useUpdateRepositorySelection,
  type ApiRepository,
  type InstallationRepository,
} from '@/hooks/use-github';
import { timeAgo } from '@/lib/mock-review-data';

type FilterId = 'all' | 'enabled' | 'paused';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'enabled', label: 'Reviewing' },
  { id: 'paused', label: 'Paused' },
];

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

export default function RepositoriesPage() {
  const { toast } = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const [filter, setFilter] = useState<FilterId>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const statusQuery = useGithubStatus(activeWorkspaceId);
  const reposQuery = useRepositories(activeWorkspaceId);
  const startInstall = useStartGithubInstall();
  const updateRepository = useUpdateRepository();
  const updateSelection = useUpdateRepositorySelection();

  const installation = statusQuery.data?.installations[0] ?? null;
  const catalogQuery = useInstallationRepositories(installation?.id ?? null);
  const available = useMemo(
    () => (catalogQuery.data ?? []).filter((repo) => !repo.imported),
    [catalogQuery.data],
  );

  const repositories = reposQuery.data ?? [];
  const isEnabled = (repo: ApiRepository) => overrides[repo.id] ?? repo.reviewEnabled;

  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !installation || !catalogQuery.data) return;
    if (repositories.length === 0 && available.length > 0) {
      autoOpened.current = true;
      setConnectOpen(true);
    }
  }, [installation, catalogQuery.data, repositories.length, available.length]);

  const filtered = useMemo(
    () =>
      repositories.filter((repo) => {
        const enabled = isEnabled(repo);
        return filter === 'all' || (filter === 'enabled' ? enabled : !enabled);
      }),
    [repositories, filter, overrides],
  );

  const handleConnect = () => {
    if (!activeWorkspaceId) return;
    if (!statusQuery.data?.configured) {
      toast({
        title: 'GitHub App is not configured',
        description: 'Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY on the server, then try again.',
        variant: 'destructive',
      });
      return;
    }
    startInstall.mutate(activeWorkspaceId, {
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
      onError: (error) =>
        toast({
          title: 'Could not start GitHub install',
          description: (error as Error).message,
          variant: 'destructive',
        }),
    });
  };

  const handleToggle = (repo: ApiRepository, checked: boolean) => {
    setOverrides((prev) => ({ ...prev, [repo.id]: checked }));
    updateRepository.mutate(
      { id: repo.id, reviewEnabled: checked },
      {
        onError: (error) => {
          setOverrides((prev) => {
            const next = { ...prev };
            delete next[repo.id];
            return next;
          });
          toast({
            title: 'Could not update repository',
            description: (error as Error).message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleConnectRepository = (repository: InstallationRepository) => {
    if (!installation) return;
    setConnectingId(repository.externalId);
    const importedIds = (catalogQuery.data ?? [])
      .filter((repo) => repo.imported)
      .map((repo) => repo.externalId);
    updateSelection.mutate(
      { installationId: installation.id, externalIds: [...new Set([...importedIds, repository.externalId])] },
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

  const hasInstallation = Boolean(installation);
  const connectMode = connectOpen && hasInstallation;

  return (
    <ReviewPageShell
      title="Repositories"
      description="Connect repositories and control which ones the bot reviews."
      actions={
        !hasInstallation ? (
          <Button size="sm" onClick={handleConnect} isLoading={startInstall.isPending}>
            <Plus size={15} />
            Connect GitHub
          </Button>
        ) : (
          <>
            <Button
              design="pill"
              icon={Plus}
              className="hover:!bg-primary active:!bg-primary"
              onClick={() => setConnectOpen(true)}
            >
              Connect More
            </Button>
            <div className="relative shrink-0">
              <Button
                design="pill-secondary"
                onClick={() => setFilterOpen((open) => !open)}
                aria-expanded={filterOpen}
                aria-label="Filter repositories"
              >
                Filter
                {filter !== 'all' && (
                  <span aria-hidden="true" className="h-[5px] w-[5px] shrink-0 rounded-full bg-brand" />
                )}
              </Button>
              {filterOpen && (
                <>
                  <OpenDropdownBackdrop onClick={() => setFilterOpen(false)} />
                  <OpenDropdownMenu align="right" className="min-w-[150px]">
                    {FILTERS.map((option) => (
                      <OpenDropdownItem
                        key={option.id}
                        selected={option.id === filter}
                        onClick={() => {
                          setFilter(option.id);
                          setFilterOpen(false);
                        }}
                      >
                        {option.label}
                      </OpenDropdownItem>
                    ))}
                  </OpenDropdownMenu>
                </>
              )}
            </div>
          </>
        )
      }
    >
      {connectMode && installation ? (
        <SettingsSection
          title="Available repositories"
          action={
            <Button design="pill-ghost" size="sm" onClick={() => setConnectOpen(false)}>
              Done
            </Button>
          }
        >
          {catalogQuery.isLoading ? (
            <SettingsRow label="Loading repositories…" />
          ) : available.length === 0 ? (
            <SettingsRow
              label="No more repositories available"
              description="This GitHub installation does not have access to any other repositories yet."
            >
              <Button design="outline" size="sm" onClick={handleConnect} isLoading={startInstall.isPending}>
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
                  design="pill-secondary"
                  size="xs"
                  disabled={updateSelection.isPending}
                  isLoading={connectingId === repo.externalId}
                  onClick={() => handleConnectRepository(repo)}
                >
                  Connect
                </Button>
              </SettingsRow>
            ))
          )}
        </SettingsSection>
      ) : reposQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SettingsCardSkeleton key={i} />
          ))}
        </div>
      ) : repositories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderGit2 size={36} className="mb-3 text-fg-faint" strokeWidth={1.5} />
          <p className="text-[15px] font-medium text-foreground">
            {hasInstallation ? 'No repositories selected' : 'No repositories connected'}
          </p>
          <p className="mt-1 max-w-sm text-[12.5px] text-fg-muted">
            {hasInstallation
              ? 'Choose which repositories Cortardo should track. Each one gets a codebase map and automatic pull request reviews.'
              : 'Install the Cortardo GitHub App to give the bot access to your pull requests. You choose which repositories it can see.'}
          </p>
          {hasInstallation ? (
            <Button size="sm" className="mt-5" onClick={() => setConnectOpen(true)}>
              <Plus size={15} />
              Connect More
            </Button>
          ) : (
            <Button size="sm" className="mt-5" onClick={handleConnect} isLoading={startInstall.isPending}>
              <Plus size={15} />
              Connect GitHub
            </Button>
          )}
        </div>
      ) : (
        <>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FolderGit2 size={32} className="mb-3 text-fg-faint" strokeWidth={1.5} />
              <p className="text-[14px] font-medium text-foreground">No repositories match this view</p>
              <p className="text-[12px] text-fg-muted mt-1">Try a different filter, or connect a new repository.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((repo) => {
                const enabled = isEnabled(repo);
                return (
                  <div
                    key={repo.id}
                    className="group relative flex h-full flex-col overflow-hidden rounded-[12px] border border-[hsl(var(--surface-hover))] bg-card"
                  >
                    <Link
                      href={`/review/repositories/${repo.id}`}
                      aria-label={`Open ${repo.fullName}`}
                      className="absolute inset-0 z-0 rounded-[12px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    />

                    <div className="px-[12px] py-[12px]">
                      <div className="pointer-events-none relative overflow-hidden rounded-[8px]">
                        <RepositoryCodebaseMapPreview
                          repositoryId={repo.id}
                          className="h-[140px]"
                        />
                        {repo.installation?.suspended && (
                          <Badge
                            tone="warning"
                            className="pointer-events-none absolute right-2 top-2"
                          >
                            Suspended
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-[hsl(var(--surface-hover))] px-[12px] transition-colors group-hover:bg-surface-hover group-active:bg-surface-hover/80">
                      <SettingsRow
                        label={<span className="block truncate font-mono">{repo.fullName}</span>}
                        description={
                          <span className="block truncate">
                            {PROVIDER_LABELS[repo.provider] ?? repo.provider}
                            {' · '}
                            {repo.lastReviewedAt
                              ? `reviewed ${timeAgo(repo.lastReviewedAt)}`
                              : 'never reviewed'}
                            {repo.codegraphStatus === 'ready' &&
                              repo.codegraphFileCount > 0 &&
                              ` · ${repo.codegraphFileCount.toLocaleString()} files`}
                          </span>
                        }
                      >
                        <div className="relative z-10 flex items-center gap-1">
                          <TinyToggle
                            checked={enabled}
                            onCheckedChange={(checked) => handleToggle(repo, checked)}
                            aria-label={`${enabled ? 'Pause' : 'Resume'} reviews for ${repo.fullName}`}
                          />
                        </div>
                      </SettingsRow>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </ReviewPageShell>
  );
}
