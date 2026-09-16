import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Layout } from "@/components/Layout";
import {
  ChevronDown,
} from "lucide-react";

/* ─── Data ─── */

const faqs = [
  {
    q: "Can I switch plans at any time?",
    a: "Yes, you can upgrade or downgrade whenever you need to from your billing page. Changes take effect immediately and your payment is adjusted prorata.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes! The Free plan is available without a payment card and includes 10 repos, 100 reviews per month, 100 MB storage, and 1500 AI credits per month. Paid plans start at $5/month.",
  },
  {
    q: "Can my whole team use Cortardo?",
    a: "Yes, every plan includes unlimited collaborators. Invite your entire engineering team at no extra cost.",
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

export default function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  /* Support /#features navigation from the header on other pages. */
  useEffect(() => {
    if (window.location.hash === "#features") {
      const el = document.getElementById("features");
      if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
  }, []);

  return (
    <Layout fullWidth bleedHeader logo="/CortardoFull.svg?v=1" logoClassName="h-[14px] sm:h-[16px] md:h-[20px]">
      {/* ── Hero: copy on white background, image box below ── */}
      <div className="w-full px-1.5 sm:px-2 md:px-3 pt-10 md:pt-14 pb-40 md:pb-56">
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
              Cortardo reviews every pull request, catching bugs, security
              <br /> issues, and style drift before they reach production.
            </p>
          </Reveal>
        </div>

        <Reveal>
          <section className="hero-image-box relative aspect-[1788/480] min-h-[260px] sm:min-h-[240px] md:min-h-[280px] w-full overflow-hidden rounded-[8px] md:rounded-[10px]">
            {/* Background image */}
              <img
                src="/landing-hero.png"
                alt=""
                aria-hidden
                className="absolute top-0 left-0 w-full h-auto"
              />

            {/* White fade at the top — base fade across full width, deeper fade in the middle (rounded dip) */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-52 md:h-72 w-full bg-gradient-to-b from-white via-white/60 to-transparent"
            />
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-64 md:h-96"
                style={{
                background:
                  "linear-gradient(to bottom, #ffffff 0%, rgba(255,255,255,0.85) 25%, rgba(255,255,255,0.45) 55%, rgba(255,255,255,0.15) 80%, rgba(255,255,255,0) 100%)",
                maskImage:
                  "radial-gradient(ellipse 70% 100% at 50% 0%, #000 55%, transparent 100%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 70% 100% at 50% 0%, #000 55%, transparent 100%)",
              }}
            />
          </section>
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
                  subtitle="No stale reviews. No bottlenecks waiting on a senior engineer's availability."
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
                  subtitle="Cortardo watches your repositories and reviews every pull request automatically — flagging bugs, security vulnerabilities, and style drift with line-by-line comments and one-click fixes."
                />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── [03] Team collaboration — header left, image placeholder right ── */}
        <section>
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Reveal>
                <SectionHead
                  index="03"
                  label="Team collaboration"
                  title="Review in the same thread, even when you're apart."
                  subtitle="Inline comments, resolved threads, and shared rules mean your whole team reviews together — with tribal knowledge captured as conventions Cortardo enforces on every PR."
                />
              </Reveal>
            </div>
            <Reveal delay={0.1} className="w-full">
              <ImageComingSoon />
            </Reveal>
          </div>
        </section>

        {/* ── [04] Export code for free — image placeholder left, header right ── */}
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
                  label="Fix with one click"
                  title="Review to merge, without the busywork."
                  subtitle="Every plan, including Free, gets inline suggestions that apply straight to your branch. No copy-paste, no follow-up commits, no cost."
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
                subtitle="Everything you need to know about Cortardo plans and features."
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
