import React from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ds";

/*
 * Shared marketing section primitives.
 * These are the exact patterns used on the Landing page so that Features,
 * Agent, and other marketing routes render identical section/hero/feature UI.
 */

export function SectionHeader({
  label,
  title,
  subtitle,
  centered = false,
}: {
  label?: string;
  title: string;
  subtitle?: string;
  centered?: boolean;
}) {
  return (
    <div className={`space-y-3 ${centered ? "text-center" : ""}`}>
      {label && (
        <div className={`${centered ? "flex justify-center" : ""}`}>
          <span className="text-[12px] font-semibold text-brand tracking-wide uppercase">
            {label}
          </span>
        </div>
      )}
      <h2
        className="text-[28px] sm:text-[32px] md:text-[40px] text-foreground font-semibold leading-[1.12] tracking-[-0.025em]"
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className="text-[15px] text-fg-muted font-normal leading-[1.65] max-w-[600px]"
          style={centered ? { margin: "0 auto" } : undefined}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

export type FeatureVariant = "brand" | "amber" | "red" | "green" | "purple";const variantColors: Record<FeatureVariant, string> = {
  brand: "text-sky-500",
  amber: "text-amber-500",
  red: "text-rose-500",
  green: "text-emerald-500",
  purple: "text-fuchsia-500",
};

export function FeatureIcon({
  icon: Icon,
  variant,
}: {
  icon: React.ElementType;
  variant: FeatureVariant;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded-lg shrink-0",
        "bg-black/[0.03]",
        variantColors[variant],
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
    </div>
  );
}

export function FeatureCard({
  icon,
  title,
  description,
  variant,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  variant: FeatureVariant;
}) {
  return (
    <div className="flex gap-4">
      <FeatureIcon icon={icon} variant={variant} />
      <div className="space-y-1.5">
        <h3 className="text-[14px] font-semibold text-foreground tracking-[-0.01em]">
          {title}
        </h3>
        <p className="text-[13px] text-fg-muted leading-[1.65] font-medium">
          {description}
        </p>
      </div>
    </div>
  );
}

/*
 * Soft marketing card — borderless muted surface with a generous radius.
 * This is the approved marketing exception to the flat/hairline rule.
 */
export function SoftCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("soft-card", className)}>{children}</div>;
}

/*
 * Compact landing-style hero — centered eyebrow pill, display title,
 * description, and CTA row. Matches the Landing page hero treatment
 * (same centered composition, tight tracking, pill buttons) but tuned
 * smaller for interior marketing pages, with no wave divider.
 */
export function LandingHero({
  eyebrowLabel,
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrowLabel?: string;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="relative w-full overflow-hidden pt-20 md:pt-28 pb-14 md:pb-20">
      <div className="relative px-6 md:px-10">
        <div className="relative mx-auto max-w-4xl text-center">
          {(eyebrowLabel || eyebrow) && (
            <div className="mb-6 md:mb-7 flex justify-center">
              {eyebrowLabel ? <Eyebrow label={eyebrowLabel}>{eyebrow}</Eyebrow> : eyebrow}
            </div>
          )}
          <h1 className="text-[36px] sm:text-[44px] md:text-[52px] text-foreground font-medium leading-[1.06] tracking-[-0.04em] mb-6 text-pretty">
            {title}
          </h1>
          {description && (
            <p className="mx-auto mb-8 max-w-[560px] text-[15.5px] md:text-[16.5px] text-fg-secondary font-normal leading-[1.7] text-pretty">
              {description}
            </p>
          )}
          {actions && (
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
              {actions}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function MarketingHeroSection({
  eyebrowLabel,
  eyebrow,
  title,
  description,
}: {
  eyebrowLabel: string;
  eyebrow: string;
  title: React.ReactNode;
  description: string;
}) {
  return (
    <section className="w-full pt-24 md:pt-28 pb-12 md:pb-16 hero-grain overflow-hidden">
      <div className="lds-marketing-section">
        <div className="max-w-xl">
          <div className="mb-7">
            <Eyebrow label={eyebrowLabel}>{eyebrow}</Eyebrow>
          </div>
          <h1 className="text-[32px] sm:text-[38px] md:text-[44px] text-foreground font-medium leading-[1.1] tracking-[-0.03em] mb-7">
            {title}
          </h1>
          <p className="mb-7 max-w-[540px] text-[15px] text-fg-secondary font-sans font-medium leading-[1.65]">
            {description}
          </p>
        </div>
      </div>
    </section>
  );
}

export function MarketingFeatureSection({
  label,
  title,
  subtitle,
  items,
  columns = 3,
}: {
  label: string;
  title: string;
  subtitle?: string;
  items: {
    icon: React.ElementType;
    title: string;
    description: string;
    variant: FeatureVariant;
  }[];
  columns?: 2 | 3;
}) {
  const gridCols =
    columns === 3
      ? "md:grid-cols-3 gap-x-8 md:gap-x-16 lg:gap-x-24"
      : "md:grid-cols-2 gap-x-8 md:gap-x-16";
  return (
    <section className="w-full py-14 md:py-20">
      <div className="lds-marketing-section">
        <div className="space-y-14">
          <SectionHeader label={label} title={title} subtitle={subtitle} />
          <div className={`grid ${gridCols} gap-y-12`}>
            {items.map(({ icon, title: itemTitle, description, variant }) => (
              <FeatureCard
                key={itemTitle}
                icon={icon}
                title={itemTitle}
                description={description}
                variant={variant}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}