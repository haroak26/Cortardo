import { ReactNode } from "react";
import { CortardoLogoMark } from "@/components/CortardoLogo";

interface StatusPageProps {
  code?: string;
  icon?: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function StatusPage({ code, icon, title, description, actions }: StatusPageProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="flex items-center justify-center mb-8">
          <CortardoLogoMark />
        </div>
        {code && (
          <p className="text-[120px] font-bold tracking-tight leading-none text-[hsl(220_14%_91%)] select-none">
            {code}
          </p>
        )}
        {icon && !code && (
          <div className="flex items-center justify-center mb-6 text-[hsl(220_14%_91%)]">
            {icon}
          </div>
        )}
        <h1 className="mt-2 text-[20px] font-bold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground font-medium leading-relaxed">
          {description}
        </p>
        {actions && (
          <div className="mt-8 flex flex-col items-center justify-center gap-3">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
