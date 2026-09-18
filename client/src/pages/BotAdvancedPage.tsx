import { ListSkeleton } from '@/components/ds';
import { ReviewPageShell } from '@/components/review/bits';
import { SettingsRow, SettingsSection, SettingsSwitchRow } from '@/components/settings-ui';
import { AutonomyWave } from '@/components/bot/bot-ui';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  PULL_REQUEST_REVIEW_DEFAULTS,
  useBotSettings,
  useUpdateBotSettings,
  type BotAutonomyLevel,
} from '@/hooks/use-bot-memory';

const AUTONOMY_DESCRIPTIONS: Record<BotAutonomyLevel, string> = {
  manual: 'Comments only — the bot never changes your code.',
  assisted: 'Applies safe fixes on its own and asks before anything else.',
  autonomous: 'Fixes findings and re-reviews without asking.',
};

export default function BotAdvancedPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { data, isLoading, error } = useBotSettings(activeWorkspaceId);
  const update = useUpdateBotSettings(activeWorkspaceId);

  if (isLoading) {
    return (
      <ReviewPageShell maxWidth="max-w-3xl">
        <ListSkeleton rows={4} />
      </ReviewPageShell>
    );
  }

  const pullRequests = data?.settings.pullRequests ?? PULL_REQUEST_REVIEW_DEFAULTS;
  const autonomy = data?.settings.autonomy ?? 'manual';

  return (
    <ReviewPageShell
      title="Advanced"
      description="Autonomy and file filters that shape every review."
      maxWidth="max-w-3xl"
    >
      {(error || update.error) && (
        <p className="mb-4 text-[13px] text-destructive">
          {((error ?? update.error) as Error).message}
        </p>
      )}

      <div className="space-y-8 pb-8">
        <SettingsSection title="Autonomy">
          <SettingsRow label="Autonomy" description={AUTONOMY_DESCRIPTIONS[autonomy]}>
            <AutonomyWave
              value={autonomy}
              onChange={(level) => update.mutate({ settings: { autonomy: level } })}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Filters">
          <SettingsSwitchRow
            label="Ignore generated files"
            description="Skip lockfiles, snapshots, build output and minified bundles."
            checked={pullRequests.ignoreGenerated}
            onCheckedChange={(checked) =>
              update.mutate({ settings: { pullRequests: { ignoreGenerated: checked } } })
            }
          />
          <SettingsSwitchRow
            label="Skip bots and forks"
            description="Don't auto-review PRs opened by bots or from forks."
            checked={pullRequests.skipBotsAndForks}
            onCheckedChange={(checked) =>
              update.mutate({ settings: { pullRequests: { skipBotsAndForks: checked } } })
            }
          />
        </SettingsSection>
      </div>
    </ReviewPageShell>
  );
}
