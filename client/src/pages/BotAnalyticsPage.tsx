import { EyeOff, Gauge, GraduationCap, ListChecks } from 'lucide-react';
import { MetricCard } from '@/components/ds';
import { ReviewPageShell } from '@/components/review/bits';
import { AutonomyMeter, BOT_AUTONOMY_LABELS } from '@/components/bot/bot-ui';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useBotExclusions,
  useBotLearnings,
  useBotRules,
  useBotSettings,
} from '@/hooks/use-bot-memory';

function BarRows({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <span className="w-[104px] shrink-0 text-[12.5px] text-fg-muted">{row.label}</span>
          <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full rounded-full bg-brand/70"
              style={{ width: `${Math.round((row.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-[28px] shrink-0 text-right text-[12px] tabular-nums text-foreground">
            {row.count}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function BotAnalyticsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { data: rules = [] } = useBotRules(activeWorkspaceId);
  const { data: learnings = [] } = useBotLearnings(activeWorkspaceId);
  const { data: exclusions = [] } = useBotExclusions(activeWorkspaceId);
  const { data: settings } = useBotSettings(activeWorkspaceId);

  const activeRules = rules.filter((rule) => rule.enabled).length;
  const activeLearnings = learnings.filter((entry) => entry.active).length;
  const activeExclusions = exclusions.filter((exclusion) => exclusion.enabled).length;
  const autonomy = settings?.settings.autonomy ?? 'manual';

  const active = activeRules + activeLearnings + activeExclusions;
  const paused = rules.length + learnings.length + exclusions.length - active;
  const workspaceScoped =
    rules.filter((rule) => !rule.repositoryId).length +
    learnings.filter((entry) => !entry.repositoryId).length +
    exclusions.filter((exclusion) => !exclusion.repositoryId).length;
  const repositoryScoped = rules.length + learnings.length + exclusions.length - workspaceScoped;

  return (
    <ReviewPageShell
      title="Analytics"
      description="How your bot's memory and review setup are spread across this workspace."
    >
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active rules"
          value={activeRules}
          hint={`${rules.length} total`}
          icon={ListChecks}
          tone="brand"
        />
        <MetricCard
          label="Active learnings"
          value={activeLearnings}
          hint={`${learnings.length} total`}
          icon={GraduationCap}
          tone="info"
        />
        <MetricCard
          label="Active exclusions"
          value={activeExclusions}
          hint={`${exclusions.length} total`}
          icon={EyeOff}
          tone="warning"
        />
        <MetricCard
          label="Autonomy"
          value={<AutonomyMeter value={autonomy} />}
          hint={`${BOT_AUTONOMY_LABELS[autonomy]} · Adjust in Advanced`}
          icon={Gauge}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MetricCard label="Memory by status" hint="Rules, learnings and exclusions" textPosition="top" dotMatrix={false}>
          <BarRows
            rows={[
              { label: 'Active', count: active },
              { label: 'Paused', count: paused },
            ]}
          />
        </MetricCard>
        <MetricCard label="Memory by scope" hint="Where each item applies" textPosition="top" dotMatrix={false}>
          <BarRows
            rows={[
              { label: 'Workspace-wide', count: workspaceScoped },
              { label: 'Per-repository', count: repositoryScoped },
            ]}
          />
        </MetricCard>
      </div>
    </ReviewPageShell>
  );
}
