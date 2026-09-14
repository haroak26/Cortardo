import { useState } from 'react';
import { GitCommit } from 'lucide-react';
import { ReviewPageShell } from '@/components/review/bits';
import {
  SettingsSection,
  SettingsSwitchRow,
  SettingsTextRow,
} from '@/components/settings-ui';
import { Button } from '@/components/button';
import { ListSkeleton } from '@/components/ds';
import { useWorkspace } from '@/contexts/workspace-context';
import { COMMIT_REVIEW_DEFAULTS, useBotSettings, useUpdateBotSettings } from '@/hooks/use-bot-memory';

type CommitToggleKey =
  | 'reviewDirect'
  | 'scanDiffs'
  | 'checkMessages'
  | 'suggestFixes'
  | 'autoApplySafeFixes'
  | 'ignoreMergeCommits'
  | 'ignoreReleaseCommits';

export default function BotCommitsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { data, isLoading } = useBotSettings(activeWorkspaceId);
  const update = useUpdateBotSettings(activeWorkspaceId);
  const [maxCommitsDraft, setMaxCommitsDraft] = useState<string | null>(null);

  if (isLoading) {
    return (
      <ReviewPageShell maxWidth="max-w-3xl">
        <ListSkeleton rows={4} />
      </ReviewPageShell>
    );
  }

  const commit = data?.commitReviews ?? COMMIT_REVIEW_DEFAULTS;

  if (!commit.enabled) {
    return (
      <ReviewPageShell maxWidth="max-w-3xl">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-surface-hover text-fg-muted">
            <GitCommit size={20} strokeWidth={1.75} />
          </div>
          <p className="mt-4 text-[14px] font-medium text-foreground">Commit reviews are off</p>
          <p className="mt-1 max-w-[340px] text-[12.5px] leading-[1.6] text-fg-warm">
            Let Cortardo review commits pushed to your repositories and flag risky changes before they reach main.
          </p>
          <Button
            size="sm"
            className="mt-5"
            isLoading={update.isPending}
            onClick={() => update.mutate({ enabled: true })}
          >
            Enable commit reviews
          </Button>
        </div>
      </ReviewPageShell>
    );
  }

  const maxCommitsValue = maxCommitsDraft ?? String(commit.maxCommitsPerRun);

  const persistMaxCommits = () => {
    if (maxCommitsDraft === null) return;
    const parsed = Number.parseInt(maxCommitsDraft, 10);
    setMaxCommitsDraft(null);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 500 && parsed !== commit.maxCommitsPerRun) {
      update.mutate({ maxCommitsPerRun: parsed });
    }
  };

  const set = (key: CommitToggleKey) => (checked: boolean) =>
    update.mutate({ [key]: checked } as Partial<typeof commit>);

  return (
    <ReviewPageShell maxWidth="max-w-3xl">
      <div className="space-y-8 pb-8">
        <SettingsSection title="Reviews">
          <SettingsSwitchRow
            label="Review direct commits"
            description="Check commits pushed straight to the default branch."
            checked={commit.reviewDirect}
            onCheckedChange={set('reviewDirect')}
          />
          <SettingsSwitchRow
            label="Scan commit diffs"
            description="Look for risky patterns in changed code."
            checked={commit.scanDiffs}
            onCheckedChange={set('scanDiffs')}
          />
          <SettingsSwitchRow
            label="Check commit messages"
            description="Flag empty or vague commit messages."
            checked={commit.checkMessages}
            onCheckedChange={set('checkMessages')}
          />
        </SettingsSection>

        <SettingsSection title="Fixes">
          <SettingsSwitchRow
            label="Suggest fixes"
            description="Propose patches for findings in commits."
            checked={commit.suggestFixes}
            onCheckedChange={set('suggestFixes')}
          />
          <SettingsSwitchRow
            label="Auto-apply safe fixes"
            description="Commit trivial fixes without asking."
            checked={commit.autoApplySafeFixes}
            onCheckedChange={set('autoApplySafeFixes')}
          />
        </SettingsSection>

        <SettingsSection title="Scope">
          <SettingsSwitchRow
            label="Ignore merge commits"
            description="Skip commits created by merges."
            checked={commit.ignoreMergeCommits}
            onCheckedChange={set('ignoreMergeCommits')}
          />
          <SettingsSwitchRow
            label="Ignore release commits"
            description="Skip version bumps and release tags."
            checked={commit.ignoreReleaseCommits}
            onCheckedChange={set('ignoreReleaseCommits')}
          />
          <SettingsTextRow
            label="Max commits per run"
            description="Cap how many commits one run reviews."
            value={maxCommitsValue}
            onChange={(e) => setMaxCommitsDraft(e.target.value)}
            onBlur={persistMaxCommits}
          />
        </SettingsSection>
      </div>
    </ReviewPageShell>
  );
}
