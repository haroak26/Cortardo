import { useState } from "react";
import { Layout } from "@/components/Layout";
import { PricingSection } from "@/components/PricingSection";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "Can I switch plans at any time?",
    a: "Yes, you can upgrade or downgrade whenever you need to from your billing page. Changes take effect immediately and your payment is adjusted prorata.",
  },
  {
    q: "What is a workspace?",
    a: "A workspace keeps your repositories, review rules, and team members organized in one place. Each workspace has its own repos, findings, and settings.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes! The Starter plan includes 1 repo, 100 reviews per month, 1 seat, 100 MB storage, and 10 AI credits per month — no payment card required.",
  },
  {
    q: "Can I switch plans at any time?",
    a: "Yes, you can upgrade or downgrade whenever you need to from your billing page. Changes take effect immediately and your payment is adjusted prorata.",
  },
  {
    q: "What are AI credits?",
    a: "AI credits power the Cortardo AI agent for code review. Each credit is consumed based on the AI model used and the size of the diff being reviewed. You get a monthly allowance with your plan, and can buy more credit packs anytime — they never expire.",
  },
];

export default function Pricing() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  return (
    <Layout fullWidth bleedHeader logo="/CortardoFull.svg?v=1" logoClassName="h-[14px] sm:h-[16px] md:h-[20px]">
      <div className="landing-grid" />

      {/* ── HERO ──────────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden pt-20 md:pt-28 pb-14 md:pb-20">
        <div className="relative px-6 md:px-10">
          <div className="relative mx-auto max-w-4xl text-center">
            <h1 className="font-baskerville text-[30px] sm:text-[38px] md:text-[44px] text-foreground font-normal leading-[1.18] tracking-[-0.01em]">
              Simple pricing. No games.
            </h1>
            <p className="mx-auto mt-5 max-w-[520px] text-[14.5px] md:text-[15.5px] text-foreground/80 font-normal leading-[1.7] text-pretty">
              Start for free, upgrade when you grow. No hidden fees.
            </p>
          </div>
        </div>
      </section>

      {/* ── PRICING CARDS ────────────────────────────────────────── */}
      <div className="lds-marketing-section">
        <PricingSection />
      </div>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <section className="w-full py-14 md:py-20">
        <div className="lds-marketing-section">
          <div className="space-y-14">
            <div className="space-y-2">
              <h2
                className="text-[#1e1e1e]"
                style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.2, letterSpacing: "-0.03em" }}
              >
                Frequently asked questions.
              </h2>
              <p className="text-[13px] text-muted-foreground font-medium">Everything you need to know about Cortardo plans and billing.</p>
            </div>

            <div>
              {faqs.map(({ q, a }, i) => (
                <div key={q}>
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="flex items-center justify-between w-full py-5 text-left bg-none border-none cursor-pointer group"
                  >
                    <span className="text-[15px] font-semibold text-[#1e1e1e] tracking-[-0.01em]">{q}</span>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground shrink-0 ml-4 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <div
                    className={`grid transition-all duration-200 ease-out ${openFaq === i ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                  >
                    <div className="overflow-hidden">
                      <p className="pb-5 text-[13px] text-[#86868b] leading-[1.7] font-medium">{a}</p>
                    </div>
                  </div>
                  {i < faqs.length - 1 && <div className="border-b border-border" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

    </Layout>
  );
}
