import { editorShimmerStyle, EDITOR_LOAD_MS, CortardoLoadingLogo } from "@/components/EditorLoadingScreen";

export function MobileEditorLoadingScreen({ progress }: { progress?: number }) {
  const determinate = typeof progress === "number";

  return (
    <>
      <style>{editorShimmerStyle}</style>
      <div className="h-dvh bg-background flex flex-col overflow-hidden relative">
        {/* Nav toolbar shell — the same pill UI as the mobile editor, but blank:
            just the background + outline, with skeleton slots instead of options. */}
        <div className="absolute top-[12px] left-[12px] z-30 flex items-center justify-center">
          <div className="flex items-center gap-1 p-1.5 rounded-[14px] bg-background border border-border shadow-lg">
            <div className="h-8 w-24 rounded-[7px] bg-surface-hover animate-pulse" />
            <div className="w-px h-4 bg-border/60 shrink-0" />
            <div className="h-8 w-8 rounded-[7px] bg-surface-hover animate-pulse" />
            <div className="w-px h-4 bg-border/60 shrink-0" />
            <div className="h-8 w-8 rounded-[7px] bg-surface-hover animate-pulse" />
          </div>
        </div>

        {/* Canvas area with the Cortardo symbol + loading bar centered. */}
        <div className="flex-1 min-h-0 flex items-center justify-center bg-surface-hover">
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
                <div className="relative h-full w-full overflow-hidden">
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

        {/* Bottom canvas toolbar shell — same pill UI as the mobile editor, blank. */}
        <div className="absolute bottom-[calc(14px+env(safe-area-inset-bottom))] left-0 right-0 z-20 flex items-center justify-center px-2">
          <div className="flex items-center gap-1 p-1.5 rounded-[14px] bg-background border border-border shadow-lg max-w-[calc(100vw-24px)] overflow-x-auto">
            <div className="h-8 w-8 rounded-[7px] bg-surface-hover animate-pulse shrink-0" />
            <div className="h-8 w-8 rounded-[7px] bg-surface-hover animate-pulse shrink-0" />
            <div className="w-px h-4 bg-border/60 shrink-0" />
            <div className="h-8 w-8 rounded-[7px] bg-surface-hover animate-pulse shrink-0" />
            <div className="w-[36px] h-4 rounded-[4px] bg-surface-hover animate-pulse shrink-0" />
            <div className="h-8 w-8 rounded-[7px] bg-surface-hover animate-pulse shrink-0" />
            <div className="w-px h-4 bg-border/60 shrink-0" />
            <div className="h-8 w-8 rounded-[7px] bg-surface-hover animate-pulse shrink-0" />
            <div className="h-8 w-8 rounded-[7px] bg-surface-hover animate-pulse shrink-0" />
          </div>
        </div>
      </div>
    </>
  );
}
