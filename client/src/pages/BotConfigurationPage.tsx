import { useEffect, useState } from 'react';
import { ReviewPageShell } from '@/components/review/bits';
import {
  SettingsButtonRow,
  SettingsLargeTextRow,
  SettingsSection,
  SettingsSwitchRow,
  SettingsTextRow,
} from '@/components/settings-ui';
import { Button } from '@/components/button';
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
  | 'scanDiffs'
  | 'checkMessages'
  | 'suggestFixes'
  | 'autoApplySafeFixes'
  | 'ignoreMergeCommits'
  | 'ignoreReleaseCommits';

export default function BotConfigurationPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { data, isLoading, error } = useBotSettings(activeWorkspaceId);
  const update = useUpdateBotSettings(activeWorkspaceId);

  const [commentLimitDraft, setCommentLimitDraft] = useState<string | null>(null);
  const [maxCommitsDraft, setMaxCommitsDraft] = useState<string | null>(null);
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(null);

  useEffect(() => {
    setInstructionsDraft(null);
  }, [data?.settings.instructions]);

  if (isLoading) {
    return (
      <ReviewPageShell maxWidth="max-w-3xl">
        <ListSkeleton rows={6} />
      </ReviewPageShell>
    );
  }

  const pullRequests = data?.settings.pullRequests ?? PULL_REQUEST_REVIEW_DEFAULTS;
  const commit = data?.commitReviews ?? COMMIT_REVIEW_DEFAULTS;
  const instructions = data?.settings.instructions ?? '';
  const instructionsValue = instructionsDraft ?? instructions;

  const setPullRequest = (key: PullRequestToggleKey) => (checked: boolean) =>
    update.mutate({ settings: { pullRequests: { [key]: checked } } });

  const setCommit = (key: CommitToggleKey) => (checked: boolean) =>
    update.mutate({ commitReviews: { [key]: checked } });

  const commentLimitValue = commentLimitDraft ?? String(pullRequests.commentLimit);
  const persistCommentLimit = () => {
    if (commentLimitDraft === null) return;
    const parsed = Number.parseInt(commentLimitDraft, 10);
    setCommentLimitDraft(null);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200 && parsed !== pullRequests.commentLimit) {
      update.mutate({ settings: { pullRequests: { commentLimit: parsed } } });
    }
  };

  const maxCommitsValue = maxCommitsDraft ?? String(commit.maxCommitsPerRun);
  const persistMaxCommits = () => {
    if (maxCommitsDraft === null) return;
    const parsed = Number.parseInt(maxCommitsDraft, 10);
    setMaxCommitsDraft(null);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 500 && parsed !== commit.maxCommitsPerRun) {
      update.mutate({ commitReviews: { maxCommitsPerRun: parsed } });
    }
  };

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

        <SettingsSection title="Comments">
          <SettingsSwitchRow
            label="Inline comments"
            description="Comment on the exact lines that need attention."
            checked={pullRequests.inlineComments}
            onCheckedChange={setPullRequest('inlineComments')}
          />
          <SettingsSwitchRow
            label="Summary comment"
            description="Post an overview of the review on the PR."
            checked={pullRequests.summaryComment}
            onCheckedChange={setPullRequest('summaryComment')}
          />
          <SettingsSwitchRow
            label="Request changes on critical findings"
            description="Block merging while critical findings are open."
            checked={pullRequests.requestChangesOnCritical}
            onCheckedChange={setPullRequest('requestChangesOnCritical')}
          />
          <SettingsTextRow
            label="Comment limit"
            description="Maximum finding comments posted per review."
            value={commentLimitValue}
            onChange={(event) => setCommentLimitDraft(event.target.value)}
            onBlur={persistCommentLimit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
          />
        </SettingsSection>

        <SettingsSection title="Filters">
          <SettingsSwitchRow
            label="Ignore generated files"
            description="Skip lockfiles, snapshots, build output and minified bundles."
            checked={pullRequests.ignoreGenerated}
            onCheckedChange={setPullRequest('ignoreGenerated')}
          />
          <SettingsSwitchRow
            label="Skip bots and forks"
            description="Don't auto-review PRs opened by bots or from forks."
            checked={pullRequests.skipBotsAndForks}
            onCheckedChange={setPullRequest('skipBotsAndForks')}
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
            label="Scan commit diffs"
            description="Look for risky patterns in changed code."
            checked={commit.scanDiffs}
            onCheckedChange={setCommit('scanDiffs')}
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
            label="Auto-apply safe fixes"
            description="Commit trivial fixes without asking."
            checked={commit.autoApplySafeFixes}
            onCheckedChange={setCommit('autoApplySafeFixes')}
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
          <SettingsTextRow
            label="Max commits per run"
            description="Cap how many commits one run reviews."
            value={maxCommitsValue}
            onChange={(event) => setMaxCommitsDraft(event.target.value)}
            onBlur={persistMaxCommits}
            disabled={!commit.enabled}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
          />
        </SettingsSection>

        <SettingsSection title="Review instructions">
          <SettingsLargeTextRow
            label="Extra instructions"
            description="Injected into every review prompt across this workspace."
            value={instructionsValue}
            onChange={(event) => setInstructionsDraft(event.target.value)}
            placeholder="e.g. Prefer our internal logger over console.log. Treat missing error handling as high priority."
            rows={4}
          />
          {instructionsDraft !== null && instructionsDraft !== instructions && (
            <SettingsButtonRow label="Unsaved changes" description="These instructions apply to new reviews only.">
              <Button size="xs" design="ghost" onClick={() => setInstructionsDraft(null)}>
                Discard
              </Button>
              <Button
                size="xs"
                isLoading={update.isPending}
                onClick={() => update.mutate({ settings: { instructions: instructionsDraft } })}
              >
                Save
              </Button>
            </SettingsButtonRow>
          )}
        </SettingsSection>
      </div>
    </ReviewPageShell>
  );
}
