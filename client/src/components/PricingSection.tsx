import { Link } from "wouter";
import { Button } from "@/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { PLAN_LIMITS, type PlanTier } from "@shared/schema";

type CurrentPlan = PlanTier;

// Tier keys map to: free=Starter, pro=Individual, team=Professional, enterprise=Organization.
// 1 credit = $0.001 of AI API usage.
const TIERS: { key: PlanTier; description: string; features: string[] }[] = [  {
    key: "free",
    description: "Free to get started.",
    features: [
      "10 Review Credits",
      "Cortardo Agent",
      "1 repo",
    ],
  },
  {
    key: "pro",
    description: "For solo developers.",
    features: [
      "30 Review Credits, per month",
      "One-click fixes",
      "5 repos",
    ],
  },
  {
    key: "team",
    description: "For growing engineering teams.",
    features: [
      "60 Review Credits, per month",
      "Unlimited repos",
      "Security Review",
      "Learnings",
    ],
  },
  {
    key: "enterprise",
    description: "For large organizations.",
    features: [
      "120 Review Credits, per month",
      "Everything in Professional",
      "Learnings",
      "SSO and SAML",
    ],
  },
];

export function PricingSection() {
  const { data: user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: planInfo } = useQuery<{ plan: CurrentPlan; cancelAtPeriodEnd: boolean }>({
    queryKey: ["/api/me/plan"],
    enabled: !!user,
  });
  const currentPlan: CurrentPlan = planInfo?.plan ?? "free";

  const checkoutMutation = useMutation({
    mutationFn: async ({ plan }: { plan: PlanTier }) => {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to create checkout session" }));
        throw new Error(err.message ?? "Failed to create checkout session");
      }
      return res.json() as Promise<{ url?: string; switched?: boolean; plan?: string }>;
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.switched) {
        toast({
          title: "Plan updated",
          description: `You're now on the ${data.plan ?? "new"} plan. Billing has been adjusted.`,
          variant: "success",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/me"] });
        queryClient.invalidateQueries({ queryKey: ["/api/me/plan"] });
      }
    },
    onError: (err) => {
      toast({
        title: "Subscription checkout unavailable",
        description: (err as Error).message,
        variant: "destructive",
      });
    },
  });

  /* Feature lists are explicit per tier (see TIERS above). */

  return (
    <section id="pricing" className="py-6 md:py-8">
      <div className="relative">
        <div className="flex flex-col md:flex-row md:items-stretch overflow-hidden rounded-[20px] border border-[hsl(var(--surface-hover))] bg-background">
          {TIERS.map(({ key, description, features }, idx) => {
            const limits = PLAN_LIMITS[key];
            return (
              <div key={key} className="contents">
                <div className="flex-1 flex flex-col gap-3 md:gap-4 lg:gap-5 p-3 md:p-4 lg:p-5 min-h-[460px]">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-medium tracking-[-0.01em]">{limits.label}</h3>
                    </div>
                    <p className="text-sm leading-5 text-muted-foreground">{description}</p>
                  </div>

                  <div className="h-px w-full bg-[hsl(var(--surface-hover))]" />

                  <div>
                    <span className="text-2xl font-semibold tracking-tight leading-none">${limits.prices.monthly}</span>
                    <p className="mt-1.5 text-xs font-[450] text-muted-foreground">
                      {key === "free" || key === "pro" ? "Per month" : "Per developer, billed monthly"}
                    </p>
                  </div>

                  <div className="h-px w-full bg-[hsl(var(--surface-hover))]" />

                  <div className="flex-1">
                    <p className="mb-3 text-sm font-semibold text-brand">What's included</p>
                    <ul className="space-y-2.5 mb-6">
                      {features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5 text-sm leading-6 text-muted-foreground">
                          <span className="mt-[4px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand">
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={3.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-2.5 w-2.5 text-white"
                            >
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    {key === "free" ? (
                      user ? (
                        <>
                          {key === currentPlan ? (
                            <Button design="secondary" className="w-full text-brand-charcoal" disabled data-testid={`button-pricing-${key}`}>
                              Current plan
                            </Button>
                          ) : (
                            <Link href="/account">
                              <Button design="secondary" className="w-full text-brand-charcoal" data-testid={`button-pricing-${key}`}>
                                Get Started
                              </Button>
                            </Link>
                          )}
                        </>
                      ) : (
                        <Link href="/auth/signup">
                          <Button design="secondary" className="w-full text-brand-charcoal" data-testid={`button-pricing-${key}`}>
                            Get Started
                          </Button>
                        </Link>
                      )
                    ) : user ? (
                      <Button
                        design={key === "pro" ? "primary" : "secondary"}
                        className={`w-full ${key === "pro" ? "" : "text-brand-charcoal"}`}
                        onClick={() => checkoutMutation.mutate({ plan: key })}
                        disabled={key === currentPlan || checkoutMutation.isPending}
                        data-testid={`button-pricing-${key}`}
                      >
                        {key === currentPlan ? "Current plan" : "Subscribe"}
                      </Button>
                    ) : (
                      <Link href="/auth/signup">
                        <Button
                          design={key === "pro" ? "primary" : "secondary"}
                          className={`w-full ${key === "pro" ? "" : "text-brand-charcoal"}`}
                          data-testid={`button-pricing-${key}`}
                        >
                          Subscribe
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
                {idx < TIERS.length - 1 && (
                  <div className="mx-auto h-px w-full bg-[hsl(var(--surface-hover))] md:h-auto md:w-px md:self-stretch" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}