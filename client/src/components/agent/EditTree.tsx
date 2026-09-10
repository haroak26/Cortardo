import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { CortardoChat } from "@/hooks/use-cortardo-agent";

interface EditTreeProps {
  chats: CortardoChat[];
  currentChatId: string | null;
  onBack: () => void;
  onRevertTo: (runId: string) => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Agent-panel subpanel listing every edit the agent made as a vertical
 * checkpoint tree: connector line + circles on the left, checkpoint name,
 * date/time and credit cost on the right. Selecting a checkpoint reverts the
 * project to that run's artifacts. Rendered below the shared agent header.
 */
export function EditTree({ chats, currentChatId, onRevertTo }: EditTreeProps) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(currentChatId);
  }, [currentChatId]);

  // Oldest first so the tree reads top-down as a history.
  const ordered = [...chats].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-4">
      {ordered.length === 0 ? (
        <p className="text-[12px] text-fg-muted px-1">No checkpoints yet.</p>
      ) : (
        <div className="flex flex-col">
          {ordered.map((c, i) => {
            const isCurrent = c.id === currentChatId;
            const isSelected = c.id === selected;
            const isLast = i === ordered.length - 1;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  onRevertTo(c.id);
                }}
                className="group flex items-stretch gap-3 text-left border-none bg-transparent cursor-pointer p-0"
              >
                {/* Rail: circle + connector line */}
                <div className="relative flex flex-col items-center shrink-0 w-[18px]">
                  <span
                    className={`mt-[13px] h-[12px] w-[12px] rounded-full shrink-0 border-2 transition-colors ${
                      isCurrent
                        ? "border-brand bg-brand"
                        : isSelected
                          ? "border-brand bg-background"
                          : "border-border bg-background group-hover:border-fg-muted"
                    }`}
                  />
                  {!isLast && <span className="w-[2px] flex-1 bg-border my-1 rounded-full" />}
                </div>

                {/* Details */}
                <div
                  className={`flex-1 min-w-0 rounded-[10px] px-2.5 py-2 mb-3 transition-colors ${
                    isSelected ? "bg-surface-hover" : "group-hover:bg-surface-hover/60"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[12px] font-medium truncate flex-1 ${
                        isCurrent ? "text-foreground" : "text-fg-soft"
                      }`}
                    >
                      {c.title || c.prompt.slice(0, 40) || "New chat"}
                    </span>
                    {isCurrent && (
                      <span className="flex items-center gap-0.5 text-[9.5px] font-semibold text-brand shrink-0">
                        <Check size={10} strokeWidth={3} />
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-fg-faint mt-0.5">
                    {formatDateTime(c.createdAt)}
                  </div>
                  <div className="text-[10.5px] text-fg-muted mt-0.5 font-medium">
                    {typeof c.credits === "number" ? `${c.credits.toFixed(2)} credits` : "—"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
