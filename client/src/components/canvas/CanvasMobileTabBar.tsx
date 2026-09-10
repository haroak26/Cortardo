import {
  Layout01Icon,
  BrushIcon,
  Blockchain01Icon,
  UserGroupIcon,
  InformationCircleIcon,
  AiBrowserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export type CanvasTab = "screens" | "design" | "assets" | "collab" | "info" | "agent";

export const TABS: { id: CanvasTab; icon: typeof Layout01Icon; label: string }[] = [
  { id: "screens", icon: Layout01Icon, label: "Screens" },
  { id: "design", icon: BrushIcon, label: "Design" },
  { id: "assets", icon: Blockchain01Icon, label: "Assets" },
  { id: "collab", icon: UserGroupIcon, label: "Collab" },
  { id: "info", icon: InformationCircleIcon, label: "Info" },
  { id: "agent", icon: AiBrowserIcon, label: "Agent" },
];

export function CanvasMobileTabBar({
  active,
  onSelect,
}: {
  active: CanvasTab | null;
  onSelect: (tab: CanvasTab) => void;
}) {
  return (
    <nav
      className="shrink-0 flex items-stretch bg-background border-t border-surface-hover pb-[env(safe-area-inset-bottom)] z-20"
      aria-label="Canvas sections"
    >
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-[3px] pt-[7px] pb-[6px] min-h-[56px] border-none cursor-pointer transition-colors ${
              tab.id === "agent" ? "relative" : ""
            }`}
          >
            <span className="flex items-center justify-center h-[20px] w-[20px]">
              <HugeiconsIcon
                icon={tab.icon}
                size={19}
                strokeWidth={1.75}
                className={isActive ? "text-brand" : "text-fg-soft"}
              />
            </span>
            <span
              className={`text-[9.5px] font-semibold leading-none ${
                isActive ? "text-brand" : "text-fg-soft"
              }`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
