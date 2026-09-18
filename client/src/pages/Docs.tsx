import { useState } from "react";
import { Layout } from "@/components/Layout";
import { ChevronDown, Link as LinkIcon } from "lucide-react";
import { LandingHero } from "@/components/marketing";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold text-foreground tracking-tight" id={title.toLowerCase().replace(/\s+/g, "-")}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-5 text-left bg-none border-none cursor-pointer group"
      >
        <span className="text-[15px] font-semibold text-[#1e1e1e] tracking-[-0.01em]">{title}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 ml-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-all duration-200 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="pb-5 text-[13px] text-muted-foreground leading-[1.7] space-y-3">{children}</div>
        </div>
      </div>
      <div className="border-b border-border" />
    </div>
  );
}

function Step({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-brand/10 text-brand text-[12px] font-bold">{num}</span>
      <div className="text-[13px] text-muted-foreground leading-[1.7] flex-1 pt-0.5">{children}</div>
    </div>
  );
}

export default function Docs() {
  return (
    <Layout fullWidth>
      <LandingHero
        eyebrowLabel="Docs"
        eyebrow="Documentation"
        title="Documentation"
        description="Everything you need to know about setting up and using Cortardo — from connecting your first repository to reviewing with the Cortardo agent."
      />

      <div className="max-w-3xl mx-auto px-8 py-16 md:py-24 space-y-16">

        {/* ── Getting Started ── */}
        <Section title="Getting started">
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            Cortardo is a code review tool built for the next generation of startups — connect a repository and the Cortardo agent reviews every pull request, line by line.
            Every feature is organised around <strong className="text-foreground">workspaces</strong> — each workspace contains its own repos, reviews, and team rules.
          </p>
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            After signing up, create your workspace and connect your first repository. From there the agent reviews each pull request automatically — flagging bugs, security issues, and style drift with inline fixes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <a href="#projects" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand hover:gap-3 transition-all">
              <LinkIcon className="h-3.5 w-3.5" /> Connect a repository
            </a>
            <a href="#agent" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand hover:gap-3 transition-all">
              <LinkIcon className="h-3.5 w-3.5" /> Meet the agent
            </a>
          </div>
        </Section>

        {/* ── Repositories ── */}
        <Section title="Repositories">
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            Repositories are the core of Cortardo. Each repo you connect is reviewed automatically — every pull request gets findings, summaries, and inline suggestions.
          </p>

          <Collapsible title="Connecting a repository">
            <Step num="1">Sign in and go to <strong className="text-foreground">Home</strong>.</Step>
            <Step num="2">Open the <strong className="text-foreground">Repositories</strong> page to explore the codebase map and activity.</Step>
            <Step num="3">Choose a model and reasoning effort (optional).</Step>
            <Step num="4">Track review progress from the dashboard.</Step>
          </Collapsible>

          <Collapsible title="Organising repositories">
            <p>All repos live in your workspace and can be renamed, recoloured, or archived at any time from the projects page. Archived repos stay searchable but don't clutter the main list.</p>
          </Collapsible>
        </Section>

        {/* ── The Cortardo Agent ── */}
        <Section title="The Cortardo Agent">
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            The Cortardo agent is a code review agent that reads every diff and leaves line-by-line feedback. Each review streams the agent's reasoning, a short plan, and a summary of what changed.
          </p>

          <Collapsible title="How a review runs">
            <Step num="1">A teammate opens a pull request on a connected repo.</Step>
            <Step num="2">The agent reads the diff and drafts a review plan.</Step>
            <Step num="3">Findings land as inline comments — bugs, security, and style, with one-click fixes.</Step>
            <Step num="4">Summaries and review states appear in the sidebar panels.</Step>
          </Collapsible>

          <Collapsible title="Reasoning effort">
            <p>Choose the reasoning effort per review: <strong className="text-foreground">Medium</strong> for everyday work, <strong className="text-foreground">High</strong> and <strong className="text-foreground">Extra High</strong> for complex changes, and <strong className="text-foreground">Max</strong> for the deepest analysis. Higher settings give the model a larger thinking budget.</p>
          </Collapsible>

          <Collapsible title="Chats">
            <p>Each repo keeps a chat history. Your first review is titled "Initial Review"; later runs get short generated titles. Switch between chats, revisit past reviews, or start a new chat at any time — in-progress reviews are saved automatically.</p>
          </Collapsible>

          <Collapsible title="Model selection">
            <p>Runs are powered by models served through the Merge Gateway. Override the default with the <code className="text-[12px] bg-surface-hover px-1.5 py-0.5 rounded">CORTARDO_BOT_MODEL</code> environment variable.</p>
          </Collapsible>
        </Section>

        {/* ── Workspaces ── */}
        <Section title="Workspaces">
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            Workspaces organise your team's repos and review rules in one place. Invite your teammates to collaborate, manage members and roles from workspace settings.
          </p>
        </Section>

        {/* ── Authentication and Security ── */}
        <Section title="Authentication and Security">
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            Cortardo supports email/password login, Google sign-in, and two-factor authentication via TOTP (Time-based One-Time Passwords).
          </p>

          <Collapsible title="Setting up two-factor authentication">
            <Step num="1">Go to <strong className="text-foreground">Account → Security</strong> and click <strong className="text-foreground">Set up two-factor authentication</strong>.</Step>
            <Step num="2">Cortardo generates a secret key and displays a QR code. Scan the QR code with your authenticator app (e.g. Google Authenticator, 1Password, Authy).</Step>
            <Step num="3">Enter the 6-digit code from your authenticator app to verify the setup.</Step>
            <Step num="4">2FA is now enabled. On your next login, you'll be prompted for an authenticator code after entering your password.</Step>
            <Step num="5">To disable 2FA, go to the same section and enter your password to confirm.</Step>
          </Collapsible>

          <Collapsible title="Login with 2FA">
            <p>When 2FA is enabled, the login flow changes:</p>
            <Step num="1">Enter your email/username and password as usual.</Step>
            <Step num="2">Cortardo detects that 2FA is enabled and returns a challenge.</Step>
            <Step num="3">Enter the 6-digit code from your authenticator app.</Step>
            <Step num="4">The code is verified against your stored TOTP secret with a ±30 second window to account for clock drift.</Step>
            <Step num="5">On successful verification, you're logged in.</Step>
          </Collapsible>

          <Collapsible title="Password reset">
            <p>If you forget your password, click <strong className="text-foreground">Forgot password</strong> on the login page. Enter your email address and Cortardo will send a password reset link. The link expires after 1 hour.</p>
          </Collapsible>
        </Section>

        {/* ── Plans and Billing ── */}
        <Section title="Plans and Billing">
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            Cortardo offers three plan tiers: Free, Pro, and Max. Billing is handled through Stripe and subscriptions renew automatically.
          </p>

          <Collapsible title="Plan features">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Feature</th>
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Free</th>
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Pro</th>
                    <th className="text-left py-2 font-semibold text-foreground">Max</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/60"><td className="py-2 pr-4">Projects</td><td className="py-2 pr-4">1</td><td className="py-2 pr-4">10</td><td className="py-2">Unlimited</td></tr>
                  <tr className="border-b border-border/60"><td className="py-2 pr-4">Agent runs / month</td><td className="py-2 pr-4">10</td><td className="py-2 pr-4">500</td><td className="py-2">Unlimited</td></tr>
                  <tr className="border-b border-border/60"><td className="py-2 pr-4">AI credits</td><td className="py-2 pr-4">—</td><td className="py-2 pr-4">Monthly allowance</td><td className="py-2">Monthly allowance</td></tr>
                  <tr className="border-b border-border/60"><td className="py-2 pr-4">Screens per project</td><td className="py-2 pr-4">Unlimited</td><td className="py-2 pr-4">Unlimited</td><td className="py-2">Unlimited</td></tr>
                  <tr className="border-b border-border/60"><td className="py-2 pr-4">Team members</td><td className="py-2 pr-4">1</td><td className="py-2 pr-4">5</td><td className="py-2">Unlimited</td></tr>
                  <tr><td className="py-2 pr-4">Price</td><td className="py-2 pr-4 font-semibold text-foreground">$0</td><td className="py-2 pr-4 font-semibold text-foreground">$29/mo</td><td className="py-2 font-semibold text-foreground">$99/mo</td></tr>
                </tbody>
              </table>
            </div>
          </Collapsible>

          <Collapsible title="Upgrading or downgrading">
            <p>You can change your plan at any time from the billing page in account settings. If you have an existing Stripe subscription, changes are handled through the Stripe billing portal and take effect immediately with prorated adjustments.</p>
          </Collapsible>

          <Collapsible title="Cancellation">
            <p>You can cancel your subscription from the billing page. By default, the subscription cancels at the end of the current billing period. You can continue using paid features until the period ends.</p>
          </Collapsible>
        </Section>

        {/* ── Integrations ── */}
        <Section title="Integrations">
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            Cortardo connects with your existing tools through Stripe for billing and subscription management.
          </p>

          <Collapsible title="Stripe">
            <p>Billing and subscription management is handled through Stripe. When you upgrade to a paid plan, Cortardo creates a Stripe Checkout session. Returning customers use the Stripe Customer Portal for plan changes and payment management.</p>
          </Collapsible>
        </Section>

        {/* ── Security and Compliance ── */}
        <Section title="Security and Compliance">
          <p className="text-[13px] text-muted-foreground leading-[1.7]">
            Cortardo takes security seriously. All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We are SOC 2 aligned and GDPR compliant.
          </p>
          <Collapsible title="Data retention">
            <p>Account data is retained while your account is active. Analytics data is retained for 24 months. Billing records are kept for 7 years as required by tax law. When you delete your account, all associated data is removed except where legal obligations require continued retention.</p>
          </Collapsible>
          <Collapsible title="GDPR and CCPA">
            <p>Cortardo provides tools to exercise your data rights directly from your account: you can export your data, update your profile, and delete your account. For additional requests, email privacy@cortardo.com.</p>
          </Collapsible>
        </Section>
      </div>
    </Layout>
  );
}
