import { useMemo, useState } from 'react';
import { Search, ShieldAlert, ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/button';
import { Panel, ReviewPageShell, SeverityBars, SeverityDot, FINDING_STATUS_META } from '@/components/review/bits';
import { Badge, StatCard } from '@/components/ds';
import { FramedCard } from '@/components/framed-card';
import {
  emptySeverity,
  findings,
  SEVERITY_META,
  timeAgo,
  type SeverityCounts,
} from '@/lib/mock-review-data';

export default function SecurityPage() {
  const [search, setSearch] = useState('');

  const securityFindings = useMemo(() => findings.filter((f) => f.category === 'security'), []);

  const severity = useMemo<SeverityCounts>(() => {
    const counts = emptySeverity();
    for (const finding of securityFindings) {
      if (finding.status === 'open') counts[finding.severity] += 1;
    }
    return counts;
  }, [securityFindings]);

  const openCount = securityFindings.filter((f) => f.status === 'open').length;
  const criticalHigh = securityFindings.filter(
    (f) => f.status === 'open' && (f.severity === 'critical' || f.severity === 'high'),
  ).length;

  const filtered = securityFindings.filter(
    (finding) =>
      finding.title.toLowerCase().includes(search.toLowerCase()) ||
      finding.filePath.toLowerCase().includes(search.toLowerCase()) ||
      finding.repository.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <ReviewPageShell
      title="Security"
      description="Vulnerabilities and risky patterns the bot flagged across your repositories."
      actions={
        <Button size="sm" design="outline">
          <RefreshCw size={14} />
          Rescan
        </Button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Open security findings"
          value={openCount}
          hint={`${criticalHigh} critical or high`}
          icon={ShieldAlert}
          tone="danger"
        />
        <StatCard
          label="Resolved"
          value={securityFindings.filter((f) => f.status === 'fixed').length}
          hint="Fixed after review"
          icon={ShieldCheck}
          tone="success"
        />
        <Panel title="Severity" bodyClassName="px-4 sm:px-5 pb-4">
          <SeverityBars severity={severity} className="-mt-1" />
        </Panel>
      </div>

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search security findings..."
          aria-label="Search security findings"
          className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ShieldCheck size={32} className="text-fg-faint mb-3" strokeWidth={1.5} />
          <p className="text-[14px] font-medium text-foreground">No security findings</p>
          <p className="text-[12px] text-fg-muted mt-1">Nothing risky has been flagged in this workspace.</p>
        </div>
      ) : (
        <FramedCard>
          <ul>
            {filtered.map((finding) => {
              const statusMeta = FINDING_STATUS_META[finding.status];
              return (
                <li key={finding.id} className="border-b border-border-subtle last:border-b-0">
                  <button
                    type="button"
                    className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover/60 border-none bg-transparent cursor-pointer"
                  >
                    <span className="mt-[5px]">
                      <SeverityDot severity={finding.severity} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-medium text-foreground truncate">{finding.title}</p>
                      <p className="text-[12px] text-fg-muted truncate mt-0.5">{finding.body}</p>
                      <p className="text-[11.5px] text-fg-faint font-mono truncate mt-1">
                        {finding.filePath}:{finding.startLine} · {finding.repository}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: SEVERITY_META[finding.severity].color }}
                      >
                        {SEVERITY_META[finding.severity].label}
                      </span>
                      <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                      <span className="text-[11px] text-fg-faint tabular-nums">{timeAgo(finding.createdAt)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </FramedCard>
      )}
    </ReviewPageShell>
  );
}
