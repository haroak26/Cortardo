import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import { CanvasDropdown } from "@/components/CanvasDropdown";
import { Button } from "@/components/button";
import {
  InformationCircleIcon,
  Clock01Icon,
  Layers01Icon,
  File01Icon,
  CodeIcon,
  File02Icon,
  Edit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export interface EditorInfoPanelProps {
  projectName: string;
  onRename: () => void;
  screensCount: number;
  docsCount: number;
  filesCount: number;
  fontsCount: number;
  originalPrompt?: string | null;
  isRunning: boolean;
}

interface InfoDoc {
  title: string;
  meta: string;
  kind: "screen" | "doc" | "guide";
}

export function EditorInfoPanel({
  projectName,
  onRename,
  screensCount,
  docsCount,
  filesCount,
  fontsCount,
  originalPrompt,
  isRunning,
}: EditorInfoPanelProps) {
  const [showPrompt, setShowPrompt] = useState(true);

  const stats = [
    { icon: Layers01Icon, label: "Screens", value: screensCount },
    { icon: File01Icon, label: "Docs", value: docsCount },
    { icon: CodeIcon, label: "Files", value: filesCount },
    { icon: File02Icon, label: "Fonts", value: fontsCount },
  ];

  const docs: InfoDoc[] = [];
  for (let i = 0; i < Math.min(docsCount, 6); i++) {
    const kind = i === 0 && docsCount > 0 ? "screen" : i % 3 === 0 ? "guide" : "doc";
    docs.push({
      title:
        kind === "screen"
          ? `Screen ${i + 1}`
          : kind === "guide"
          ? "Design guidelines"
          : ["Copy & tone", "Component notes", "Behavior spec", "Layout rules"][i % 4],
      meta:
        kind === "screen"
          ? "Screen spec"
          : kind === "guide"
          ? "Project guide"
          : "Working doc",
      kind,
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={ InformationCircleIcon } size={15} strokeWidth={1.75} className="text-fg-muted"  />
          <span className="text-[12px] font-semibold text-foreground">Project Info</span>
        </div>
        <CanvasDropdown
          value=""
          onChange={(action) => {
            if (action === "rename") onRename();
          }}
          options={[
            { value: "rename", label: "Rename project" },
            { value: "delete", label: "Delete project", variant: "danger" },
          ]}
          align="right"
        >
          <Button design="ghost" size="xs" className="px-1.5">
            <HugeiconsIcon icon={ Edit01Icon } size={12} strokeWidth={1.75}  />
          </Button>
        </CanvasDropdown>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
        {/* Project identity card */}
        <div className="rounded-[10px] border border-border bg-background overflow-hidden">
          <div className="px-3 py-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[8px] bg-brand/10 flex items-center justify-center shrink-0">
              <HugeiconsIcon icon={ Layers01Icon } size={14} strokeWidth={1.75} className="text-brand"  />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-foreground truncate" title={projectName}>
                {projectName}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 h-[16px] rounded-full shrink-0 ${
                    isRunning
                      ? "bg-warning/10 text-warning"
                      : "bg-success/10 text-success"
                  }`}
                >
                  <motion.span
                    animate={isRunning ? { opacity: [1, 0.4, 1] } : undefined}
                    transition={isRunning ? { duration: 1.4, repeat: Infinity } : undefined}
                    className="w-[4px] h-[4px] rounded-full bg-current"
                  />
                  {isRunning ? "Building" : "Ready"}
                </span>
                <span className="flex items-center gap-1 text-[9px] text-fg-faint">
                  <HugeiconsIcon icon={ Clock01Icon } size={9} strokeWidth={1.75}  />
                  just now
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats — horizontal compact row */}
        <div className="flex items-center gap-0.5">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.04 }}
              className="flex-1 flex flex-col items-center gap-1 py-2 rounded-[8px] hover:bg-surface-hover transition-colors cursor-default"
            >
              <span className="text-[13px] font-semibold text-foreground leading-none">{s.value}</span>
              <span className="text-[9px] text-fg-faint leading-none">{s.label}</span>
            </motion.div>
          ))}
        </div>

        {/* Documents */}
        {docs.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
                Documents
              </p>
              <span className="text-[9px] font-medium text-fg-faint">{docs.length}</span>
            </div>
            <div className="space-y-px">
              {docs.map((d, i) => (
                <div
                  key={`${d.title}-${i}`}
                  className="group flex items-center gap-2 px-2 h-[30px] rounded-[8px] hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <span className="flex items-center justify-center w-[18px] h-[18px] rounded-[5px] bg-surface-hover shrink-0 group-hover:bg-border/60 transition-colors">
                    <HugeiconsIcon icon={ File01Icon } size={10} strokeWidth={1.75} className="text-fg-muted"  />
                  </span>
                  <p className="text-[11px] font-[450] text-foreground truncate flex-1">{d.title}</p>
                  <ChevronRight size={10} strokeWidth={2} className="text-fg-faint opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Original prompt */}
        {originalPrompt && (
          <div>
            <div className="h-px bg-border mb-2.5" />
            <button
              onClick={() => setShowPrompt((v) => !v)}
              className="w-full flex items-center justify-between text-left cursor-pointer group"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-faint group-hover:text-fg-muted transition-colors">
                Original prompt
              </span>
              <span className="text-fg-faint group-hover:text-fg-muted transition-colors">
                {showPrompt ? (
                  <ChevronUp size={11} strokeWidth={1.75} />
                ) : (
                  <ChevronDown size={11} strokeWidth={1.75} />
                )}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {showPrompt && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-[8px] bg-surface-hover px-2.5 py-2 mt-1.5">
                    <p className="text-[11px] text-fg-muted leading-relaxed line-clamp-6">
                      {originalPrompt}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
