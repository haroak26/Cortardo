import { Skeleton } from "@/components/ui/skeleton";

/**
 * Full-screen skeleton of the app chrome (sidebar + header + content)
 * shown only on the rare cold-cache load. Matches AppLayout's geometry
 * so the real UI swaps in without layout shift.
 */
export function AppShellSkeleton() {
  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden" aria-busy="true" aria-label="Loading">
      {/* Sidebar */}
      <aside className="hidden md:flex w-[216px] shrink-0 flex-col border-r border-[hsl(var(--surface-hover))] px-3 py-4 gap-5">
        <div className="flex items-center gap-2 px-1">
          <Skeleton className="h-6 w-6 rounded-[7px]" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-7 w-full rounded-[8px]" />
          <Skeleton className="h-7 w-[86%] rounded-[8px]" />
          <Skeleton className="h-7 w-[92%] rounded-[8px]" />
        </div>
        <div className="space-y-2 pt-3">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-7 w-full rounded-[8px]" />
          <Skeleton className="h-7 w-[80%] rounded-[8px]" />
          <Skeleton className="h-7 w-[88%] rounded-[8px]" />
        </div>
        <div className="mt-auto flex items-center gap-2 px-1">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 shrink-0 flex items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-7 w-7 rounded-full" />
          </div>
        </header>
        <main className="flex-1 px-4 sm:px-6 md:px-8 py-6 space-y-6 overflow-hidden">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col items-center gap-3 pt-4 sm:pt-16">
              <Skeleton className="h-6 w-56 sm:w-72" />
              <Skeleton className="h-24 w-full max-w-2xl rounded-[14px]" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-20" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                <Skeleton className="h-[120px] w-full rounded-[12px]" />
                <Skeleton className="h-[120px] w-full rounded-[12px]" />
                <Skeleton className="h-[120px] w-full rounded-[12px] hidden sm:block" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default AppShellSkeleton;
