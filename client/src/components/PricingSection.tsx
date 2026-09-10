import { useState } from "react";
import { Link } from "wouter";
import { Check, ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { CanvasDropdown } from "@/components/CanvasDropdown";
import { PLAN_LIMITS, type PlanTier, type BillingPeriod } from "@shared/schema";
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from "@/lib/billing";

type CurrentPlan = PlanTier;

// Tier keys map to: free=Free, pro=Hobby, team=Professional, enterprise=Enterprise.
// 1 credit = $0.001 of AI API usage.
const TIERS: { key: PlanTier; description: string; badge?: string; features: string[] }[] = [  {
    key: "free",
    description: "For individuals getting started.",
    features: [
      "500 credits per day",
      "1500 credits per month",
      "100 PR reviews per month",
      "Private repositories",
      "Cortardo Agent",
      "10 repos",
    ],
  },
  {
    key: "pro",
    description: "For solo developers and side projects.",
    badge: "Popular",
    features: [
      "No daily cap",
      "5000 credits per month",
      "Unlimited PR reviews",
      "One-click fixes",
      "Unlimited repos",
    ],
  },
  {
    key: "team",
    description: "For growing engineering teams.",
    features: [
      "No daily cap",
      "20000 credits a month",
      "Everything in Solo",
      "Custom review rules",
    ],
  },
  {
    key: "enterprise",
    description: "For large organizations.",
    features: [
      "No daily cap",
      "Unlimited credits a month",
      "Everything in Team",
      "SSO",
      "Unlimited team members",
    ],
  },
];

// The three paid plans render as columns; Free renders as a row below.
const PAID_TIERS = TIERS.slice(1);

export function PricingSection() {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const { data: user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: planInfo } = useQuery<{ plan: CurrentPlan; cancelAtPeriodEnd: boolean }>({
    queryKey: ["/api/me/plan"],
    enabled: !!user,
  });
  const currentPlan: CurrentPlan = planInfo?.plan ?? "free";

  const checkoutMutation = useMutation({
    mutationFn: async ({ plan, billingPeriod: bp, currency: cur }: { plan: PlanTier; billingPeriod: BillingPeriod; currency: CurrencyCode }) => {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan, billingPeriod: bp, currency: cur.toLowerCase() }),
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
        {/* Currency selector — right edge aligned with the Enterprise column content */}
        <div className="absolute right-0 top-0 z-10 md:right-7 lg:right-9">
          <CanvasDropdown
            value={currency}
            onChange={(code) => setCurrency(code as CurrencyCode)}
            options={CURRENCY_CODES.map((code) => ({
              value: code,
              label: (
                <span className="flex w-full items-center justify-between gap-3">
                  <span>{CURRENCIES[code].label}</span>
                  <span className="font-semibold">{code}</span>
                </span>
              ),
            }))}
            align="right"
          >
            <button className="flex items-center gap-1 h-7 px-2.5 rounded-full border border-border bg-background text-[12px] font-semibold text-foreground hover:border-brand/40 transition-colors cursor-pointer">
              {currency}
              <ChevronDown size={12} strokeWidth={2.5} />
            </button>
          </CanvasDropdown>
        </div>

        {/* Billing toggle */}
        <div className="flex flex-col items-center gap-2.5 mb-10">
          <div className="flex items-center justify-center gap-3">
            <span className={`text-sm font-medium ${billingPeriod === "monthly" ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
            <button
              onClick={() => setBillingPeriod(p => p === "monthly" ? "annual" : "monthly")}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${billingPeriod === "annual" ? "bg-brand" : "bg-border"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${billingPeriod === "annual" ? "translate-x-6" : "translate-x-1"}`} />
            </button>
            <span className={`text-sm font-medium ${billingPeriod === "annual" ? "text-foreground" : "text-muted-foreground"}`}>Annual</span>
          </div>
          <span className="text-[10.5px] font-semibold text-emerald-600">Save ~20% on annual</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-stretch">
          {PAID_TIERS.map(({ key, description, badge, features }, idx) => {
            const limits = PLAN_LIMITS[key];
            const usdPerUnit = CURRENCIES[currency].usdPerUnit;
            const displayPrice = billingPeriod === "annual" ? limits.prices.annual / 12 : limits.prices.monthly;
            const convertedPrice = Math.round(displayPrice / usdPerUnit);
            const convertedAnnual = Math.round(limits.prices.annual / usdPerUnit);
            return (
              <div key={key} className="contents">
                <div className="flex-1 flex flex-col py-6 md:px-7 lg:px-9 min-h-[500px]">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-medium tracking-[-0.01em]">{limits.label}</h3>
                      {badge && (
                        <span className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                          {badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-5 text-muted-foreground">{description}</p>
                  </div>
                  <div className="mt-5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[22px] font-medium text-foreground leading-none">{CURRENCIES[currency].symbol}</span>
                      <span className="text-4xl font-medium tracking-tight leading-none">{convertedPrice}</span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </div>
                    {billingPeriod === "annual" && (
                      <p className="text-xs text-emerald-600 font-medium mt-1">{CURRENCIES[currency].symbol}{convertedAnnual} billed annually</p>
                    )}
                  </div>
                  <div className="mt-5 flex-1">
                    <p className="mb-3 text-sm font-semibold text-brand">What's included</p>
                    <ul className="space-y-2.5 mb-6">
                      {features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5 text-sm leading-6 text-muted-foreground">
                          <Check className="h-3.5 w-3.5 mt-[5px] shrink-0 text-brand" strokeWidth={2.5} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-auto">
                    {key === "enterprise" ? (
                      <div className="flex gap-2">
                        {user ? (
                          <Button
                            className="flex-1"
                            onClick={() => checkoutMutation.mutate({ plan: key, billingPeriod, currency })}
                            disabled={key === currentPlan || checkoutMutation.isPending}
                            data-testid={`button-pricing-${key}`}
                          >
                            Get started
                          </Button>
                        ) : (
                          <Link href="/auth/signup" className="flex-1">
                            <Button className="w-full" data-testid={`button-pricing-${key}`}>
                              Get started
                            </Button>
                          </Link>
                        )}
                        <a href="mailto:sales@cortardo.com" className="flex-1">
                          <Button className="w-full" design="outline" data-testid={`button-pricing-${key}-sales`}>
                            Contact Sales
                          </Button>
                        </a>
                      </div>
                    ) : user ? (
                      <Button
                        className="w-full"
                        onClick={() => checkoutMutation.mutate({ plan: key, billingPeriod, currency })}
                        disabled={key === currentPlan || checkoutMutation.isPending}
                        data-testid={`button-pricing-${key}`}
                      >
                        {key === currentPlan ? "Current plan" : "Get started"}
                      </Button>
                    ) : (
                      <Link href="/auth/signup">
                        <Button className="w-full" data-testid={`button-pricing-${key}`}>
                          Get started
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
                {idx < PAID_TIERS.length - 1 && (
                  <div className="mx-auto h-px w-full bg-border/70 md:h-auto md:w-px md:self-stretch md:bg-border/70" />
                )}
              </div>
            );
          })}
        </div>

        {/* Free plan — full-width row below the paid columns */}
        <div className="mt-6">
          <div className="soft-card px-6 py-6 md:px-9 md:py-7">
            <div className="flex flex-col lg:flex-row lg:items-center gap-x-10 gap-y-6">
              <div className="lg:w-56 shrink-0">
                <h3 className="text-lg font-medium tracking-[-0.01em]">{PLAN_LIMITS.free.label}</h3>
                <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{TIERS[0].description}</p>
              </div>
              <ul className="flex-1 grid sm:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-2.5">
                {TIERS[0].features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm leading-6 text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.5} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Need more AI credits? Buy credit packs — they never expire.
          </p>
        </div>
      </div>
    </section>
  );
}