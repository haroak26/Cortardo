import { CortardoLogo } from "@/components/CortardoLogo";

interface ProjectLoadingScreenProps {
  /** Progress 0–1. When omitted the bar animates in indeterminate mode. */
  progress?: number;
}

const shimmerStyle = `
@keyframes cortardo-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

export function ProjectLoadingScreen({ progress }: ProjectLoadingScreenProps) {
  const determinate = typeof progress === "number";

  return (
    <>
      <style>{shimmerStyle}</style>
      <div className="flex-1 flex items-center justify-center bg-[hsl(var(--surface-hover))] h-full">
        <div className="flex flex-col items-center gap-4">
          <CortardoLogo size={32} />
          <p className="text-[12px] font-medium text-fg-muted">Loading project…</p>

          {/* Progress bar */}
          <div className="w-[140px] h-[2px] rounded-full bg-border overflow-hidden">
            {determinate ? (
              <div
                className="h-full rounded-full bg-foreground/60 transition-all duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(4, progress * 100))}%` }}
              />
            ) : (
              <div
                className="h-full w-full relative"
                style={{ animation: "cortardo-shimmer 1.4s ease-in-out infinite" }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.3), transparent)",
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
