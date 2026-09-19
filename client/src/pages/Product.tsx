import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Layout } from "@/components/Layout";
import { ChevronDown } from "lucide-react";

/* ─── Data ─── */

const faqs = [
  {
    q: "How fast are reviews?",
    a: "Cortardo reviews the full diff in seconds after you push. Findings appear inline on the pull request — bugs, security issues, and style drift — not in a separate tool.",
  },
  {
    q: "Which languages does Cortardo support?",
    a: "Cortardo reviews all major languages — TypeScript, JavaScript, Python, Go, Rust, Java, Ruby, and more — plus framework-aware checks for React, Next.js, Django, and Rails.",
  },
  {
    q: "Does Cortardo work with my git provider?",
    a: "Yes. Cortardo works alongside your existing workflow — open your reviews and the agent handles the rest, with no downloads needed.",
  },
  {
    q: "Can I customise what Cortardo looks for?",
    a: "Yes, write review rules in plain English. Tell Cortardo your team's conventions and it enforces them on every PR, with inline suggestions and one-click fixes.",
  },
  {
    q: "Can my whole team use Cortardo?",
    a: "Yes, every plan includes unlimited collaborators. Invite your entire engineering team at no extra cost.",
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

export default function Product() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <Layout fullWidth bleedHeader logo="/CortardoFull.svg?v=1" logoClassName="h-[14px] sm:h-[16px] md:h-[20px]">
      {/* ── Hero: copy on white background, mockup box below ── */}
      <div className="w-full px-1.5 sm:px-2 md:px-3 pt-10 md:pt-14 pb-16 md:pb-24">
        {/* Hero copy — centered on white */}
        <div className="mx-auto w-full max-w-4xl px-6 pt-6 md:pt-10 pb-12 md:pb-16 text-center">
          <Reveal delay={0.06}>
            <h1 className="font-baskerville text-[30px] sm:text-[38px] md:text-[44px] text-foreground font-normal leading-[1.18] tracking-[-0.01em]">
              Ship clean code.
              <br />{" "}
              Skip the review bottleneck.
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-[520px] text-[14.5px] md:text-[15.5px] text-foreground/80 font-normal leading-[1.7] text-pretty">
              Connect a repo and Cortardo reviews every pull request, flagging
              <br /> bugs, security issues, and style drift before they reach production.
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
                  title="From pull request to merged."
                  subtitle="Open your reviews, run the agent, fix and merge — no waiting on a reviewer's calendar and no merge-day surprises."
                />
              </Reveal>
            </div>
            <Reveal delay={0.1} className="w-full">
              <ImageComingSoon />
            </Reveal>
          </div>
        </section>

        {/* ── [02] Cortardo Agent — image placeholder left, header right ── */}
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
                  label="Cortardo Agent"
                  title="One push. A full code review."
                  subtitle="Push a branch and Cortardo reviews the full diff in seconds — logic errors, edge cases, and unsafe dependencies caught before they ever reach production."
                />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── [03] Inline suggestions — header left, image placeholder right ── */}
        <section>
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Reveal>
                <SectionHead
                  index="03"
                  label="Inline suggestions"
                  title="Comments land right on the line."
                  subtitle="Accept a fix with one click and keep moving. Every plan, including Free, gets inline suggestions that apply straight to your branch — no copy-paste, no follow-up commits."
                />
              </Reveal>
            </div>
            <Reveal delay={0.1} className="w-full">
              <ImageComingSoon />
            </Reveal>
          </div>
        </section>

        {/* ── [04] PR summaries — image placeholder left, header right ── */}
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
                  label="PR summaries"
                  title="Merge with full context."
                  subtitle="Instant walkthroughs of what changed, why it matters, and what to check before merging — with your team's conventions enforced automatically on every review."
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
                subtitle="Everything you need to know about how Cortardo reviews your code."
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
