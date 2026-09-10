import { ChevronLeft, MoreHorizontal } from "lucide-react";

export function CanvasMobileTopBar({
  onBack,
  onOverflow,
}: {
  onBack: () => void;
  onOverflow: () => void;
}) {
  return (
    <div className="shrink-0 h-[48px] flex items-center gap-1 px-1.5 border-b border-surface-hover bg-background">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex items-center justify-center w-9 h-9 rounded-[10px] text-fg-soft hover:bg-surface-hover active:bg-surface-active transition-colors border-none cursor-pointer shrink-0"
      >
        <ChevronLeft size={20} strokeWidth={2} />
      </button>

      <div className="flex-1" />

      <button
        onClick={onOverflow}
        aria-label="More options"
        className="flex items-center justify-center w-9 h-9 rounded-[10px] text-fg-soft hover:bg-surface-hover active:bg-surface-active transition-colors border-none cursor-pointer shrink-0"
      >
        <MoreHorizontal size={20} strokeWidth={2} />
      </button>
    </div>
  );
}
