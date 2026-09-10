// How long the editor loading screen is shown. Must stay in sync with the
// minimum-load timer in CanvasPage so the bar reaches 100% exactly as the
// screen unmounts.
export const EDITOR_LOAD_MS = 5000;

import { useState } from "react";

// The Cortardo mark on the loading screens. The source is a raster-embedded
// SVG, so we only fade it in once the browser has fully decoded it (avoids
// showing it half-rendered), and tint it grey instead of black.
export function CortardoLoadingLogo({ size = 28 }: { size?: number }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <img
      src="/CortardoSymbol.svg"
      alt="Cortardo"
      width={size}
      height={size}
      onLoad={() => setLoaded(true)}
      className="w-auto shrink-0"
      style={{
        height: size,
        opacity: loaded ? 1 : 0,
        transition: "opacity 300ms ease",
        filter: "grayscale(1) invert(0.46)",
      }}
    />
  );
}

export const editorShimmerStyle = `
@keyframes editor-load-fill {
  from { width: 0%; }
  to { width: 100%; }
}
@keyframes editor-shimmer-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

export function EditorLoadingScreen({ progress }: { progress?: number }) {
  const determinate = typeof progress === "number";

  return (
    <>
      <style>{editorShimmerStyle}</style>
      <div className="h-dvh bg-background flex flex-col overflow-hidden">
        {/* Unified header row — bare */}
        <div className="shrink-0 h-[51px] flex items-center border-b border-surface-hover bg-background px-3 gap-3">
          <div className="w-[64px] shrink-0" />
          <div className="flex-1" />
        </div>

        {/* Body columns */}
        <div className="flex-1 min-h-0 flex">
          {/* Icon sidebar — bare edge only */}
          <div className="w-[64px] shrink-0 flex flex-col bg-background relative z-10">
            <div className="flex-1 w-full border-r border-surface-hover" />
          </div>

          {/* Content panel */}
          <div className="shrink-0 flex flex-col bg-background w-[280px]">
            <div className="flex-1 overflow-hidden px-1.5 py-1 space-y-1" />
          </div>

          {/* Canvas area */}
          <div className="flex-1 flex flex-col">
            <div className="flex-1 flex items-center justify-center bg-surface-hover">
              <div className="flex flex-col items-center gap-5">
                <CortardoLoadingLogo />

                {/* Loading bar */}
                <div className="w-[160px] h-[3px] rounded-full bg-border overflow-hidden">
                  {determinate ? (
                    <div
                      className="h-full w-0 rounded-full bg-foreground/60"
                      style={{ animation: `editor-load-fill ${EDITOR_LOAD_MS}ms linear forwards` }}
                    />
                  ) : (
                    <div
                      className="relative h-full w-full overflow-hidden"
                    >
                      <div
                        className="absolute inset-y-0 w-full"
                        style={{
                          animation: "editor-shimmer-slide 1.4s ease-in-out infinite",
                          background: "linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.35), transparent)",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
