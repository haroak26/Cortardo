/*
 * AnimatedLogo — the full Cortardo wordmark.
 *
 * The source logo (CortardoFull.svg) is a raster embed. A previous
 * colour-cycling experiment overlaid a white silhouette mask on the symbol;
 * that concept was scrapped, so the base logo is now rendered as-is.
 */

export function AnimatedLogo({ className }: { className?: string }) {
  return (
    <img
      src="/CortardoFull.svg?v=1"
      alt="Cortardo"
      className={`inline-block leading-none h-full w-auto shrink-0 ${className ?? ""}`}
    />
  );
}
