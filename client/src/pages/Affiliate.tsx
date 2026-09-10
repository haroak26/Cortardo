import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/button";
import { Eyebrow } from "@/components/ds";
import { MarketingSection, MarketingSectionHead } from "@/components/ds/widgets";
import { LandingHero } from "@/components/marketing";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Gift,
  LifeBuoy,
  Link2,
  Percent,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

const stats = [
  { value: "25%", label: "Recurring commission" },
  { value: "90 days", label: "Cookie window" },
  { value: "30 days", label: "Payout cycle" },
];

const steps = [
  {
    num: "01",
    title: "Grab your link",
    description: "Join the program and get a unique tracking link in seconds. No approval queue, no paperwork.",
  },
  {
    num: "02",
    title: "Share it",
    description: "Mention Cortardo in a post, a video, a newsletter, or a community. Whenever someone signs up through your link, it's tracked automatically.",
  },
  {
    num: "03",
    title: "Earn every month",
    description: "You earn 25% of their subscription for as long as they stay a customer. Paid out monthly, no caps, no minimums.",
  },
];

const benefits = [
  {
    icon: Percent,
    title: "Repeating revenue",
    description: "Commission on every renewal, not just the first sale. A customer you bring today keeps paying you for months.",
  },
  {
    icon: TrendingUp,
    title: "A product people keep",
    description: "Cortardo converts and retains. The better your referrals stick around, the more you earn — automatically.",
  },
  {
    icon: Link2,
    title: "Real-time dashboard",
    description: "Clicks, signups, conversions, and earnings updated live. Know exactly what's working.",
  },
  {
    icon: Sparkles,
    title: "Ready-made assets",
    description: "Banners, screenshots, demo videos, and copy that fits your audience. Drop them in and ship.",
  },
  {
    icon: Gift,
    title: "Early access & credits",
    description: "Partners get early access to new features and a monthly credit allowance to try everything yourself.",
  },
  {
    icon: LifeBuoy,
    title: "A human on call",
    description: "Dedicated partner support with fast answers, custom tracking questions, and creative help when you need it.",
  },
];

const faqs = [
  {
    q: "Who can join the affiliate program?",
    a: "Anyone with an audience that cares about software, development, or shipping products — creators, YouTubers, newsletter writers, community leaders, and agencies are all welcome.",
  },
  {
    q: "How and when do I get paid?",
    a: "Earnings are paid out monthly via PayPal or bank transfer once you reach $25. There are no minimums after that and no upper cap on what you can earn.",
  },
  {
    q: "How long does a referral stay attributed to me?",
    a: "A 90-day cookie window means you earn commission on any signup within 90 days of someone first clicking your link. After they're a customer, you keep earning on renewals indefinitely.",
  },
  {
    q: "Can I promote Cortardo on my own terms?",
    a: "Yes. Use your own voice, format, and platforms. We only ask that you're honest about the product and follow our simple brand guidelines.",
  },
];

export default function Affiliate() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <Layout fullWidth>
      <div className="landing-grid" />

      <LandingHero
        title={
          <>
            Earn 25% on every
            <br />
            customer you refer.
          </>
        }
        description="Promote Cortardo to your audience and earn 25% recurring commission for as long as your referrals stay customers. Real-time dashboard, monthly payouts, and no caps."
        actions={
          <>
            <Link href="/auth/signup">
              <Button design="pill" size="md" className="h-[44px] px-6 text-[15px]">
                Join the program
              </Button>
            </Link>
            <Link href="/contact">
              <Button design="pill-ghost" size="md" className="h-[44px] px-5 text-[15px]">
                Talk to us
              </Button>
            </Link>
          </>
        }
      />

      {/* Stats */}
      <section className="w-full border-t border-border">
        <div className="lds-marketing-section">
          <div className="grid grid-cols-1 sm:grid-cols-3">
            {stats.map((s, i) => (
              <div
                key={s.label}
                className={`py-10 md:py-12 text-center ${i > 0 ? "sm:border-l sm:border-border" : ""}`}
              >
                <p className="text-[32px] md:text-[40px] font-semibold tracking-[-0.03em] text-foreground">
                  {s.value}
                </p>
                <p className="mt-1.5 text-[13px] font-medium text-fg-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <MarketingSection>
        <div className="space-y-12 md:space-y-16">
          <MarketingSectionHead
            eyebrow="How it works"
            title="Three steps to a second income stream."
            description="No approval queue, no complex contracts. Join, share, and get paid every month."
          />
          <div className="grid md:grid-cols-3 gap-x-12 gap-y-10">
            {steps.map((step, i) => (
              <div key={step.num} className="border-t border-border pt-5">
                <p className="text-[12px] font-semibold text-[#FF7A6E] tracking-[0.06em]">{step.num}</p>
                <h3 className="mt-2.5 text-[16px] font-semibold text-foreground tracking-[-0.01em]">{step.title}</h3>
                <p className="mt-1.5 text-[13px] text-fg-muted leading-[1.65] font-medium">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </MarketingSection>

      {/* Benefits */}
      <MarketingSection>
        <div className="space-y-12 md:space-y-16">
          <MarketingSectionHead
            eyebrow="Why partner with us"
            title="Built for creators who ship."
            description="We make it easy to recommend Cortardo with confidence — and easy to get paid for it."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {benefits.map(({ icon: Icon, title, description }) => (
              <div key={title} className="soft-card p-6 h-full flex flex-col gap-3">
                <span className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-white border border-border/70 shrink-0">
                  <Icon size={17} strokeWidth={1.75} className="text-sky-500" />
                </span>
                <h3 className="text-[15px] font-semibold text-foreground tracking-[-0.01em]">{title}</h3>
                <p className="text-[13px] text-fg-muted leading-[1.65] font-medium">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </MarketingSection>

      {/* FAQ */}
      <MarketingSection>
        <div className="space-y-12 md:space-y-16">
          <MarketingSectionHead eyebrow="FAQ" title="Questions, answered." />
          <div className="max-w-3xl">
            {faqs.map(({ q, a }, i) => (
              <div key={q}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex items-center justify-between w-full py-5 text-left bg-none border-none cursor-pointer group"
                >
                  <span className="text-[15px] font-semibold text-foreground tracking-[-0.01em] group-hover:text-brand transition-colors">
                    {q}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-fg-muted shrink-0 ml-4 transition-transform duration-200 ${openFaq === i ? "rotate-180" : ""}`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-200 ease-out ${openFaq === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden">
                    <p className="pb-5 max-w-2xl text-[13px] text-fg-muted leading-[1.7] font-medium">{a}</p>
                  </div>
                </div>
                {i < faqs.length - 1 && <div className="border-b border-border" />}
              </div>
            ))}
          </div>
        </div>
      </MarketingSection>

      {/* Final CTA */}
      <section className="w-full border-t border-border">
        <div className="lds-marketing-section py-20 md:py-28">
          <div className="max-w-2xl">
            <Eyebrow label="START TODAY">Free to join</Eyebrow>
            <h2 className="mt-6 text-[30px] sm:text-[38px] md:text-[44px] font-medium leading-[1.06] tracking-[-0.03em] text-foreground">
              Your audience already loves dev tools.
              <br />
              Get paid for introducing them.
            </h2>
            <div className="mt-8 flex items-center gap-4">
              <Link href="/auth/signup">
                <Button design="pill" size="md" className="h-[44px] px-6 text-[15px]">
                  Join the program
                  <ArrowRight size={15} strokeWidth={2} />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
