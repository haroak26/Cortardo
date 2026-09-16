import { ChevronDown, Search } from 'lucide-react';
import { TextInput } from '@/components/text-input';
import { useRepositories } from '@/hooks/use-github';
import { useWorkspace } from '@/contexts/workspace-context';
import { cn } from '@/lib/utils';

/** Search input styled for the bot list pages. */
export function BotSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9"
      />
    </div>
  );
}

/** Repository scope picker: "All repositories" or a single connected repo. */
export function RepoScopeSelect({
  value,
  onChange,
  includeAll,
  className,
}: {
  /** Repository id, or '' for all repositories. */
  value: string;
  onChange: (repositoryId: string) => void;
  /** Show the "All repositories" option (false when a scope is required). */
  includeAll?: boolean;
  className?: string;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const { data: repositories = [] } = useRepositories(activeWorkspaceId);
  return (
    <div className={cn('relative shrink-0 max-w-[220px]', className)}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Repository scope"
        className="h-[36px] max-md:h-[40px] w-full appearance-none truncate rounded-[10px] border-none bg-surface-hover px-3 pr-8 text-[13px] text-foreground outline-none cursor-pointer"
      >
        {includeAll !== false && <option value="">All repositories</option>}
        {repositories.map((repository) => (
          <option key={repository.id} value={repository.id}>
            {repository.fullName}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-faint" />
    </div>
  );
}

/** Small labelled stat used at the top of the bot list pages. */
export function BotStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'success' | 'muted' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-faint">{label}</span>
      <span
        className={cn(
          'text-[18px] font-semibold leading-none tabular-nums',
          tone === 'success' ? 'text-success' : tone === 'muted' ? 'text-fg-muted' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}
