import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/button";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Server, Mail, Bot, Globe, Database } from "lucide-react";
import { LandingHero } from "@/components/marketing";

type ComponentStatus = "operational" | "degraded" | "down";

interface SystemComponent {
  id: string;
  name: string;
  status: ComponentStatus;
  latency: number | null;
}

interface SystemStatus {
  overall: ComponentStatus;
  components: SystemComponent[];
}

const iconMap: Record<string, React.ElementType> = {
  "web-app": Globe,
  "database": Database,
  "email": Mail,
  "ai-agent": Bot,
  "api": Server,
};

function StatusDot({ status }: { status: ComponentStatus }) {
  return (
    <span className="relative flex w-2.5 h-2.5">
      {status === "operational" && (
        <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-success" />
      )}
      {status === "degraded" && (
        <>
          <span className="animate-ping absolute inset-0 rounded-full bg-warning opacity-50" />
          <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-warning" />
        </>
      )}
      {status === "down" && (
        <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-destructive" />
      )}
    </span>
  );
}

function SystemStatusBadge({ status }: { status: ComponentStatus }) {
  const config = {
    operational: { label: "Operational", tone: "success" as const },
    degraded: { label: "Degraded", tone: "warning" as const },
    down: { label: "Down", tone: "danger" as const },
  };
  const { label, tone } = config[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-${tone === "success" ? "success" : tone === "warning" ? "warning" : "danger"}/10 text-${tone === "success" ? "success" : tone === "warning" ? "warning" : "danger"}`}>
      {label === "Operational" && <CheckCircle2 size={10} strokeWidth={2.5} className="mr-1" />}
      {label === "Degraded" && <AlertTriangle size={10} strokeWidth={2.5} className="mr-1" />}
      {label === "Down" && <XCircle size={10} strokeWidth={2.5} className="mr-1" />}
      {label}
    </span>
  );
}

export default function MarketingStatus() {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system/status");
      if (!res.ok) throw new Error("Failed to fetch status");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <Layout fullWidth>
      <LandingHero
        eyebrowLabel="Status"
        eyebrow="System health"
        title="Cortardo System Status."
        description="Real-time status of Cortardo's services. Check here for ongoing incidents, scheduled maintenance, and system health."
      />

      <section className="pb-24">
        <div className="lds-marketing-section">
          <div className="max-w-3xl">
            <div>
              {loading && !data && (
                <div className="space-y-4">
                  <div className="border border-border rounded-xl px-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-surface-muted animate-pulse" />
                      <div className="space-y-2 flex-1">
                        <div className="h-4 w-32 rounded bg-surface-muted animate-pulse" />
                        <div className="h-3 w-20 rounded bg-surface-muted animate-pulse" />
                      </div>
                      <div className="h-5 w-20 rounded bg-surface-muted animate-pulse" />
                    </div>
                  </div>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="flex items-center justify-between py-3.5 px-1">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-surface-muted animate-pulse" />
                        <div className="h-4 w-28 rounded bg-surface-muted animate-pulse" />
                      </div>
                      <div className="h-5 w-20 rounded bg-surface-muted animate-pulse" />
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="text-center py-16">
                  <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                    <XCircle className="h-6 w-6 text-destructive" />
                  </div>
                  <p className="text-[15px] font-semibold text-foreground mb-1">Unable to load status</p>
                  <p className="text-[13px] text-muted-foreground font-medium mb-4">{error}</p>
                  <Button onClick={fetchStatus} design="ghost" size="xs" className="hover:underline">
                    <RefreshCw size={13} strokeWidth={1.5} />
                    Try again
                  </Button>
                </div>
              )}

              {data && (
                <div className="space-y-6">
                  <div className="border border-border rounded-xl px-6 py-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <StatusDot status={data.overall} />
                        <div>
                          <span className="text-[14px] font-semibold text-foreground">All Systems</span>
                          <p className="text-[12px] text-muted-foreground font-medium mt-0.5">
                            {data.components.length} component{data.components.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <SystemStatusBadge status={data.overall} />
                    </div>
                  </div>

                  <div className="border border-border rounded-xl divide-y divide-border">
                    {data.components.map(component => {
                      const Icon = iconMap[component.id] || Server;
                      return (
                        <div key={component.id} className="flex items-center justify-between px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand/10">
                              <Icon className="h-[16px] w-[16px] text-brand" />
                            </div>
                            <div>
                              <span className="text-[14px] font-medium text-foreground">{component.name}</span>
                              {component.latency !== null && (
                                <span className="text-[11px] text-muted-foreground font-medium ml-2">
                                  {component.latency}ms
                                </span>
                              )}
                            </div>
                          </div>
                          <SystemStatusBadge status={component.status} />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <p className="text-[12px] text-muted-foreground font-medium">
                      Status checks run every 60 seconds. Last checked just now.
                    </p>
                    <Button onClick={fetchStatus} design="ghost" size="xs" className="hover:underline">
                      <RefreshCw size={12} strokeWidth={1.5} />
                      Refresh
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
