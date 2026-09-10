import { CortardoLogo } from "@/components/CortardoLogo";

interface LoginLoadingScreenProps {
  /** Progress 0–1. When omitted the bar animates in indeterminate mode. */
  progress?: number;
}

const shimmerStyle = `
@keyframes cortardo-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

export function LoginLoadingScreen({ progress }: LoginLoadingScreenProps) {
  const determinate = typeof progress === "number";

  return (
    <>
      <style>{shimmerStyle}</style>
      <div className="h-[100dvh] flex flex-col items-center justify-center bg-background overflow-hidden">
        <div className="flex flex-col items-center gap-5">
          <CortardoLogo size={36} />

          {/* Progress bar */}
          <div className="w-[180px] h-[3px] rounded-full bg-muted overflow-hidden">
            {determinate ? (
              <div
                className="h-full rounded-full bg-foreground/70 transition-all duration-300 ease-out"
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
                    background: "linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.4), transparent)",
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
