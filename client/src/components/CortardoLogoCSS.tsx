import { cn } from "@/lib/utils";

type LogoVariant = "default" | "white" | "inverted";

export function CortardoLogoCSS({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
  variant?: LogoVariant;
}) {
  return (
    <img
      src="/CortardoFull.svg"
      alt="Cortardo"
      className={cn("w-auto shrink-0", className)}
      style={{ height: size }}
    />
  );
}

export function CortardoLogoCSSMark({
  className,
  size,
}: {
  className?: string;
  variant?: LogoVariant;
  size?: number;
}) {
  const h = size ?? 20;
  return (
    <div className={cn("inline-flex items-center", className)}>
      <img
        src="/CortardoSymbol.svg"
        alt="Cortardo"
        className="shrink-0"
        style={{ width: h, height: h }}
      />
    </div>
  );
}

export function CortardoLogoCSSDark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return <CortardoLogoCSS size={size} className={className} />;
}

export function CortardoLogoCSSMarkDark({
  className,
  size,
}: {
  className?: string;
  size?: number;
}) {
  return <CortardoLogoCSSMark className={className} size={size} />;
}
