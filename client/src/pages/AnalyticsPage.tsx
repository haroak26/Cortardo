import { useMemo } from 'react';
import { Gauge, GitPullRequest, ShieldAlert, Wrench } from 'lucide-react';
import { ReviewPageShell, SeverityBars } from '@/components/review/bits';
import { MetricCard } from '@/components/ds';
import { cn } from '@/lib/utils';
import {
  analyticsSummary,
  findingsByCategory,
  openSeverity,
  repoAnalytics,
  reviewActivity,
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
    <MetricCard
      label="Review activity"
      hint={`${total.toLocaleString()} runs in the last 6 months`}
      textPosition="top"
      dotMatrix={false}
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
    </MetricCard>
  );
}

function FindingsByCategory() {
  const max = Math.max(...findingsByCategory.map((row) => row.count), 1);
  return (
    <MetricCard label="Findings by category" hint="All time" textPosition="top" dotMatrix={false}>
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
    </MetricCard>
  );
}

function RepositoryHealth() {
  return (
    <MetricCard
      label="Repository health"
      hint="Open vs fixed findings"
      textPosition="top"
      dotMatrix={false}
    >
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-fg-faint">
              <th className="px-1 pb-2 font-medium">Repository</th>
              <th className="px-1 pb-2 text-right font-medium">Reviews</th>
              <th className="px-1 pb-2 text-right font-medium">Open</th>
              <th className="px-1 pb-2 text-right font-medium">Fixed</th>
              <th className="px-1 pb-2 text-right font-medium">Fix rate</th>
            </tr>
          </thead>
          <tbody>
            {repoAnalytics.map((repo) => (
              <tr key={repo.repository} className="border-t border-border-subtle">
                <td className="max-w-[220px] truncate px-1 py-2.5 font-mono text-[12px] text-foreground">
                  {repo.repository}
                </td>
                <td className="px-1 py-2.5 text-right text-[12.5px] tabular-nums text-fg-muted">
                  {repo.reviews}
                </td>
                <td className="px-1 py-2.5 text-right text-[12.5px] tabular-nums text-warning">
                  {repo.open}
                </td>
                <td className="px-1 py-2.5 text-right text-[12.5px] tabular-nums text-success">
                  {repo.fixed}
                </td>
                <td className="px-1 py-2.5 text-right text-[12.5px] tabular-nums text-foreground">
                  {repo.fixRate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MetricCard>
  );
}

export default function AnalyticsPage() {
  return (
    <ReviewPageShell
      title="Analytics"
      description="Review volume, findings, and fix rates across your repositories."
    >
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Reviews run"
          value={analyticsSummary.reviews}
          hint={analyticsSummary.reviewsHint}
          icon={GitPullRequest}
          tone="brand"
        />
        <MetricCard
          label="Findings found"
          value={analyticsSummary.findings}
          hint={analyticsSummary.findingsHint}
          icon={ShieldAlert}
          tone="warning"
        />
        <MetricCard
          label="Fix rate"
          value={`${analyticsSummary.fixRate}%`}
          hint={analyticsSummary.fixRateHint}
          icon={Wrench}
          tone="success"
        />
        <MetricCard
          label="Findings per review"
          value={analyticsSummary.perReview}
          hint={analyticsSummary.perReviewHint}
          icon={Gauge}
          tone="info"
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ActivityHeatmap />
        <MetricCard
          label="Open findings by severity"
          hint="Currently open"
          textPosition="top"
          dotMatrix={false}
        >
          <SeverityBars severity={openSeverity} />
        </MetricCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FindingsByCategory />
        <RepositoryHealth />
      </div>
    </ReviewPageShell>
  );
}
