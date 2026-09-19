import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Layout } from "@/components/Layout";
import { ChevronDown } from "lucide-react";

/* ─── Data ─── */

const faqs = [
  {
    q: "What is CodeBot?",
    a: "CodeBot is Cortardo's staged review agent. It maps the changed code, scans for risks, drafts fixes, and verifies them in a sandbox before posting a single review comment.",
  },
  {
    q: "Does CodeBot change my code?",
    a: "No. Every stage is read-only on your repository. Fixes arrive as suggestions, and nothing is applied until you accept it.",
  },
  {
    q: "How are fixes verified?",
    a: "Each candidate fix is applied in an isolated cloud sandbox, the project is built and run, and failures are diagnosed and repaired across a few attempts. Fixes that don't pass are never suggested.",
  },
  {
    q: "What happens to findings it can't verify?",
    a: "They stay in the review as advisories with their honest status — CodeBot never posts a suggestion it hasn't proven.",
  },
  {
    q: "Do I need to change my workflow?",
    a: "No. CodeBot works alongside your existing review process, publishing one comment on the pull request with findings, fix statuses, and a collapsed verification log.",
  },
];

/* ─── Motion helper ─── */

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Image placeholder — dashed box shown until real section imagery lands ─── */

function ImageComingSoon() {
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[8px] border border-dashed border-border bg-surface-subtle/40">
      <span className="text-[13px] font-medium text-fg-muted">Image coming soon</span>
    </div>
  );
}

/* ─── Section header — mono index + label, big title, optional subtext ─── */

function SectionHead({
  index,
  label,
  title,
  subtitle,
}: {
  index?: string;
  label?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      {(index || label) && (
        <div className="flex items-center gap-2.5">
          {index && <span className="font-mono text-[12px] text-fg-faint">[{index}]</span>}
          {label && (
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-brand">
              {label}
            </span>
          )}
        </div>
      )}
      <h2 className="mt-5 font-baskerville text-[26px] sm:text-[32px] md:text-[38px] font-normal leading-[1.15] tracking-[-0.01em] text-balance text-foreground">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 max-w-[560px] text-[16.5px] md:text-[18px] font-normal leading-[1.65] text-pretty text-foreground">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ─── Page ─── */

export default function CodeBot() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <Layout fullWidth bleedHeader logo="/CortardoFull.svg?v=1" logoClassName="h-[14px] sm:h-[16px] md:h-[20px]">
      {/* ── Hero: copy on white background, mockup box below ── */}
      <div className="w-full px-1.5 sm:px-2 md:px-3 pt-10 md:pt-14 pb-16 md:pb-24">
        {/* Hero copy — centered on white */}
        <div className="mx-auto w-full max-w-4xl px-6 pt-6 md:pt-10 pb-12 md:pb-16 text-center">
          <Reveal delay={0.06}>
            <h1 className="font-baskerville text-[30px] sm:text-[38px] md:text-[44px] text-foreground font-normal leading-[1.18] tracking-[-0.01em]">
              Introducing CodeBot.
              <br />{" "}
              The reviewer that proves its fixes.
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-[520px] text-[14.5px] md:text-[15.5px] text-foreground/80 font-normal leading-[1.7] text-pretty">
              CodeBot reads every pull request, ranks what's actually wrong,
              <br /> and only suggests fixes it has verified in a sandbox.
            </p>
          </Reveal>
        </div>

        <Reveal>
          <div className="flex h-[640px] w-full items-center justify-center rounded-[8px] border border-dashed border-border bg-surface-subtle/40 md:h-[760px] md:rounded-[10px]">
            <span className="text-[13px] font-medium text-fg-muted">Mockup coming soon</span>
          </div>
        </Reveal>
      </div>

      {/* ── Open sections — no cards, just content with breathing room. ── */}
      <div className="mx-auto w-full max-w-6xl px-6 md:px-10 flex flex-col gap-20 md:gap-28">

        {/* ── [01] How it works — header left, image placeholder right ── */}
        <section id="features" className="scroll-mt-[80px]">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Reveal>
                <SectionHead
                  index="01"
                  label="How it works"
                  title="Four stages. One review."
                  subtitle="Codegraph maps the change, hypotheses surface the risks, fixes are drafted, and verification runs the code — all before a single comment is posted."
                />
              </Reveal>
            </div>
            <Reveal delay={0.1} className="w-full">
              <ImageComingSoon />
            </Reveal>
          </div>
        </section>

        {/* ── [02] Hypotheses — image placeholder left, header right ── */}
        <section>
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="order-2 lg:order-1">
              <Reveal delay={0.1} className="w-full">
                <ImageComingSoon />
              </Reveal>
            </div>
            <div className="order-1 lg:order-2">
              <Reveal>
                <SectionHead
                  index="02"
                  label="Hypotheses"
                  title="Advisories ranked by evidence."
                  subtitle="Every finding is mechanism-level and honest about being unproven, then ranked by priority — so you see what matters first, not a wall of noise."
                />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── [03] Verified fixes — header left, image placeholder right ── */}
        <section>
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Reveal>
                <SectionHead
                  index="03"
                  label="Verified fixes"
                  title="Fixes proven before they ship."
                  subtitle="Drafts are cloned into an isolated sandbox, applied, and run. Only fixes that pass become inline suggestions you can accept with one click."
                />
              </Reveal>
            </div>
            <Reveal delay={0.1} className="w-full">
              <ImageComingSoon />
            </Reveal>
          </div>
        </section>

        {/* ── [04] One comment — image placeholder left, header right ── */}
        <section>
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="order-2 lg:order-1">
              <Reveal delay={0.1} className="w-full">
                <ImageComingSoon />
              </Reveal>
            </div>
            <div className="order-1 lg:order-2">
              <Reveal>
                <SectionHead
                  index="04"
                  label="One comment"
                  title="One review. No noise."
                  subtitle="Findings, fix statuses, and the verification log arrive in a single review comment, with a native GitHub suggestion for every verified fix."
                />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── [05] FAQ — header left, accordion right ── */}
        <section className="pb-10 md:pb-16">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
            <Reveal>
              <SectionHead
                index="05"
                label="FAQ"
                title="Frequently asked questions."
                subtitle="Everything you need to know about how CodeBot reviews and verifies your code."
              />
            </Reveal>
            <div className="flex flex-col divide-y divide-border border-t border-border">
              {faqs.map(({ q, a }, i) => (
                <div key={q}>
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="flex w-full items-center justify-between gap-4 py-5 md:py-6 text-left bg-none border-none cursor-pointer group"
                  >
                    <span className="text-[15px] md:text-[16px] font-semibold tracking-[-0.01em] text-foreground group-hover:text-brand transition-colors">
                      {q}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200 ${openFaq === i ? "rotate-180" : ""}`}
                    />
                  </button>
                  <div
                    className={`grid transition-all duration-200 ease-out ${openFaq === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                  >
                    <div className="overflow-hidden">
                      <p className="pb-6 text-[13.5px] md:text-[14px] font-medium leading-[1.7] text-fg-muted">{a}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
