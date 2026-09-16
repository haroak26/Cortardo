import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Small outlined squares centered on each corner of a framed surface. */
export function CornerMarkers() {
  const box =
    'pointer-events-none absolute z-10 h-[7px] w-[7px] rounded-[2px] border border-border/70 bg-background';
  return (
    <>
      <span aria-hidden="true" className={`${box} -left-[3.5px] -top-[3.5px]`} />
      <span aria-hidden="true" className={`${box} -right-[3.5px] -top-[3.5px]`} />
      <span aria-hidden="true" className={`${box} -bottom-[3.5px] -left-[3.5px]`} />
      <span aria-hidden="true" className={`${box} -bottom-[3.5px] -right-[3.5px]`} />
    </>
  );
}

/** Square-cornered surface with a light outline and corner markers. */
export function FramedCard({
  className,
  children,
  cornerMarkers = true,
}: {
  className?: string;
  children: ReactNode;
  cornerMarkers?: boolean;
}) {
  return (
    <div className={cn('relative border border-border/70 bg-background', className)}>
      {cornerMarkers && <CornerMarkers />}
      {children}
    </div>
  );
}
