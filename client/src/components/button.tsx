import React from "react";
import { Loader, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

export type ButtonDesign = "primary" | "secondary" | "outline" | "ghost" | "destructive" | "pill" | "pill-secondary" | "pill-ghost";
export type IconButtonDesign = "outline" | "ghost" | "secondary" | "brand";
export type ButtonSize = "xs" | "sm" | "md";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  design?: ButtonDesign;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: LucideIcon;
  href?: string;
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  design?: IconButtonDesign;
  size?: ButtonSize;
  badge?: number;
}

/* ─── Shared base ─── */

const base =
  "inline-flex items-center justify-center font-medium leading-none shrink-0 whitespace-nowrap min-w-fit " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 " +
  "disabled:cursor-not-allowed disabled:pointer-events-none select-none";

/* ─── Main button ─── */

const mainSize: Record<ButtonSize, string> = {
  xs: "max-md:h-[32px] h-[28px] px-[10px] text-[12px] rounded-[10px] gap-[4px] [&>svg]:h-[12px] [&>svg]:w-[12px] [&>svg]:shrink-0",
  sm: "max-md:h-[36px] h-[32px] px-[12px] text-[14px] rounded-[10px] gap-[6px] [&>svg]:h-[14px] [&>svg]:w-[14px] [&>svg]:shrink-0 text-center",
  md: "max-md:h-[40px] h-[36px] px-[16px] text-[14px] rounded-[10px] gap-[8px] [&>svg]:h-[16px] [&>svg]:w-[16px] [&>svg]:shrink-0 text-center",
};

const mainDesign: Record<ButtonDesign, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
  secondary:
    "bg-surface-hover text-foreground hover:bg-surface-hover/80 active:bg-surface-active/80",
  outline:
    "bg-transparent border border-border text-foreground hover:bg-surface-hover active:bg-surface-hover/80",
  ghost:
    "bg-transparent text-foreground hover:bg-surface-active active:bg-surface-active/80",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90",
  pill:
    "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 rounded-full",
  "pill-secondary":
    "bg-surface-hover text-foreground hover:bg-surface-hover/80 active:bg-surface-active/80 rounded-full",
  "pill-ghost":
    "bg-transparent text-foreground hover:bg-surface-active active:bg-surface-active/80 rounded-full",
};

const loaderSize: Record<ButtonSize, string> = {
  xs: "h-[12px] w-[12px]",
  sm: "h-[14px] w-[14px]",
  md: "h-[16px] w-[16px]",
};

/* ─── Icon button ─── */

const iconSize: Record<ButtonSize, string> = {
  xs: "max-md:h-[32px] max-md:w-[32px] h-[28px] w-[28px] rounded-[10px] [&>svg]:h-[12px] [&>svg]:w-[12px] [&>svg]:shrink-0",
  sm: "max-md:h-[36px] max-md:w-[36px] h-[32px] w-[32px] rounded-[10px] [&>svg]:h-[14px] [&>svg]:w-[14px] [&>svg]:shrink-0",
  md: "max-md:h-[40px] max-md:w-[40px] h-[36px] w-[36px] rounded-[10px] [&>svg]:h-[16px] [&>svg]:w-[16px] [&>svg]:shrink-0",
};

/** Brand-filled icon button surface, shared by `IconButton design="brand"`. */
export const brandIconButtonClass =
  "relative inline-flex h-[36px] w-[36px] max-md:h-[40px] max-md:w-[40px] shrink-0 cursor-pointer items-center justify-center rounded-[10px] border-none px-0 " +
  "bg-brand text-brand-foreground " +
  "transition-[background-color,transform] duration-150 ease-out " +
  "hover:bg-[hsl(var(--brand-hover))] active:scale-[0.97] active:bg-[hsl(var(--brand-hover))] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-50";

const iconDesign: Record<IconButtonDesign, string> = {
  outline:
    "bg-transparent border border-border text-fg-muted hover:bg-surface-hover hover:text-foreground",
  ghost:
    "bg-transparent text-fg-muted hover:bg-surface-hover hover:text-foreground",
  secondary:
    "bg-surface-hover text-foreground hover:bg-surface-active active:bg-surface-active/80",
  brand: brandIconButtonClass,
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, design = "primary", size = "sm", isLoading, disabled, icon: Icon, children, href, ...props }, ref) => {
    const classes = cn(base, mainSize[size], mainDesign[design], className);

    if (href) {
      return (
        <a href={href} className={classes}>
          {isLoading ? (
            <Loader className={cn("animate-spin shrink-0 origin-center", loaderSize[size])} aria-hidden="true" />
          ) : (
            <>
              {Icon && <Icon className="shrink-0" />}
              {children}
            </>
          )}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={classes}
        {...props}
      >
        {isLoading ? (
          <Loader className={cn("animate-spin shrink-0 origin-center", loaderSize[size])} aria-hidden="true" />
        ) : (
          <>
            {Icon && <Icon className="shrink-0" />}
            {children}
          </>
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export function IconButton({
  icon: Icon,
  design = "outline",
  size = "sm",
  badge,
  className,
  children,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, iconSize[size], iconDesign[design], "relative", className)}
      {...props}
    >
      {children ?? (Icon ? <Icon className="shrink-0" /> : null)}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
