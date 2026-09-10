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
        "relative inline-flex h-5 w-8 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-border"
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-1"
        )}
      />
    </button>
  );
}

export { TinyToggle }