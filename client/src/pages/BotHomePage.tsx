import { useLocation } from 'wouter';
import { EyeOff, Gauge, GraduationCap, ListChecks } from 'lucide-react';
import { MetricCard } from '@/components/ds';
import { ReviewPageShell } from '@/components/review/bits';
import { ActiveReviewsCard, FixQueueCard } from '@/components/review/queue-cards';
import { AutonomyMeter, BOT_AUTONOMY_LABELS } from '@/components/bot/bot-ui';
import { useWorkspace } from '@/contexts/workspace-context';
import { recentReviews } from '@/lib/mock-review-data';
import {
  useBotExclusions,
  useBotLearnings,
  useBotRules,
  useBotSettings,
} from '@/hooks/use-bot-memory';

export default function BotHomePage() {
  const { activeWorkspaceId } = useWorkspace();
  const [, setLocation] = useLocation();
  const { data: rules = [] } = useBotRules(activeWorkspaceId);
  const { data: learnings = [] } = useBotLearnings(activeWorkspaceId);
  const { data: exclusions = [] } = useBotExclusions(activeWorkspaceId);
  const { data: settings } = useBotSettings(activeWorkspaceId);

  const activeRules = rules.filter((rule) => rule.enabled).length;
  const activeLearnings = learnings.filter((entry) => entry.active).length;
  const activeExclusions = exclusions.filter((exclusion) => exclusion.enabled).length;
  const autonomy = settings?.settings.autonomy ?? 'manual';

  const activeReviews = recentReviews.filter((r) => !['done', 'error', 'cancelled'].includes(r.status));
  const fixQueue = recentReviews
    .filter((r) => r.status === 'done' && r.severity.critical + r.severity.high > 0)
    .sort((a, b) => b.severity.critical - a.severity.critical || b.severity.high - a.severity.high);
  const openReviews = () => setLocation('/review/activity');

  return (
    <ReviewPageShell
      title="Home"
      description="An overview of your bot's memory, rules and review setup."
    >
      <div className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Rules"
          value={rules.length}
          hint={`${activeRules} active`}
          icon={ListChecks}
          tone="brand"
        />
        <MetricCard
          label="Learnings"
          value={learnings.length}
          hint={`${activeLearnings} active`}
          icon={GraduationCap}
          tone="info"
        />
        <MetricCard
          label="Exclusions"
          value={exclusions.length}
          hint={`${activeExclusions} active`}
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <FixQueueCard reviews={fixQueue} onOpen={openReviews} />
        <ActiveReviewsCard reviews={activeReviews} onOpen={openReviews} />
      </div>
    </ReviewPageShell>
  );
}
