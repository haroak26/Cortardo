import { useLocation } from 'wouter';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/button';
import { MetricCard } from '@/components/ds';
import { dashboardMetrics } from '@/lib/mock-review-data';
import { AlertTriangle, FolderGit2, GitPullRequest, ShieldAlert } from 'lucide-react';

const METRIC_ICONS = {
  reviews: GitPullRequest,
  open: ShieldAlert,
  priority: AlertTriangle,
  repos: FolderGit2,
} as const;

export default function HomePage() {
  const { data: user } = useUser();
  const [, setLocation] = useLocation();

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
  const firstName = (user?.displayName?.trim() || user?.email?.split('@')[0] || 'there').split(/\s+/)[0];

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 px-4 sm:px-6 md:px-8 pt-10 pb-8 sm:pt-14 sm:pb-12 max-w-5xl mx-auto w-full">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="font-sans text-[15px] font-medium leading-tight text-foreground truncate">
              {timeGreeting}, {firstName}
            </h1>
            <p className="mt-0.5 text-[12px] font-[450] leading-snug text-fg-warm">
              Reviews and findings across your repositories.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button design="pill-secondary" onClick={() => setLocation('/bot/rules')}>
              Bot
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
          {dashboardMetrics.map((metric) => {
            const Icon = METRIC_ICONS[metric.key as keyof typeof METRIC_ICONS] ?? GitPullRequest;
            return (
              <MetricCard
                key={metric.key}
                label={metric.label}
                value={metric.value}
                hint={metric.hint}
                icon={Icon}
                tone={metric.tone}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
