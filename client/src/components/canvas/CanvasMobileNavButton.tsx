import { useState } from "react";
import { ThreeDViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Check } from "lucide-react";
import { TABS, type CanvasTab } from "./CanvasMobileTabBar";

export function CanvasMobileNavButton({
  activeTab,
  onSelect,
}: {
  activeTab: CanvasTab | null;
  onSelect: (tab: CanvasTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = activeTab ? TABS.find((t) => t.id === activeTab) : null;
  const currentIcon = current?.icon ?? ThreeDViewIcon;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Navigate"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center justify-center w-9 h-9 rounded-[10px] text-foreground hover:bg-surface-hover active:bg-surface-active transition-colors border-none cursor-pointer"
      >
        <HugeiconsIcon icon={currentIcon} size={19} strokeWidth={1.75} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+6px)] z-40 bg-background border border-border rounded-[14px] p-1 flex flex-col gap-0.5 shadow-md min-w-[180px]"
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="menuitem"
                  onClick={() => {
                    onSelect(tab.id);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] text-[12.5px] font-medium text-left transition-colors border-none cursor-pointer ${
                    isActive ? "bg-surface-hover text-brand" : "text-foreground hover:bg-surface-hover"
                  }`}
                >
                  <span className="flex items-center justify-center h-[18px] w-[18px] shrink-0">
                    <HugeiconsIcon icon={tab.icon} size={16} strokeWidth={1.75} />
                  </span>
                  <span className="flex-1">{tab.label}</span>
                  {isActive && <Check size={14} strokeWidth={2.5} className="text-brand" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
