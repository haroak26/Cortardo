import { ChevronLeft } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TABS, type CanvasTab } from "./CanvasMobileTabBar";

export function CanvasMobileSidebar({
  activeTab,
  onSelectTab,
  onClose,
}: {
  activeTab: CanvasTab | null;
  onSelectTab: (tab: CanvasTab) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="shrink-0 h-[48px] flex items-center gap-1 px-1.5 border-b border-surface-hover">
        <button
          onClick={onClose}
          aria-label="Close sidebar"
          className="flex items-center justify-center w-9 h-9 rounded-[10px] text-fg-soft hover:bg-surface-hover active:bg-surface-active transition-colors border-none cursor-pointer"
        >
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
        <span className="text-[14px] font-semibold text-foreground">Editor</span>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                onSelectTab(tab.id);
                onClose();
              }}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 w-full px-3 py-3 rounded-[12px] text-[14px] font-medium transition-colors border-none cursor-pointer ${
                isActive ? "bg-surface-hover text-brand" : "text-foreground hover:bg-surface-hover"
              }`}
            >
              <HugeiconsIcon
                icon={tab.icon}
                size={20}
                strokeWidth={1.75}
                className={isActive ? "text-brand" : "text-fg-soft"}
              />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
