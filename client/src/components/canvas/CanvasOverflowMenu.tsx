import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { GitFork, Check, Sparkles } from "lucide-react";

export function CanvasOverflowMenu({
  open,
  onOpenChange,
  branches,
  currentBranch,
  onBranchChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branches: string[];
  currentBranch: string;
  onBranchChange: (b: string) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent className="max-h-[80vh]">
        <div className="px-4 pt-1 pb-2">
          <DrawerTitle className="text-[13px] font-semibold text-fg-soft">Switch branch</DrawerTitle>
        </div>

        <div className="px-2 pb-2">
          <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
            Branch
          </div>
          {branches.map((b) => (
            <button
              key={b}
              onClick={() => {
                onBranchChange(b);
                onOpenChange(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-2.5 rounded-[10px] text-[13.5px] font-medium text-left transition-colors border-none bg-transparent cursor-pointer text-foreground hover:bg-surface-hover"
            >
              <GitFork size={16} strokeWidth={1.75} className="text-fg-muted shrink-0" />
              <span className="flex-1">{b}</span>
              {b === currentBranch && <Check size={15} strokeWidth={2.5} className="text-brand shrink-0" />}
            </button>
          ))}
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </DrawerContent>
    </Drawer>
  );
}

export function CanvasUpgradeSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent className="max-h-[80vh]">
        <div className="px-5 pt-1 pb-5 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center mb-3">
            <Sparkles size={22} strokeWidth={1.5} className="text-brand" />
          </div>
          <DrawerTitle className="text-[16px] font-semibold text-foreground">Upgrade to Cortardo Pro</DrawerTitle>
          <p className="text-[12.5px] text-fg-muted leading-relaxed mt-1.5 max-w-[260px]">
            Unlimited screens, real-time collaboration, version history, and higher agent limits.
          </p>
          <button
            onClick={() => onOpenChange(false)}
            className="mt-4 w-full max-w-[280px] h-[40px] rounded-[10px] bg-brand text-white text-[14px] font-semibold border-none cursor-pointer active:bg-brand/90"
          >
            Choose a plan
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="mt-2 w-full max-w-[280px] h-[36px] rounded-[10px] bg-transparent text-[13px] font-medium text-fg-soft border-none cursor-pointer"
          >
            Maybe later
          </button>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </DrawerContent>
    </Drawer>
  );
}
