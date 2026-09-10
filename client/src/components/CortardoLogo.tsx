import { cn } from "@/lib/utils";
import {
  CortardoLogoCSS,
  CortardoLogoCSSMark,
  CortardoLogoCSSDark,
  CortardoLogoCSSMarkDark,
} from "@/components/CortardoLogoCSS";

export { CortardoLogoCSS, CortardoLogoCSSMark, CortardoLogoCSSDark, CortardoLogoCSSMarkDark };

interface CortardoLogoProps {
  size?: number;
  className?: string;
}

export function CortardoLogo({ size = 20, className }: CortardoLogoProps) {
  return <CortardoLogoCSS size={size} className={className} />;
}

interface CortardoLogoMarkProps {
  className?: string;
  variant?: "default" | "white" | "inverted";
  size?: number;
}

export function CortardoLogoMark({ className, variant = "default", size }: CortardoLogoMarkProps) {
  return <CortardoLogoCSSMark className={className} variant={variant} size={size} />;
}

export function CortardoLogoDark({ size = 20, className }: { size?: number; className?: string }) {
  return <CortardoLogoCSS size={size} className={className} />;
}

export function CortardoLogoMarkDark({ className, size }: { className?: string; size?: number }) {
  return <CortardoLogoCSSMarkDark className={className} size={size} />;
}
