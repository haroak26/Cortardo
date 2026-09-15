import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FolderGit2, Plus, Search, Settings2 } from 'lucide-react';
import { ReviewPageShell } from '@/components/review/bits';
import { RepositoryReviewSettingsDialog } from '@/components/review/RepositoryReviewSettings';
import { Badge } from '@/components/ds';
import { Button } from '@/components/button';
import { SettingsCardSkeleton } from '@/components/skeleton-cards';
import { SettingsCard, SettingsRow } from '@/components/settings-ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/base/dialog';
import { RepositoryPicker } from '@/components/github/RepositoryPicker';
import { RepositoryCodebaseMap, RepositoryCodebaseMapPreview } from '@/components/review/codegraph/RepositoryCodebaseMap';
import { TinyToggle } from '@/components/ui/tiny-toggle';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useGithubStatus,
  useRepositories,
  useStartGithubInstall,
  useUpdateRepository,
  type ApiRepository,
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
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mapRepository, setMapRepository] = useState<ApiRepository | null>(null);
  const [settingsRepository, setSettingsRepository] = useState<ApiRepository | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const statusQuery = useGithubStatus(activeWorkspaceId);
  const reposQuery = useRepositories(activeWorkspaceId);
  const startInstall = useStartGithubInstall();
  const updateRepository = useUpdateRepository();

  const repositories = reposQuery.data ?? [];
  const isEnabled = (repo: ApiRepository) => overrides[repo.id] ?? repo.reviewEnabled;

  const filtered = useMemo(
    () =>
      repositories.filter((repo) => {
        const enabled = isEnabled(repo);
        const matchesFilter =
          filter === 'all' || (filter === 'enabled' ? enabled : !enabled);
        return matchesFilter && repo.fullName.toLowerCase().includes(query.toLowerCase());
      }),
    [repositories, query, filter, overrides],
  );

  useEffect(() => {
    if (!filterOpen) return;
    const handler = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  const activeFilterLabel = FILTERS.find((option) => option.id === filter)?.label ?? 'All';

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

  const hasInstallation = (statusQuery.data?.installations.length ?? 0) > 0;
  const installation = statusQuery.data?.installations[0] ?? null;

  return (
    <ReviewPageShell
      title="Repositories"
      description="Connect repositories and control which ones the bot reviews."
      actions={
        <div className="flex items-center gap-2">
          {hasInstallation ? (
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              <Plus size={15} />
              Choose repositories
            </Button>
          ) : (
            <Button size="sm" onClick={handleConnect} isLoading={startInstall.isPending}>
              <Plus size={15} />
              Connect GitHub
            </Button>
          )}
        </div>
      }
    >
      {reposQuery.isLoading ? (
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
            <Button size="sm" className="mt-5" onClick={() => setPickerOpen(true)}>
              <Plus size={15} />
              Choose repositories
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
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div ref={filterRef} className="relative">
              <button
                type="button"
                onClick={() => setFilterOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={filterOpen}
                className={`flex h-[30px] items-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-medium transition-colors border-none cursor-pointer ${
                  filterOpen
                    ? 'bg-surface-hover text-foreground'
                    : 'bg-transparent text-fg-muted hover:bg-surface-hover hover:text-foreground'
                }`}
              >
                {activeFilterLabel}
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-150 ${filterOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {filterOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(false)} />
                  <div className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[140px] bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md">
                    {FILTERS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setFilter(option.id);
                          setFilterOpen(false);
                        }}
                        className={`flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft transition-colors border-none cursor-pointer text-left ${
                          option.id === filter ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="relative w-full sm:w-[260px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repositories..."
                aria-label="Search repositories"
                className="h-[36px] w-full rounded-[10px] bg-surface-hover pl-9 pr-3 text-[14px] text-foreground placeholder:text-fg-faint border-none outline-none"
              />
            </div>
          </div>

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
                  <SettingsCard key={repo.id} padded={false} className="flex h-full flex-col">
                    <div className="px-[12px] py-[12px]">
                      <button
                        type="button"
                        onClick={() => setMapRepository(repo)}
                        aria-label={`Open codebase map for ${repo.fullName}`}
                        className="group relative block w-full cursor-pointer overflow-hidden rounded-[8px] text-left"
                      >
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
                      </button>
                    </div>

                    <div className="px-[12px]">
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
                        <div className="flex items-center gap-1">
                          <Button
                            design="ghost"
                            size="xs"
                            icon={Settings2}
                            onClick={() => setSettingsRepository(repo)}
                            aria-label={`Review settings for ${repo.fullName}`}
                            title="Review settings"
                          />
                          <TinyToggle
                            checked={enabled}
                            onCheckedChange={(checked) => handleToggle(repo, checked)}
                            aria-label={`${enabled ? 'Pause' : 'Resume'} reviews for ${repo.fullName}`}
                          />
                        </div>
                      </SettingsRow>
                    </div>
                  </SettingsCard>
                );
              })}
            </div>
          )}
        </>
      )}

      <RepositoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        installation={installation}
      />

      {settingsRepository && (
        <RepositoryReviewSettingsDialog
          repository={settingsRepository}
          onClose={() => setSettingsRepository(null)}
        />
      )}

      {mapRepository && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setMapRepository(null);
          }}
        >
          <DialogContent className="flex h-[min(700px,88vh)] flex-col sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle className="font-mono">{mapRepository.fullName}</DialogTitle>
              <DialogDescription>
                Every dot is a file and the lines show how files reference each other.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1">
              <RepositoryCodebaseMap
                repositoryId={mapRepository.id}
                repositoryName={mapRepository.fullName}
                className="h-full"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </ReviewPageShell>
  );
}
