import React, { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  groups?: number[];
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  groups = [3, 3],
  disabled,
  autoFocus,
  placeholder = "000000",
  className,
  inputClassName,
}: OtpInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/\D/g, "").slice(0, length);
      onChange(raw);
      if (raw.length === length) {
        onComplete?.(raw);
      }
    },
    [length, onChange, onComplete],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && value.length === length) {
        onComplete?.(value);
      }
    },
    [value, length, onComplete],
  );

  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const slots: React.ReactNode[] = [];
  let groupOffset = 0;
  for (let g = 0; g < groups.length; g++) {
    for (let s = 0; s < groups[g]; s++) {
      const idx = groupOffset + s;
      slots.push(
        <span
          key={idx}
          className={cn(
            "inline-flex items-center justify-center w-8 h-8 text-[18px] font-semibold leading-none rounded-sm",
            "transition-colors duration-100",
            value[idx]
              ? "text-foreground"
              : "text-[hsl(var(--fg-faint))]",
          )}
        >
          {value[idx] ?? ""}
        </span>,
      );
    }
    groupOffset += groups[g];
    if (g < groups.length - 1) {
      slots.push(
        <span
          key={`sep-${g}`}
          className="inline-flex items-center justify-center w-3 text-[hsl(var(--fg-faint))] select-none"
        >
          /
        </span>,
      );
    }
  }

  return (
    <div
      className={cn("lds-input relative cursor-text", className)}
      onClick={handleContainerClick}
    >
      <div className="flex items-center justify-center gap-0 h-full w-full">
        {slots}
      </div>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        maxLength={length}
        className={cn(
          "absolute inset-0 w-full h-full opacity-0 cursor-text",
          inputClassName,
        )}
        aria-label="One-time code"
      />
    </div>
  );
}
