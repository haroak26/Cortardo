import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FolderGit2,
  GitBranch,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, ListSkeleton } from "@/components/ds";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/base/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useInstallationRepositories,
  useUpdateRepositorySelection,
  type GithubInstallationSummary,
  type InstallationRepository,
} from "@/hooks/use-github";

export function codegraphBadge(repository: {
  indexing: boolean;
  codegraphStatus: string | null;
}): { label: string; tone: "neutral" | "success" | "warning" | "danger" | "brand" } {
  if (repository.indexing || repository.codegraphStatus === "indexing" || repository.codegraphStatus === "pending") {
    return { label: "Indexing…", tone: "warning" };
  }
  if (repository.codegraphStatus === "ready") return { label: "Map ready", tone: "success" };
  if (repository.codegraphStatus === "empty") return { label: "No code yet", tone: "neutral" };
  if (repository.codegraphStatus === "error") return { label: "Index failed", tone: "danger" };
  return { label: "Not indexed", tone: "neutral" };
}

export interface RepositoryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installation: GithubInstallationSummary | null;
  onSaved?: () => void;
}

/** Dialog for choosing which installation repositories Cortardo tracks. */
export function RepositoryPicker({ open, onOpenChange, installation, onSaved }: RepositoryPickerProps) {
  const { toast } = useToast();
  const catalogQuery = useInstallationRepositories(open ? installation?.id ?? null : null);
  const updateSelection = useUpdateRepositorySelection();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const repositories = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);

  useEffect(() => {
    if (!open || !catalogQuery.data) return;
    setSelected(new Set(catalogQuery.data.filter((repo) => repo.imported).map((repo) => repo.externalId)));
    setQuery("");
  }, [open, catalogQuery.data]);

  const filtered = useMemo(
    () => repositories.filter((repo) => repo.fullName.toLowerCase().includes(query.toLowerCase())),
    [repositories, query],
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every((repo) => selected.has(repo.externalId));

  const toggle = (externalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const repo of filtered) next.delete(repo.externalId);
      } else {
        for (const repo of filtered) next.add(repo.externalId);
      }
      return next;
    });
  };

  const handleSave = () => {
    if (!installation) return;
    updateSelection.mutate(
      { installationId: installation.id, externalIds: [...selected] },
      {
        onSuccess: ({ imported, removed }) => {
          toast({
            title: "Repositories updated",
            description:
              imported > 0
                ? `${imported} added, ${removed} removed. Building codebase maps now.`
                : `${removed} removed.`,
            variant: "success",
          });
          onOpenChange(false);
          onSaved?.();
        },
        onError: (error) =>
          toast({
            title: "Could not update repositories",
            description: (error as Error).message,
            variant: "destructive",
          }),
      },
    );
  };

  const pendingCount = [...selected].filter(
    (externalId) => !repositories.find((repo) => repo.externalId === externalId)?.imported,
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(680px,88vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="gap-0 border-b border-border-subtle px-5 py-4">
          <DialogTitle className="text-[16px]">Choose repositories</DialogTitle>
          <DialogDescription className="mt-1.5 text-[12.5px]">
            Cortardo reviews pull requests and builds a codebase map for every repository you select.
          </DialogDescription>
          {installation && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover px-2.5 py-1 text-[12px] font-medium text-foreground">
                <FolderGit2 size={12} className="text-fg-muted" />
                @{installation.accountLogin ?? "installation"}
              </span>
              <span className="text-[11.5px] text-fg-muted">
                {catalogQuery.isLoading ? "Loading repositories…" : `${repositories.length} available`}
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="flex items-center gap-2 px-5 py-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search repositories…"
              aria-label="Search repositories"
              className="h-[36px] w-full rounded-[10px] bg-surface-hover pl-9 pr-3 text-[13.5px] text-foreground placeholder:text-fg-faint border-none outline-none"
            />
          </div>
          <Button design="ghost" size="xs" onClick={toggleAll} disabled={filtered.length === 0}>
            {allFilteredSelected ? "Clear all" : "Select all"}
          </Button>
        </div>

        <div className="min-h-[220px] flex-1 overflow-y-auto px-3 pb-2">
          {catalogQuery.isLoading ? (
            <div className="px-2 pt-1">
              <ListSkeleton rows={5} />
            </div>
          ) : catalogQuery.isError ? (
            <div className="flex h-[220px] flex-col items-center justify-center px-6 text-center">
              <AlertCircle size={22} className="mb-2 text-danger" />
              <p className="text-[13px] font-medium text-foreground">Could not load repositories</p>
              <p className="mt-1 max-w-xs text-[11.5px] text-fg-muted">
                {(catalogQuery.error as Error)?.message || "Please try again."}
              </p>
              <Button
                design="outline"
                size="xs"
                className="mt-3"
                onClick={() => catalogQuery.refetch()}
              >
                <RefreshCw size={12} />
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-[220px] flex-col items-center justify-center px-6 text-center">
              <FolderGit2 size={26} className="mb-2 text-fg-faint" strokeWidth={1.5} />
              <p className="text-[13px] font-medium text-foreground">
                {repositories.length === 0 ? "No repositories available" : "No matches"}
              </p>
              <p className="mt-1 max-w-xs text-[11.5px] text-fg-muted">
                {repositories.length === 0
                  ? "This installation does not have access to any repositories yet."
                  : "Try a different search term."}
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((repo) => (
                <PickerRow
                  key={repo.externalId}
                  repository={repo}
                  checked={selected.has(repo.externalId)}
                  onToggle={() => toggle(repo.externalId)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-hover/30 px-5 py-3">
          <p className="text-[12px] text-fg-muted">
            {selected.size} of {repositories.length} selected
            {pendingCount > 0 && (
              <span className="text-fg-faint"> · {pendingCount} new map{pendingCount === 1 ? "" : "s"} will build</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button design="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} isLoading={updateSelection.isPending} disabled={!installation}>
              <CheckCircle2 size={14} />
              Save selection
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PickerRow({
  repository,
  checked,
  onToggle,
}: {
  repository: InstallationRepository;
  checked: boolean;
  onToggle: () => void;
}) {
  const badge = codegraphBadge(repository);
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-3 rounded-[12px] border px-3 py-3 text-left transition-colors",
          checked
            ? "border-brand/45 bg-brand/5 hover:bg-brand/10"
            : "border-transparent bg-transparent hover:bg-surface-hover",
        )}
      >
        <span
          className={cn(
            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors",
            checked ? "border-brand bg-brand text-brand-foreground" : "border-border bg-transparent",
          )}
          aria-hidden
        >
          {checked && <Check size={12} strokeWidth={3} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-mono text-[13px] font-medium text-foreground">{repository.fullName}</span>
            {repository.isPrivate && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-faint">
                <Lock size={10} />
                Private
              </span>
            )}
            {repository.imported && <Badge tone="brand">Tracking</Badge>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <GitBranch size={11} />
              <span className="font-mono">{repository.defaultBranch}</span>
            </span>
            {repository.imported && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>·</span>
                <StatusChip status={badge.label} tone={badge.tone} />
                {repository.codegraphStatus === "ready" && repository.codegraphFileCount > 0 && (
                  <span>{repository.codegraphFileCount} files</span>
                )}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function StatusChip({ status, tone }: { status: string; tone: "neutral" | "success" | "warning" | "danger" | "brand" }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? AlertCircle : tone === "warning" ? Loader2 : Sparkles;
  const color =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "warning"
          ? "text-warning"
          : "text-fg-faint";
  return (
    <span className={cn("inline-flex items-center gap-1", color)}>
      <Icon size={11} className={tone === "warning" ? "animate-spin" : undefined} />
      {status}
    </span>
  );
}
