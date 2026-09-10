import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/button";
import { Eyebrow } from "@/components/ds";
import { LandingHero, SectionHeader, SoftCard, type FeatureVariant } from "@/components/marketing";
import {
  ArrowRight,
  Bug,
  FileSearch,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";

const features: { icon: typeof GitPullRequest; title: string; description: string; variant: FeatureVariant }[] = [
  {
    icon: Sparkles,
    title: "PR to reviewed in seconds",
    description: "Push a branch and Cortardo reviews the full diff in seconds — line-by-line, not a rubber stamp.",
    variant: "brand",
  },
  {
    icon: Bug,
    title: "Bug detection",
    description: "Logic errors, edge cases, and null paths caught before they ever reach production.",
    variant: "purple",
  },
  {
    icon: ShieldCheck,
    title: "Security scanning",
    description: "Injection, XSS, unsafe deps, and secret leaks flagged with severity and a suggested fix.",
    variant: "amber",
  },
  {
    icon: MessageSquare,
    title: "Inline suggestions",
    description: "Comments land right on the line. Accept a fix with one click and keep moving.",
    variant: "green",
  },
  {
    icon: Zap,
    title: "One-click fixes",
    description: "Apply suggested patches straight to your branch — no copy-paste, no follow-up commits.",
    variant: "brand",
  },
  {
    icon: FileSearch,
    title: "PR summaries",
    description: "Instant walkthroughs of what changed, why it matters, and what to check before merging.",
    variant: "purple",
  },
  {
    icon: GitMerge,
    title: "Style enforcement",
    description: "Your conventions, written in plain English, enforced automatically on every PR.",
    variant: "green",
  },
  {
    icon: Terminal,
    title: "Works where you work",
    description: "GitHub, GitLab, and Bitbucket integrations that comment in the PRs you already use.",
    variant: "amber",
  },
];

const steps = [
  {
    num: "01",
    title: "Connect a repo",
    description: "Link GitHub, GitLab, or Bitbucket and pick the repos you want reviewed.",
  },
  {
    num: "02",
    title: "Push a pull request",
    description: "Cortardo Agent reads the diff and posts a full review — bugs, security, style, and summaries.",
  },
  {
    num: "03",
    title: "Fix and merge",
    description: "Accept inline suggestions with one click, resolve threads, and merge with confidence.",
  },
];

function AppPreview() {
  return (
    <div className="relative mt-16 md:mt-20 rounded-2xl border border-border bg-background shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12)] overflow-hidden pointer-events-none select-none">
          <div className="flex items-center gap-2 px-4 h-11 border-b border-border bg-surface-subtle/60">
            <div className="flex items-center gap-2 px-3 h-6 rounded-md bg-background border border-border text-[11px] text-fg-muted font-medium">
              app.cortardo.com/reviews
            </div>
          </div>

      <div className="flex h-[380px] md:h-[440px]">
        <div className="hidden sm:flex flex-col gap-2 px-2.5 py-3 border-r border-border bg-surface-subtle/40">
          {[GitPullRequest, MessageSquare, Bug, ShieldCheck, Terminal].map((Icon, i) => (
            <span
              key={i}
              className={`flex items-center justify-center w-8 h-8 rounded-lg border ${i === 0 ? "bg-brand/10 border-brand/30 text-brand" : "border-transparent text-fg-muted"}`}
            >
              <Icon size={15} strokeWidth={1.75} />
            </span>
          ))}
        </div>

        <div className="flex-1 min-w-0 relative bg-[radial-gradient(70%_60%_at_50%_0%,hsl(var(--brand)/0.08),transparent_70%)]">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] md:w-[360px] rounded-xl bg-white border border-border shadow-[0_12px_40px_-12px_rgba(0,0,0,0.18)] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-foreground tracking-[-0.01em]">fix: auth token refresh</span>
              <span className="px-1.5 py-0.5 rounded-full bg-brand/10 text-brand text-[10px] font-bold uppercase tracking-wide">PR #128</span>
            </div>
            <div className="space-y-2">
              <div className="h-2.5 w-3/5 rounded-full bg-[linear-gradient(90deg,#284B63,#4A7A96)]" />
              <div className="h-2 w-full rounded-full bg-border/70" />
              <div className="h-2 w-11/12 rounded-full bg-emerald-200/70" />
              <div className="h-2 w-4/5 rounded-full bg-rose-200/70" />
            </div>
            <div className="mt-3 flex gap-2">
              <div className="h-7 w-24 rounded-lg bg-gradient-to-r from-[#284B63] to-[#4A7A96]" />
              <div className="h-7 w-24 rounded-lg border border-border" />
            </div>
          </div>

          <div className="absolute left-4 bottom-3 hidden md:flex items-center gap-1.5 text-[11px] text-fg-muted font-medium">
            <span className="flex -space-x-1">
              <span className="w-5 h-5 rounded-full bg-sky-400 border-2 border-white" />
              <span className="w-5 h-5 rounded-full bg-fuchsia-400 border-2 border-white" />
            </span>
            Ava and 2 others are reviewing
          </div>
          <div className="absolute right-4 bottom-3 flex items-center gap-1.5 text-[11px] text-fg-muted font-medium">
            <Sparkles size={12} className="text-brand" />
            Reviewed by Cortardo Agent
          </div>
        </div>

        <div className="hidden lg:flex flex-col gap-2.5 w-44 p-3 border-l border-border bg-surface-subtle/40">
          <div className="text-[11px] font-semibold text-fg-muted uppercase tracking-[0.08em]">Findings</div>
          {[["Bugs", "2"], ["Security", "1"], ["Style", "4"], ["Coverage", "+0.8%"]].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-[11px] text-fg-muted font-medium">{k}</span>
              <span className="text-[11px] text-foreground font-semibold px-1.5 py-0.5 rounded-md bg-background border border-border">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Product() {
  return (
    <Layout fullWidth logo="/CortardoFull.svg?v=1" logoClassName="h-[20px] sm:h-[26px] md:h-[36px]">
      <div className="landing-grid" />

      {/* ── Hero ── */}
      <LandingHero
        title={
          <>
            Review every line.
            <br />
            Merge with confidence.
          </>
        }
        description="Connect a repo and Cortardo reviews every pull request — bugs, security issues, and style drift flagged line-by-line, with one-click fixes your whole team can build on."
        actions={
          <>
            <Link href="/auth/signup">
              <Button design="pill" size="md" className="h-[46px] px-6 text-[15px]">
                Start reviewing free
              </Button>
            </Link>
            <Link href="/pricing" className="group flex items-center gap-1.5 text-[15px] font-medium text-fg-muted hover:text-foreground transition-colors">
              See pricing
              <ArrowRight size={15} strokeWidth={2} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </>
        }
      />

      {/* ── Product preview ── */}
      <section className="w-full">
        <div className="mx-auto max-w-[1280px] px-6 md:px-10">
          <AppPreview />
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="w-full py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6 md:px-10">
          <div className="text-center">
            <SectionHeader
              centered
              label="How it works"
              title="From pull request to merged."
              subtitle="No waiting on a reviewer's calendar. No merge-day surprises."
            />
          </div>
          <div className="mt-14 md:mt-16 grid md:grid-cols-3 gap-x-12 gap-y-10">
            {steps.map((step) => (
              <div key={step.num} className="border-t border-border pt-6">
                <p className="text-[13px] font-semibold text-[#FF7A6E] tracking-[0.06em]">{step.num}</p>
                <h3 className="mt-3 text-[18px] font-semibold text-foreground tracking-[-0.01em]">{step.title}</h3>
                <p className="mt-2 text-[14px] text-fg-muted leading-[1.65] font-medium">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="w-full py-20 md:py-28 border-t border-border">
        <div className="mx-auto max-w-[1280px] px-6 md:px-10">
          <SectionHeader
            label="Features"
            title="Everything you need to review great code."
            subtitle="The agent catches what humans miss. Your team keeps the final say."
          />
          <div className="mt-14 md:mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {features.map(({ icon: Icon, title, description, variant }) => (
              <SoftCard key={title} className="p-6 h-full flex flex-col gap-3">
                <span className="flex items-center justify-center w-9 h-9 rounded-[10px] bg-white border border-border/70 shrink-0">
                  <Icon
                    size={17}
                    strokeWidth={1.75}
                    className={
                      variant === "brand"
                        ? "text-sky-500"
                        : variant === "amber"
                          ? "text-amber-500"
                          : variant === "purple"
                            ? "text-fuchsia-500"
                            : "text-emerald-500"
                    }
                  />
                </span>
                <h3 className="text-[15px] font-semibold text-foreground tracking-[-0.01em]">{title}</h3>
                <p className="text-[13px] text-fg-muted leading-[1.65] font-medium">{description}</p>
              </SoftCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative w-full border-t border-border overflow-hidden">
        <div className="hero-glow" />
        <div className="relative mx-auto max-w-[1280px] px-6 md:px-10 py-24 md:py-32">
          <div className="max-w-2xl">
            <Eyebrow label="START FREE">No card required</Eyebrow>
            <h2 className="mt-6 text-[34px] sm:text-[44px] md:text-[52px] font-semibold leading-[1.06] tracking-[-0.03em] text-foreground">
              Your next review is one push away.
            </h2>
            <div className="mt-10 flex items-center gap-4">
              <Link href="/auth/signup">
                <Button design="pill" size="md" className="h-[48px] px-7 text-[16px]">
                  Start reviewing free
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
