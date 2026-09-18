import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useParams } from 'wouter';
import { ArrowLeft, Boxes, FolderGit2 } from 'lucide-react';
import { ReviewPageShell } from '@/components/review/bits';
import { SettingsDisplayRow, SettingsRow, SettingsSection } from '@/components/settings-ui';
import { Button } from '@/components/button';
import { Badge, ListSkeleton, MetricCard } from '@/components/ds';
import { TinyToggle } from '@/components/ui/tiny-toggle';
import { RepositoryCodebaseMap } from '@/components/review/codegraph/RepositoryCodebaseMap';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/workspace-context';
import { useRepositories, useUpdateRepository } from '@/hooks/use-github';
import { mockCodebaseMap, timeAgo, type CodeFileStatus, type CodebaseFile } from '@/lib/mock-review-data';
import { cn } from '@/lib/utils';

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

export default function RepositoryDetailPage() {
  const params = useParams<{ id: string }>();
  const repositoryId = params.id ?? '';
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { activeWorkspaceId } = useWorkspace();

  const reposQuery = useRepositories(activeWorkspaceId);
  const updateRepository = useUpdateRepository();

  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);

  const repository = useMemo(
    () => (reposQuery.data ?? []).find((repo) => repo.id === repositoryId) ?? null,
    [reposQuery.data, repositoryId],
  );
  const handleToggle = (checked: boolean) => {
    if (!repository) return;
    setEnabledOverride(checked);
    updateRepository.mutate(
      { id: repository.id, reviewEnabled: checked },
      {
        onError: (error) => {
          setEnabledOverride(null);
          toast({
            title: 'Could not update repository',
            description: (error as Error).message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  let body: ReactNode;

  if (reposQuery.isLoading) {
    body = <ListSkeleton rows={5} />;
  } else if (!repository) {
    body = (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FolderGit2 size={36} className="mb-3 text-fg-faint" strokeWidth={1.5} />
        <p className="text-[15px] font-medium text-foreground">Repository not found</p>
        <p className="mt-1 max-w-sm text-[12.5px] text-fg-muted">
          It may have been removed, or you may not have access to it.
        </p>
        <Button size="sm" className="mt-5" onClick={() => setLocation('/review/repositories')}>
          <ArrowLeft size={15} />
          Back to repositories
        </Button>
      </div>
    );
  } else {
    const enabled = enabledOverride ?? repository.reviewEnabled;
    const suspended = repository.installation?.suspended === true;

    body = (
      <div className="space-y-8">
        <section>
          <h2 className="font-sans text-[15px] font-medium leading-tight text-foreground">Codebase map</h2>
          <div className="mt-[14px]">
            <RepositoryCodebaseMap
              repositoryId={repository.id}
              className="h-[360px] sm:h-[460px]"
            />
          </div>
        </section>

        <CodebaseCard />

        <SettingsSection title="Overview">
          <SettingsRow
            label="Automatic reviews"
            description="Review every pull request opened against this repository."
          >
            <TinyToggle
              checked={enabled}
              onCheckedChange={handleToggle}
              aria-label={`${enabled ? 'Pause' : 'Resume'} reviews for ${repository.fullName}`}
            />
          </SettingsRow>
          <SettingsDisplayRow
            label="Provider"
            value={PROVIDER_LABELS[repository.provider] ?? repository.provider}
          />
          <SettingsDisplayRow label="Default branch" value={repository.defaultBranch} mono />
          <SettingsDisplayRow label="Visibility" value={repository.isPrivate ? 'Private' : 'Public'} />
          {repository.installation && (
            <SettingsDisplayRow
              label="Installation"
              value={
                repository.installation.accountLogin
                  ? `@${repository.installation.accountLogin}`
                  : (repository.installation.accountType ?? 'GitHub App')
              }
            />
          )}
          <SettingsDisplayRow
            label="Last reviewed"
            value={repository.lastReviewedAt ? timeAgo(repository.lastReviewedAt) : 'Never'}
          />
          {suspended && (
            <SettingsRow
              label="Installation status"
              description="Reconnect the GitHub installation to resume reviews."
            >
              <Badge tone="warning">Suspended</Badge>
            </SettingsRow>
          )}
        </SettingsSection>
      </div>
    );
  }

  return (
    <ReviewPageShell
      title={repository?.fullName ?? 'Repository'}
      description={
        repository
          ? `${PROVIDER_LABELS[repository.provider] ?? repository.provider} repository · ${repository.defaultBranch}`
          : 'Repository details, codebase map and recent activity.'
      }
      back={{ href: '/review/repositories', label: 'Repositories' }}
    >
      {body}
    </ReviewPageShell>
  );
}

const CODE_STATUS_META: Record<CodeFileStatus, { label: string; color: string; swatch: string }> = {
  clean: { label: 'Clean', color: 'hsl(var(--surface-deep))', swatch: 'bg-surface-deep' },
  fixing: { label: 'Being fixed', color: 'hsl(var(--warning) / 0.75)', swatch: 'bg-[hsl(var(--warning)/0.75)]' },
  error: { label: 'Error', color: 'hsl(var(--danger) / 0.75)', swatch: 'bg-[hsl(var(--danger)/0.75)]' },
};

const CODE_BLOCK_PX = 14;
const CODE_BLOCK_GAP_PX = 5;
const CODEBASE_ROWS = 5;

function CodebaseCard() {
  const map = mockCodebaseMap;
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(0);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      setColumns(
        Math.max(1, Math.floor((width + CODE_BLOCK_GAP_PX) / (CODE_BLOCK_PX + CODE_BLOCK_GAP_PX))),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const files = map.files;
  const totals = map.totals;

  const visibleFiles = useMemo(() => {
    if (columns <= 0 || files.length === 0) return [];
    const target = Math.min(columns * CODEBASE_ROWS, files.length);
    const indexed = files.map((file, index) => ({ file, index }));
    const issues = indexed.filter((entry) => entry.file.status !== 'clean');
    const clean = indexed.filter((entry) => entry.file.status === 'clean');
    const chosen =
      issues.length >= target
        ? issues.slice(0, target)
        : [...issues, ...clean.slice(0, target - issues.length)];
    return chosen.sort((a, b) => a.index - b.index).map((entry) => entry.file);
  }, [columns, files]);

  const legendCount = (status: CodeFileStatus) =>
    status === 'clean' ? totals.clean : status === 'fixing' ? totals.fixing : totals.error;

  return (
    <MetricCard
      label="Codebase"
      hint="Each block is one indexed file, coloured by its current state."
      icon={Boxes}
      tone="neutral"
      textPosition="top"
      dotMatrix={false}
    >
      {(
        <>
          <div ref={gridRef} className="flex flex-wrap justify-start gap-[5px]">
            {visibleFiles.map((file: CodebaseFile) => {
              const meta = CODE_STATUS_META[file.status];
              return (
                <span
                  key={`${file.repository}:${file.path}`}
                  className="shrink-0 rounded-[3px]"
                  style={{ background: meta.color, width: CODE_BLOCK_PX, height: CODE_BLOCK_PX }}
                  title={`${file.repository} · ${file.path} — ${meta.label}`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-fg-muted">
              {(Object.keys(CODE_STATUS_META) as CodeFileStatus[]).map((status) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2.5 w-2.5 rounded-[2px]', CODE_STATUS_META[status].swatch)} />
                  {CODE_STATUS_META[status].label}{' '}
                  <span className="tabular-nums text-fg-faint">
                    {legendCount(status).toLocaleString()}
                  </span>
                </span>
              ))}
            </div>
            <span className="text-[11.5px] tabular-nums text-fg-faint">
              Showing {visibleFiles.length} of {totals.total.toLocaleString()} indexed files
            </span>
          </div>
        </>
      )}
    </MetricCard>
  );
}
