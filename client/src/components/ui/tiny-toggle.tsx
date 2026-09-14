import * as React from "react"
import { cn } from "@/lib/utils"

function TinyToggle({
  checked,
  onCheckedChange,
  disabled,
  title,
  ...props
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative inline-flex h-[16px] w-[28px] shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-toggle-on" : "bg-border"
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-block h-[12px] w-[12px] shrink-0 transform rounded-full bg-white transition-transform duration-150",
          checked ? "translate-x-[12px]" : "translate-x-0"
        )}
      />
    </button>
  );
}

export { TinyToggle }
