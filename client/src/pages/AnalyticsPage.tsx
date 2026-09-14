import { useMemo } from 'react';
import { GitPullRequest, ShieldAlert, Timer, Wrench } from 'lucide-react';
import { Panel, ReviewPageShell, SeverityBars } from '@/components/review/bits';
import { StatCard } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import { cn } from '@/lib/utils';
import {
  analyticsSummary,
  findingsByCategory,
  openSeverity,
  repoAnalytics,
  reviewActivity,
  reviewTrend,
  type ActivityDay,
} from '@/lib/mock-review-data';

const HEAT_LEVELS = ['bg-surface-hover', 'bg-brand/25', 'bg-brand/45', 'bg-brand/70', 'bg-brand'];

function heatLevel(count: number): string {
  if (count === 0) return HEAT_LEVELS[0];
  if (count <= 1) return HEAT_LEVELS[1];
  if (count <= 3) return HEAT_LEVELS[2];
  if (count <= 5) return HEAT_LEVELS[3];
  return HEAT_LEVELS[4];
}

function ActivityHeatmap() {
  const weeks = useMemo(() => {
    const first = new Date(`${reviewActivity[0]?.date ?? ''}T00:00:00`);
    const lead = Number.isNaN(first.getTime()) ? 0 : first.getDay();
    const cells: (ActivityDay | null)[] = [...Array<null>(lead).fill(null), ...reviewActivity];
    const out: (ActivityDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, []);

  const total = reviewActivity.reduce((sum, day) => sum + day.count, 0);

  return (
    <Panel
      title="Review activity"
      meta={
        <span className="text-[11.5px] tabular-nums text-fg-faint">
          {total.toLocaleString()} runs in the last 6 months
        </span>
      }
    >
      <div className="overflow-x-auto pb-1 scrollbar-none">
        <div className="flex gap-[3px]">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px]">
              {week.map((day, dayIndex) => (
                <span
                  key={day?.date ?? `${weekIndex}-${dayIndex}`}
                  className={cn(
                    'h-[11px] w-[11px] shrink-0 rounded-[2px]',
                    day ? heatLevel(day.count) : 'bg-transparent',
                  )}
                  title={day ? `${day.count} review${day.count === 1 ? '' : 's'} on ${day.date}` : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11.5px] text-fg-faint">
        Less
        {HEAT_LEVELS.map((level) => (
          <span key={level} className={cn('h-[11px] w-[11px] rounded-[2px]', level)} />
        ))}
        More
      </div>
    </Panel>
  );
}

function ReviewVolume() {
  const max = Math.max(...reviewTrend.map((point) => point.reviews), 1);
  return (
    <Panel
      title="Review volume"
      meta={<span className="text-[11.5px] text-fg-faint">Last 12 weeks</span>}
    >
      <div className="flex h-[150px] items-end gap-1.5">
        {reviewTrend.map((point) => (
          <div key={point.label} className="flex h-full flex-1 flex-col justify-end" title={`${point.label}: ${point.reviews} reviews · ${point.findings} findings`}>
            <div
              className="w-full rounded-[3px] bg-brand/80 transition-[height] duration-300"
              style={{ height: `${Math.round((point.reviews / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10.5px] text-fg-faint">
        <span>{reviewTrend[0]?.label}</span>
        <span>{reviewTrend[reviewTrend.length - 1]?.label}</span>
      </div>
    </Panel>
  );
}

function FindingsByCategory() {
  const max = Math.max(...findingsByCategory.map((row) => row.count), 1);
  return (
    <Panel
      title="Findings by category"
      meta={<span className="text-[11.5px] text-fg-faint">All time</span>}
    >
      <div className="space-y-2.5">
        {findingsByCategory.map((row) => (
          <div key={row.category} className="flex items-center gap-3">
            <span className="w-[104px] shrink-0 text-[12.5px] text-fg-muted">{row.category}</span>
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
    </Panel>
  );
}

function RepositoryHealth() {
  return (
    <FramedCard>
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
        <h2 className="text-[14px] font-semibold text-foreground">Repository health</h2>
        <span className="text-[11.5px] text-fg-faint">Open vs fixed findings</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-fg-faint">
              <th className="px-4 pb-2 font-medium sm:px-5">Repository</th>
              <th className="px-4 pb-2 text-right font-medium">Reviews</th>
              <th className="px-4 pb-2 text-right font-medium">Open</th>
              <th className="px-4 pb-2 text-right font-medium">Fixed</th>
              <th className="px-4 pb-2 pr-4 text-right font-medium sm:pr-5">Fix rate</th>
            </tr>
          </thead>
          <tbody>
            {repoAnalytics.map((repo) => (
              <tr key={repo.repository} className="border-t border-border-subtle">
                <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-[12px] text-foreground sm:px-5">
                  {repo.repository}
                </td>
                <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-fg-muted">
                  {repo.reviews}
                </td>
                <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-warning">
                  {repo.open}
                </td>
                <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-success">
                  {repo.fixed}
                </td>
                <td className="px-4 py-2.5 pr-4 text-right text-[12.5px] tabular-nums text-foreground sm:pr-5">
                  {repo.fixRate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FramedCard>
  );
}

export default function AnalyticsPage() {
  return (
    <ReviewPageShell
      title="Analytics"
      description="Review volume, findings, and fix rates across your repositories."
    >
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Reviews run"
          value={analyticsSummary.reviews}
          hint={analyticsSummary.reviewsHint}
          icon={GitPullRequest}
          tone="brand"
        />
        <StatCard
          label="Findings found"
          value={analyticsSummary.findings}
          hint={analyticsSummary.findingsHint}
          icon={ShieldAlert}
          tone="warning"
        />
        <StatCard
          label="Fix rate"
          value={`${analyticsSummary.fixRate}%`}
          hint={analyticsSummary.fixRateHint}
          icon={Wrench}
          tone="success"
        />
        <StatCard
          label="Avg. time to fix"
          value={`${analyticsSummary.timeToFix}h`}
          hint={analyticsSummary.timeToFixHint}
          icon={Timer}
          tone="info"
        />
      </div>

      <div className="mb-4">
        <ActivityHeatmap />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReviewVolume />
        <Panel
          title="Open findings by severity"
          meta={<span className="text-[11.5px] text-fg-faint">Currently open</span>}
        >
          <SeverityBars severity={openSeverity} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FindingsByCategory />
        <RepositoryHealth />
      </div>
    </ReviewPageShell>
  );
}
