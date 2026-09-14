import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CornerMarkers } from "@/components/framed-card";

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex flex-col border border-border/70 bg-background p-4 animate-pulse", className)}>
      <CornerMarkers />
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-4 rounded-sm" />
      </div>
      <Skeleton className="mt-3 h-8 w-16" />
      <div className="mt-auto pt-3">
        <Skeleton className="h-3.5 w-24" />
      </div>
    </div>
  );
}

export function TileCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col rounded-2xl border border-border bg-background p-4 animate-pulse", className)}>
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-[10px] bg-surface-hover" />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <div className="h-3.5 w-32 rounded bg-surface-hover" />
          <div className="h-3 w-44 rounded bg-surface-hover" />
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <div className="h-3 w-24 rounded bg-surface-hover" />
        <div className="h-5 w-9 rounded-full bg-surface-hover" />
      </div>
    </div>
  );
}

export function SettingsCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-[12px] border border-[hsl(var(--surface-hover))] px-[12px] animate-pulse", className)}>
      <div className="py-[12px]">
        <div className="h-[140px] w-full rounded-[8px] bg-surface-hover" />
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-[hsl(var(--surface-hover))] py-[12px]">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="h-3.5 w-32 rounded bg-surface-hover" />
          <div className="h-3 w-40 rounded bg-surface-hover" />
        </div>
        <div className="h-4 w-7 shrink-0 rounded-full bg-surface-hover" />
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
