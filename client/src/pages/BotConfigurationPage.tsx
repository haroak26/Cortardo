import { ReviewPageShell } from '@/components/review/bits';
import {
  SettingsSection,
  SettingsSwitchRow,
} from '@/components/settings-ui';
import { ListSkeleton } from '@/components/ds';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  PULL_REQUEST_REVIEW_DEFAULTS,
  COMMIT_REVIEW_DEFAULTS,
  useBotSettings,
  useUpdateBotSettings,
  type PullRequestReviewSettings,
} from '@/hooks/use-bot-memory';

type PullRequestToggleKey = Exclude<keyof PullRequestReviewSettings, 'commentLimit'>;

type CommitToggleKey =
  | 'enabled'
  | 'reviewDirect'
  | 'checkMessages'
  | 'suggestFixes'
  | 'ignoreMergeCommits'
  | 'ignoreReleaseCommits';

export default function BotConfigurationPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { data, isLoading, error } = useBotSettings(activeWorkspaceId);
  const update = useUpdateBotSettings(activeWorkspaceId);

  if (isLoading) {
    return (
      <ReviewPageShell maxWidth="max-w-3xl">
        <ListSkeleton rows={6} />
      </ReviewPageShell>
    );
  }

  const pullRequests = data?.settings.pullRequests ?? PULL_REQUEST_REVIEW_DEFAULTS;
  const commit = data?.commitReviews ?? COMMIT_REVIEW_DEFAULTS;

  const setPullRequest = (key: PullRequestToggleKey) => (checked: boolean) =>
    update.mutate({ settings: { pullRequests: { [key]: checked } } });

  const setCommit = (key: CommitToggleKey) => (checked: boolean) =>
    update.mutate({ commitReviews: { [key]: checked } });

  return (
    <ReviewPageShell
      title="Configuration"
      description="How the bot reviews pull requests and commits across this workspace."
      maxWidth="max-w-3xl"
    >
      {(error || update.error) && (
        <p className="mb-4 text-[13px] text-destructive">
          {((error ?? update.error) as Error).message}
        </p>
      )}

      <div className="space-y-8 pb-8">
        <SettingsSection title="Pull requests">
          <SettingsSwitchRow
            label="Auto-review new pull requests"
            description="Start a review as soon as a PR opens."
            checked={pullRequests.autoReview}
            onCheckedChange={setPullRequest('autoReview')}
          />
          <SettingsSwitchRow
            label="Review draft pull requests"
            description="Include PRs still marked as drafts."
            checked={pullRequests.reviewDrafts}
            onCheckedChange={setPullRequest('reviewDrafts')}
          />
          <SettingsSwitchRow
            label="Re-review on new commits"
            description="Refresh the review when the PR is updated."
            checked={pullRequests.reReviewOnPush}
            onCheckedChange={setPullRequest('reReviewOnPush')}
          />
        </SettingsSection>

        <SettingsSection title="Commit reviews">
          <SettingsSwitchRow
            label="Enable commit reviews"
            description="Review commits pushed to your repositories, not just pull requests."
            checked={commit.enabled}
            onCheckedChange={setCommit('enabled')}
          />
          <SettingsSwitchRow
            label="Review direct commits"
            description="Check commits pushed straight to the default branch."
            checked={commit.reviewDirect}
            onCheckedChange={setCommit('reviewDirect')}
            disabled={!commit.enabled}
          />
          <SettingsSwitchRow
            label="Check commit messages"
            description="Flag empty or vague commit messages."
            checked={commit.checkMessages}
            onCheckedChange={setCommit('checkMessages')}
            disabled={!commit.enabled}
          />
          <SettingsSwitchRow
            label="Suggest fixes"
            description="Propose patches for findings in commits."
            checked={commit.suggestFixes}
            onCheckedChange={setCommit('suggestFixes')}
            disabled={!commit.enabled}
          />
          <SettingsSwitchRow
            label="Ignore merge commits"
            description="Skip commits created by merges."
            checked={commit.ignoreMergeCommits}
            onCheckedChange={setCommit('ignoreMergeCommits')}
            disabled={!commit.enabled}
          />
          <SettingsSwitchRow
            label="Ignore release commits"
            description="Skip version bumps and release tags."
            checked={commit.ignoreReleaseCommits}
            onCheckedChange={setCommit('ignoreReleaseCommits')}
            disabled={!commit.enabled}
          />
        </SettingsSection>
      </div>
    </ReviewPageShell>
  );
}
