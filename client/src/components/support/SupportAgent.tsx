import { HugeiconsIcon } from "@hugeicons/react";
import { AnonymousIcon } from "@hugeicons/core-free-icons";
import { IconButton } from "@/components/button";
import { useServiceBot } from "@/contexts/servicebot-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { SupportAgentPanel } from "./SupportAgentPanel";

const PANEL_WIDTH = 360;

/**
 * Floating ServiceBot launcher (bottom-right) plus its dock.
 *
 * Desktop: a right-hand panel that participates in the app shell layout like
 * the sidebar, so the main content yields width instead of being covered.
 * Mobile: a slide-in drawer from the right with a dimmed backdrop.
 *
 * The panel stays mounted while closed so the conversation survives toggles.
 */
export function SupportAgent() {
  /* State lives in ServiceBotProvider so the conversation survives navigation. */
  const { agent, open, setOpen } = useServiceBot();
  const isMobile = useIsMobile();
  const close = () => setOpen(false);

  return (
    <>
      {!open && (
        <IconButton
          design="brand"
          size="md"
          aria-label="Open ServiceBot"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 shadow-floating"
        >
          <HugeiconsIcon icon={AnonymousIcon} size={16} strokeWidth={2} />
        </IconButton>
      )}

      {isMobile && open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/10 backdrop-blur-[2px] animate-fade-in"
            onClick={close}
          />
          <div className="absolute inset-y-0 right-0 w-[min(360px,88vw)] animate-[slideInRight_0.2s_ease-out] border-l border-[hsl(var(--surface-hover))] bg-background">
            <SupportAgentPanel agent={agent} open={open} onClose={close} />
          </div>
        </div>
      )}

      {!isMobile && (
        <div
          className={cn(
            "relative h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
            open ? "visible" : "invisible",
          )}
          style={{ width: open ? PANEL_WIDTH : 0 }}
          aria-hidden={!open}
        >
          <div className="h-full border-l border-[hsl(var(--surface-hover))] bg-background" style={{ width: PANEL_WIDTH }}>
            <SupportAgentPanel agent={agent} open={open} onClose={close} />
          </div>
        </div>
      )}
    </>
  );
}
