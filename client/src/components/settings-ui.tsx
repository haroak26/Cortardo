/**
 * Unified Settings UI — the single source of truth for every settings page.
 *
 * Every settings page in the app composes itself from these primitives:
 *
 *   <SettingsSection title="General" description="Basic info">
 *     <SettingsTextRow    label="Name"    value={name}   onChange={setName} />
 *     <SettingsDisplayRow label="Email"   value="a@b.co" />
 *     <SettingsColorRow   label="Accent"  value={color}  onChange={setColor} />
 *     <SettingsSwitchRow  label="Active"  checked={on}   onCheckedChange={setOn} />
 *     <SettingsLargeTextRow label="Bio"   value={bio}    onChange={setBio} rows={3} />
 *     <SettingsButtonRow  label="Export"> <Button>Export</Button> </SettingsButtonRow>
 *     For anything custom, use the generic SettingsRow:
 *     <SettingsRow label="Custom"> <MyControl /> </SettingsRow>
 *   </SettingsSection>
 *
 * Design specs:
 *   Section heading: 17px font-semibold
 *   Section subtext: 13px text-muted-foreground, tight mt-1 below heading
 *   Subtext-to-rows gap: mt-1.5 (6px)
 *   Row height: min-h-11 (44px) for standard rows; large-text rows are auto-height
 *   Row label: 13.5px font-medium, vertically centred with content
 *   Row padding: py-3 (12px top+bottom)
 *   Row dividers: border-b border-[hsl(var(--surface-hover))]
 */

import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
import { TextInput, Textarea } from "@/components/text-input";
import { ColorPicker } from "@/components/color-picker";
import { Switch } from "@/components/ui/switch";
import { Lock } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
   SECTION
   ────────────────────────────────────────────────────────────────────────── */

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("w-full", className)}>
      <header className="flex items-end justify-between gap-3 pb-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight text-foreground tracking-wide font-sans">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="mt-1.5 divide-y divide-[hsl(var(--surface-hover))]">{children}</div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   GENERIC ROW — the building block for all row types below
   ────────────────────────────────────────────────────────────────────────── */

const rowBase =
  "flex flex-row items-center justify-between gap-3 py-3 min-h-11";

export function SettingsRow({
  label,
  children,
  align = "center",
  stack = false,
  className,
}: {
  label: React.ReactNode;
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
        <p className="text-[13.5px] font-medium leading-snug text-foreground">
          {label}
        </p>
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
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  readOnly,
  className,
  onKeyDown,
}: {
  label: string;
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <SettingsRow label={label}>
      <TextInput
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(inputClass, className)}
        onKeyDown={onKeyDown}
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
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
}: {
  label: string;
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <div className="py-3">
      <p className="text-[13.5px] font-medium leading-snug text-foreground mb-2">
        {label}
      </p>
      <Textarea
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
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <SettingsRow label={label}>
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
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <SettingsRow label={label}>
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
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SettingsRow label={label}>
      <Switch
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <SettingsRow label={label}>
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
