import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 py-3 animate-pulse", className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-7 rounded-lg" />
      </div>
      <div>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="mt-2 h-3.5 w-20" />
      </div>
    </div>
  );
}

export function ConversationRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3 animate-pulse">
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <Skeleton className="h-4 w-32 rounded mb-0.5" />
          <Skeleton className="h-3 w-8 rounded" />
        </div>
        <Skeleton className="h-3 w-48 rounded mt-1" />
      </div>
    </div>
  );
}

export function ActivityRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 animate-pulse">
      <Skeleton className="mt-0.5 h-6 w-6 rounded-full shrink-0" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-32 rounded mb-1" />
        <Skeleton className="h-3 w-48 rounded" />
      </div>
      <Skeleton className="h-2.5 w-10 rounded shrink-0" />
    </div>
  );
}

export function TicketRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 animate-pulse">
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-32 rounded mb-1" />
        <Skeleton className="h-3 w-48 rounded" />
      </div>
      <Skeleton className="h-3 w-8 rounded shrink-0" />
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-hidden animate-pulse", className)}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="p-5 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

export function QuickNavSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-11 rounded-xl bg-surface-hover animate-pulse" />
      ))}
    </div>
  );
}

export function WorkspaceCardSkeleton() {
  return (
    <div className="overflow-hidden animate-pulse">
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
        <Skeleton className="h-6 w-6 rounded-md" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-24 mb-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border">
        <div className="px-4 py-3.5 text-center">
          <Skeleton className="h-6 w-12 mx-auto mb-1" />
          <Skeleton className="h-3 w-16 mx-auto" />
        </div>
        <div className="px-4 py-3.5 text-center">
          <Skeleton className="h-6 w-12 mx-auto mb-1" />
          <Skeleton className="h-3 w-16 mx-auto" />
        </div>
      </div>
    </div>
  );
}

export function InboxSkeleton() {
  return (
    <div className="flex h-full min-h-0 -mx-6 -my-6 sm:-mx-8 sm:-my-8">
      <div className="flex flex-col border-r border-border/50 bg-[hsl(220_20%_98.5%)] flex-1 max-w-[480px]">
        <div className="border-b border-border/50 px-4 pt-4 pb-3 space-y-3 bg-[hsl(220_20%_98.5%)]">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-7 w-7 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-full rounded-lg" />
          <div className="flex gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-14 rounded-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto divide-y divide-border/30">
          {Array.from({ length: 6 }).map((_, i) => (
            <TicketRowSkeleton key={i} />
          ))}
        </div>
      </div>
      <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-3 bg-white">
        <Skeleton className="h-12 w-12 rounded-2xl" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}
