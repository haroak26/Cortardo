import React from "react";
import { cn } from "@/lib/utils";

export interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  variant?: "default" | "ghost";
  size?: "xs" | "sm" | "md";
  error?: boolean;
  suffix?: string;
}

const wrapperSize: Record<string, string> = {
  md: "max-md:h-[40px] h-[36px] px-3 py-1.5 text-base md:text-sm rounded-[10px]",
  sm: "max-md:h-[36px] h-[32px] px-2.5 py-1.5 text-[13px] rounded-[10px]",
  xs: "max-md:h-[32px] h-[28px] px-2 py-1 text-[12px] rounded-[10px]",
};

const wrapperBase =
  "w-full min-w-0 flex items-center gap-1.5 outline-none";

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ className, variant = "default", size = "md", type = "text", error, suffix, disabled, ...props }, ref) => {
    return (
      <div
        className={cn(
          wrapperBase,
          wrapperSize[size],
          disabled && "pointer-events-none cursor-not-allowed opacity-50",
          variant === "default" &&
            (error
              ? "bg-[hsl(0_72%_51%_/_0.08)]"
              : "bg-surface-hover"),
          variant === "ghost" && "bg-transparent",
          className,
        )}
      >
        <input
          ref={ref}
          type={type}
          disabled={disabled}
          className="flex-1 min-w-0 bg-transparent outline-none text-foreground placeholder:text-fg-faint disabled:cursor-not-allowed p-0 leading-[1.4] file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground"
          {...props}
        />
        {suffix && (
          <span className="shrink-0 text-fg-muted text-[13px] whitespace-nowrap">{suffix}</span>
        )}
      </div>
    );
  },
);
TextInput.displayName = "TextInput";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "ghost";
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = "default", error, disabled, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        disabled={disabled}
        className={cn(
          "w-full rounded-[10px] outline-none placeholder:text-fg-faint transition-colors duration-150 ease-out resize-y",
          "min-h-[80px] py-2.5 px-3.5 text-[14px] leading-relaxed",
          disabled && "opacity-50 cursor-not-allowed",
          variant === "default"
            ? error
              ? "bg-[hsl(0_72%_51%_/_0.08)]"
              : "bg-surface-hover"
            : "bg-transparent",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
