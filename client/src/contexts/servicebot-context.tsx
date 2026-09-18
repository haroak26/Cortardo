import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "@/contexts/workspace-context";
import { useSupportAgent } from "@/hooks/use-support-agent";

type ServiceBotContextValue = {
  agent: ReturnType<typeof useSupportAgent>;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const ServiceBotContext = createContext<ServiceBotContextValue | null>(null);

/**
 * Owns ServiceBot state above the page routes so an in-flight answer, the open
 * panel and the working indicator survive navigation between app pages.
 */
export function ServiceBotProvider({ children }: { children: ReactNode }) {
  const { activeWorkspaceId } = useWorkspace();
  const agent = useSupportAgent({ workspaceId: activeWorkspaceId });
  const [open, setOpen] = useState(false);
  const working = agent.status === "thinking";

  const value = useMemo(() => ({ agent, open, setOpen }), [agent, open]);

  return (
    <ServiceBotContext.Provider value={value}>
      {children}
      {createPortal(
        <span aria-hidden className="servicebot-page-edge" data-active={working ? "true" : "false"} />,
        document.body,
      )}
    </ServiceBotContext.Provider>
  );
}

export function useServiceBot() {
  const context = useContext(ServiceBotContext);
  if (!context) throw new Error("useServiceBot must be used within ServiceBotProvider");
  return context;
}
