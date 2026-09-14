import { useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildGraphLayout } from '@/lib/codegraph-layout';
import { timeAgo } from '@/lib/mock-review-data';
import { Button } from '@/components/button';
import { useGenerateRepositoryCodegraph, useRepositoryCodegraph } from '@/hooks/use-github';
import { CodebaseMap } from './CodebaseMap';

export interface RepositoryCodebaseMapProps {
  repositoryId: string | null;
  repositoryName: string;
  className?: string;
}

/** Codebase map rendered from the repository's generated codegraph. */
export function RepositoryCodebaseMap({ repositoryId, repositoryName, className }: RepositoryCodebaseMapProps) {
  const graphQuery = useRepositoryCodegraph(repositoryId);
  const generate = useGenerateRepositoryCodegraph();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = graphQuery.data;
  const layout = useMemo(
    () => (data && data.files.length > 0 ? buildGraphLayout(data.files, data.connections) : null),
    [data],
  );
  const rootId = useMemo(
    () => layout?.nodes.find((file) => file.entry)?.id ?? layout?.nodes[0]?.id ?? '',
    [layout],
  );
  const selected = selectedId && layout ? layout.byId.get(selectedId) : undefined;

  const status = data?.status ?? (graphQuery.isLoading ? 'loading' : 'missing');
  const busy = status === 'indexing' || status === 'pending' || generate.isPending;

  return (
    <div
      className={cn(
        'relative flex h-full min-h-[320px] flex-col overflow-hidden rounded-[12px] border border-border-subtle bg-background',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[12.5px] font-medium text-foreground">{repositoryName}</p>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            {status === 'ready' && data
              ? `${data.fileCount} files · ${data.connections.length} connections${
                  data.generatedAt ? ` · updated ${timeAgo(data.generatedAt)}` : ''
                }`
              : 'Codebase map'}
          </p>
        </div>
        <Button
          design="outline"
          size="xs"
          onClick={() => repositoryId && generate.mutate(repositoryId)}
          isLoading={busy}
        >
          <RefreshCw size={12} />
          {status === 'ready' ? 'Rebuild' : 'Build map'}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        {graphQuery.isLoading ? (
          <MapMessage icon={<RefreshCw size={16} className="animate-spin" />} title="Loading codebase map…" />
        ) : graphQuery.isError ? (
          <MapMessage
            icon={<AlertCircle size={16} className="text-danger" />}
            title={(graphQuery.error as Error)?.message || 'Failed to load codebase map'}
          />
        ) : busy ? (
          <MapMessage
            icon={<RefreshCw size={16} className="animate-spin text-warning" />}
            title="Building codebase map…"
            description="Cloning the repository and analyzing imports."
          />
        ) : status === 'error' ? (
          <MapMessage
            icon={<AlertCircle size={16} className="text-danger" />}
            title="Codebase map failed"
            description={data?.error ?? 'The repository could not be indexed.'}
          />
        ) : status === 'empty' ? (
          <MapMessage
            icon={<Sparkles size={16} className="text-fg-muted" />}
            title="No code to map yet"
            description="This repository has no commits on its default branch. Push code and rebuild the map."
          />
        ) : !layout ? (
          <MapMessage
            icon={<Sparkles size={16} className="text-fg-muted" />}
            title="No codebase map yet"
            description="Build a map to see how the files in this repository connect."
          />
        ) : (
          <>
            <CodebaseMap
              layout={layout}
              statuses={{}}
              rootId={rootId}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            {selected && (
              <div className="pointer-events-none absolute bottom-2 left-2 z-20 max-w-[calc(100%-3.5rem)] rounded-[8px] border border-border-subtle bg-background/90 px-2.5 py-1.5 backdrop-blur">
                <p className="truncate font-mono text-[11px] font-medium text-foreground">{selected.path}</p>
                <p className="mt-0.5 text-[10.5px] text-fg-muted">
                  {selected.language} · {selected.kind} · {selected.loc} lines
                  {selected.hub ? ' · hub' : ''}
                  {selected.entry ? ' · entry' : ''}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export interface RepositoryCodebaseMapPreviewProps {
  repositoryId: string | null;
  className?: string;
}

/** Still, non-interactive render of a repository's codebase map for cards. */
export function RepositoryCodebaseMapPreview({ repositoryId, className }: RepositoryCodebaseMapPreviewProps) {
  const graphQuery = useRepositoryCodegraph(repositoryId);

  const data = graphQuery.data;
  const layout = useMemo(
    () => (data && data.files.length > 0 ? buildGraphLayout(data.files, data.connections) : null),
    [data],
  );
  const rootId = useMemo(
    () => layout?.nodes.find((file) => file.entry)?.id ?? layout?.nodes[0]?.id ?? '',
    [layout],
  );

  const status = data?.status ?? (graphQuery.isLoading ? 'loading' : 'missing');
  const busy = Boolean(data?.indexing) || status === 'indexing' || status === 'pending';

  if (layout && status === 'ready' && !busy) {
    return (
      <CodebaseMap
        layout={layout}
        statuses={{}}
        rootId={rootId}
        selectedId={null}
        onSelect={() => {}}
        autoRotate={false}
        interactive={false}
        className={className}
      />
    );
  }

  const message = graphQuery.isLoading
    ? 'Loading codebase map…'
    : busy
      ? 'Building codebase map…'
      : status === 'error'
        ? 'Codebase map failed'
        : status === 'empty'
          ? 'No code to map yet'
          : 'No codebase map yet';

  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 px-4 text-center', className)}>
      {graphQuery.isLoading || busy ? (
        <RefreshCw size={14} className="animate-spin text-fg-muted" />
      ) : status === 'error' ? (
        <AlertCircle size={14} className="text-danger" />
      ) : (
        <Sparkles size={14} className="text-fg-muted" />
      )}
      <p className="text-[12px] font-medium text-fg-muted">{message}</p>
    </div>
  );
}

function MapMessage({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-hover">{icon}</div>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-xs text-[11.5px] text-fg-muted">{description}</p>}
    </div>
  );
}
