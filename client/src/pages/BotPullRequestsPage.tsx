import { useState } from 'react';
import { ReviewPageShell } from '@/components/review/bits';
import {
  SettingsSection,
  SettingsSwitchRow,
  SettingsTextRow,
} from '@/components/settings-ui';

const DEFAULTS = {
  autoReview: true,
  reviewDrafts: false,
  reReviewOnPush: true,
  inlineComments: true,
  summaryComment: true,
  requestChangesOnCritical: false,
  ignoreGenerated: true,
  skipBotsAndForks: true,
};

export default function BotPullRequestsPage() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [commentLimit, setCommentLimit] = useState('20');

  const set = (key: keyof typeof DEFAULTS) => (checked: boolean) =>
    setSettings((prev) => ({ ...prev, [key]: checked }));

  return (
    <ReviewPageShell maxWidth="max-w-3xl">
      <div className="space-y-8 pb-8">
        <SettingsSection title="Reviews">
          <SettingsSwitchRow
            label="Auto-review new pull requests"
            description="Start a review as soon as a PR opens."
            checked={settings.autoReview}
            onCheckedChange={set('autoReview')}
          />
          <SettingsSwitchRow
            label="Review draft pull requests"
            description="Include PRs still marked as drafts."
            checked={settings.reviewDrafts}
            onCheckedChange={set('reviewDrafts')}
          />
          <SettingsSwitchRow
            label="Re-review on new commits"
            description="Refresh the review when the PR is updated."
            checked={settings.reReviewOnPush}
            onCheckedChange={set('reReviewOnPush')}
          />
        </SettingsSection>

        <SettingsSection title="Comments">
          <SettingsSwitchRow
            label="Inline comments"
            description="Comment on the exact lines that need attention."
            checked={settings.inlineComments}
            onCheckedChange={set('inlineComments')}
          />
          <SettingsSwitchRow
            label="Summary comment"
            description="Post an overview of the review on the PR."
            checked={settings.summaryComment}
            onCheckedChange={set('summaryComment')}
          />
          <SettingsSwitchRow
            label="Request changes on critical findings"
            description="Block merging while critical findings are open."
            checked={settings.requestChangesOnCritical}
            onCheckedChange={set('requestChangesOnCritical')}
          />
          <SettingsTextRow
            label="Comment limit"
            description="Maximum finding comments posted per review."
            value={commentLimit}
            onChange={(e) => setCommentLimit(e.target.value)}
          />
        </SettingsSection>

        <SettingsSection title="Filters">
          <SettingsSwitchRow
            label="Ignore generated files"
            description="Skip lockfiles, snapshots and build output."
            checked={settings.ignoreGenerated}
            onCheckedChange={set('ignoreGenerated')}
          />
          <SettingsSwitchRow
            label="Skip bots and forks"
            description="Don't review PRs opened by bots or forks."
            checked={settings.skipBotsAndForks}
            onCheckedChange={set('skipBotsAndForks')}
          />
        </SettingsSection>
      </div>
    </ReviewPageShell>
  );
}
