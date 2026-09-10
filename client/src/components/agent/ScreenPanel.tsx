import { useState, useRef, useEffect } from "react";
import { Code2, Download, Share2, CopyPlus, RefreshCw, Plus } from "lucide-react";
import { ComputerIcon, SmartPhone01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatScreenLabel } from "@/lib/utils";

interface ScreenPanelProps {
  screenName: string;
  children: React.ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
  onRename?: (name: string) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  isMobile?: boolean;
  onToggleDevice?: () => void;
  onViewCode?: () => void;
  onExport?: () => void;
  onShare?: () => void;
  onDuplicate?: () => void;
  onRegenerate?: () => void;
  onVariant?: () => void;
  onAddLeft?: () => void;
  onAddRight?: () => void;
  onAddBottom?: () => void;
}

export function ScreenPanel({
  screenName,
  children,
  isSelected = false,
  onSelect,
  onRename,
  onPointerDown,
  isMobile = false,
  onToggleDevice,
  onViewCode,
  onExport,
  onShare,
  onDuplicate,
  onRegenerate,
  onVariant,
  onAddLeft,
  onAddRight,
  onAddBottom,
}: ScreenPanelProps) {
  const [hovered, setHovered] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(screenName);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isActive = isSelected || hovered;

  useEffect(() => {
    if (!editingName) {
      setNameDraft(screenName);
    }
  }, [screenName, editingName]);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.select();
    }
  }, [editingName]);

  const handleAction = (e: React.MouseEvent, fn?: () => void) => {
    e.stopPropagation();
    fn?.();
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingName(true);
  };

  const handleSaveName = () => {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== screenName) {
      onRename?.(trimmed);
    } else {
      setNameDraft(screenName);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveName();
    } else if (e.key === "Escape") {
      setEditingName(false);
      setNameDraft(screenName);
    }
  };

  const iconBtn =
    "p-1 text-fg-muted hover:text-brand transition-colors border-none bg-transparent cursor-pointer rounded shrink-0";

  const plusCircleCls = (active: boolean) =>
    `absolute z-10 transition-all duration-150 ${
      active ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
    }`;

  const plusBtn =
    "w-6 h-6 rounded-full border border-border/40 bg-background flex items-center justify-center text-fg-muted hover:border-brand hover:text-brand transition-colors cursor-pointer";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect?.()}
      onPointerDown={onPointerDown}
      className="screen-panel select-none"
    >
      <div className="flex items-center justify-between mb-1.5">
        {editingName ? (
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={handleNameKeyDown}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-xs text-brand bg-transparent border-none outline-none p-0 m-0 w-40 min-w-0 border-b border-border/40 focus:border-brand transition-colors"
            autoFocus
          />
        ) : (
          <span
            onClick={handleStartEdit}
            onPointerDown={(e) => e.stopPropagation()}
            className={`text-xs transition-colors cursor-text ${
              isActive ? "text-brand" : "text-fg-muted"
            }`}
          >
            {formatScreenLabel(screenName)}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            className={iconBtn}
            onClick={(e) => handleAction(e, onToggleDevice)}
          >
            {isMobile ? (
              <HugeiconsIcon icon={ SmartPhone01Icon } size={16}  />
            ) : (
              <HugeiconsIcon icon={ ComputerIcon } size={16}  />
            )}
          </button>

          <div className="w-px h-4 bg-border/40 shrink-0" />

          <button className={iconBtn} onClick={(e) => handleAction(e, onViewCode)}>
            <Code2 size={16} strokeWidth={1.5} />
          </button>

          <button className={iconBtn} onClick={(e) => handleAction(e, onExport)}>
            <Download size={16} strokeWidth={1.5} />
          </button>

          <button className={iconBtn} onClick={(e) => handleAction(e, onShare)}>
            <Share2 size={16} strokeWidth={1.5} />
          </button>

          <button className={iconBtn} onClick={(e) => handleAction(e, onDuplicate)}>
            <CopyPlus size={16} strokeWidth={1.5} />
          </button>

          <div className="w-px h-4 bg-border/40 shrink-0" />

          <button className={iconBtn} onClick={(e) => handleAction(e, onVariant)}>
            <RefreshCw size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="relative">
        <div className={plusCircleCls(isActive)} style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}>
          <button className={plusBtn} onClick={(e) => handleAction(e, onAddLeft)}>
            <Plus size={12} strokeWidth={1.5} />
          </button>
        </div>

        <div className={plusCircleCls(isActive)} style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>
          <button className={plusBtn} onClick={(e) => handleAction(e, onAddRight)}>
            <Plus size={12} strokeWidth={1.5} />
          </button>
        </div>

        <div className={plusCircleCls(isActive)} style={{ left: "50%", bottom: -8, transform: "translate(-50%, 100%)" }}>
          <button className={plusBtn} onClick={(e) => handleAction(e, onAddBottom)}>
            <Plus size={12} strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-1.5 cursor-grab active:cursor-grabbing">
          <div className="rounded-[3px] overflow-hidden transition-all duration-150">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
