/**
 * Unified Settings UI — the single source of truth for every settings page.
 *
 * Every settings page in the app composes itself from these primitives:
 *
 *   <SettingsSection title="General">
 *     <SettingsTextRow    label="Name"    description="Shown to teammates" value={name} onChange={setName} />
 *     <SettingsDisplayRow label="Email"   description="Used to sign in" value="a@b.co" />
 *     <SettingsColorRow   label="Accent"  description="Brand colour" value={color}  onChange={setColor} />
 *     <SettingsSwitchRow  label="Active"  description="Enable the feature" checked={on} onCheckedChange={setOn} />
 *     <SettingsLargeTextRow label="Bio"   description="A short intro" value={bio} onChange={setBio} rows={3} />
 *     <SettingsButtonRow  label="Export"  description="Download your data"> <Button>Export</Button> </SettingsButtonRow>
 *     For anything custom, use the generic SettingsRow:
 *     <SettingsRow label="Custom" description="What this does"> <MyControl /> </SettingsRow>
 *   </SettingsSection>
 *
 * Design specs:
 *   Section heading: 15px font-medium, Inter (font-sans), outside the card
 *   Heading-to-card gap: mt-[14px]
 *   Card: rounded-[12px] outline in --surface-hover; 12px inset on all sides
 *   Row height: min-h-11 (44px) for standard rows; large-text rows are auto-height
 *   Row label: 13.5px font-medium text-fg-strong, vertically centred with content
 *   Row subtext: 12px font-[450] text-fg-warm, mt-0.5 below the label
 *   Row padding: 12px (px-[12px] py-[12px])
 *   Row dividers: border-b border-[hsl(var(--surface-hover))]
 */

import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
import { TextInput, Textarea } from "@/components/text-input";
import { ColorPicker } from "@/components/color-picker";
import { TinyToggle } from "@/components/ui/tiny-toggle";
import { Lock } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
   SECTION
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsSection({
  title,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("w-full", className)}>
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-sans text-[15px] font-medium leading-tight text-foreground">
            {title}
          </h2>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <SettingsCard className="mt-[14px]">{children}</SettingsCard>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   CARD — the bare settings card shell, for custom sections that don't want
   the standard heading above them (e.g. cards in a grid).
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsCard({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Inset children by 12px. Set false for edge-to-edge dividers. */
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[12px] border border-[hsl(var(--surface-hover))] divide-y divide-[hsl(var(--surface-hover))]",
        padded && "px-[12px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   GENERIC ROW — the building block for all row types below
   ────────────────────────────────────────────────────────────────────────── */

const rowBase =
  "flex flex-row items-center justify-between gap-3 py-[12px] min-h-11";

export function SettingsRow({
  label,
  description,
  children,
  align = "center",
  stack = false,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  align?: "center" | "start";
  stack?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        rowBase,
        stack && "flex-col sm:flex-row",
        align === "start" && "items-start",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium leading-snug text-fg-strong">
          {label}
        </p>
        {description && (
          <p className="mt-0.5 text-[12px] font-[450] leading-snug text-fg-warm">
            {description}
          </p>
        )}
      </div>
      {children !== undefined && (
        <div
          className={cn(
            "flex items-center gap-2 shrink-0",
            stack && "w-full",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ROW TYPE: Text Input
   Label left, TextInput right. Vertically centred. Fixed row height.
   ────────────────────────────────────────────────────────────────────────── */

const inputClass =
  "min-w-0 flex-1 sm:w-56 sm:flex-none";

export function SettingsTextRow({
  label,
  description,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  readOnly,
  className,
  onKeyDown,
  onBlur,
}: {
  label: string;
  description?: string;
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <TextInput
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(inputClass, className)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    </SettingsRow>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ROW TYPE: Large Text Area
   Label on top, Textarea full-width below. Spans the entire row width.
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsLargeTextRow({
  label,
  description,
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
}: {
  label: string;
  description?: string;
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <div className="py-[12px]">
      <p className="text-[13.5px] font-medium leading-snug text-fg-strong">
        {label}
      </p>
      {description && (
        <p className="mt-0.5 text-[12px] font-[450] leading-snug text-fg-warm">
          {description}
        </p>
      )}
      <Textarea
        className="mt-2"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ROW TYPE: Display (read-only text / badge)
   Label left, unchangeable text on right. Good for email, type, status.
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsDisplayRow({
  label,
  description,
  value,
  mono,
  children,
}: {
  label: string;
  description?: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <SettingsRow label={label} description={description}>
      {children ?? (
        <span
          className={cn(
            "text-[13px] text-muted-foreground",
            mono && "font-mono",
          )}
        >
          {value}
        </span>
      )}
    </SettingsRow>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ROW TYPE: Colour Picker
   Label left, ColorPicker on the right. For accent colours, branding, etc.
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsColorRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <ColorPicker value={value} onChange={onChange} />
    </SettingsRow>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ROW TYPE: Toggle Switch
   Label left, Switch component on right.
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsSwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <TinyToggle
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </SettingsRow>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ROW TYPE: Button
   Label left, button(s) on the right. Pass children for button(s).
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsButtonRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <div className="flex items-center gap-2">{children}</div>
    </SettingsRow>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   DIVIDER
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsDivider() {
  return <div className="h-px w-full bg-[hsl(var(--surface-hover))]" />;
}

/* ──────────────────────────────────────────────────────────────────────────
   PLAN LOCK BADGE — small yellow lock icon shown when a row is gated by plan
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsLock({
  plan,
  currentPlan = "starter",
  size = 13,
}: {
  plan: string;
  currentPlan?: string;
  size?: number;
}) {
  const planOrder: Record<string, number> = {
    free: 0,
    starter: 1,
    pro: 2,
    max: 3,
  };

  const required = planOrder[plan] ?? 0;
  const current = planOrder[currentPlan] ?? 0;

  if (current >= required) return null;

  return (
    <Lock
      size={size}
      className="text-amber shrink-0"
      strokeWidth={1.5}
      aria-label={`Requires ${plan} plan`}
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   BUTTON HELPERS
   ────────────────────────────────────────────────────────────────────────── */

export function SaveButton({
  onSave,
  onCancel,
  isSaving,
  hasChanges = true,
  saveLabel = "Save",
  className,
}: {
  onSave: () => void;
  onCancel?: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
  saveLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-end gap-2 pt-4", className)}>
      {onCancel && (
        <Button design="ghost" size="xs" className="px-3" onClick={onCancel}>
          Cancel
        </Button>
      )}
      <Button design="primary" size="xs" className="px-3" onClick={onSave} disabled={!hasChanges || isSaving} isLoading={isSaving}>
        {isSaving ? null : saveLabel}
      </Button>
    </div>
  );
}

export function GhostButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button design="ghost" size="xs" type="button" className={className} {...props}>
      {children}
    </Button>
  );
}

export const settingsInputClass =
  "h-10 w-full rounded-xl border border-[hsl(var(--border))] bg-background px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-fg-faint focus:border-brand focus:ring-1 focus:ring-brand/20";

export function SettingsInput(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
) {
  return <TextInput {...props} className={cn("min-w-0", props.className)} />;
}

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl px-1 pt-1", className)}>
      {children}
    </div>
  );
}
