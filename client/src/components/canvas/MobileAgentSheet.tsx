import { useEffect, useState } from "react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { PromptInput, type PromptOptions } from "@/components/PromptInput";
import type { UseCortardoAgent } from "@/hooks/use-cortardo-agent";
import { StatusPill } from "@/components/agent/AgentPanel";

const PEEK = "172px";
const FULL = 0.92;

export function MobileAgentSheet({
  open,
  onOpenChange,
  agent,
  onPrompt,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agent: UseCortardoAgent;
  onPrompt: (prompt: string, options?: { model?: string; reasoning?: string }) => void;
}) {
  // Snap state: a collapsed "peek" (just the prompt bar) vs the full conversation.
  const [snap, setSnap] = useState<string | number>(FULL);

  // Open expanded when starting out, collapse to a peek once the brief is done
  // so the canvas underneath is revealed — the good-mobile-UX beat competitors miss.
  useEffect(() => {
    if (!open) return;
    setSnap(agent.status === "done" ? PEEK : FULL);
  }, [open, agent.status]);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={[PEEK, FULL]}
      activeSnapPoint={snap}
      setActiveSnapPoint={(s) => setSnap(s ?? FULL)}
      fadeFromIndex={0}
      shouldScaleBackground={false}
    >
      <DrawerContent className="flex flex-col max-h-[94vh]" overlayClassName="bg-transparent">
        <DrawerTitle className="sr-only">Cortardo Agent</DrawerTitle>

        {snap === PEEK ? (
          <div className="px-3 pt-2 pb-[calc(10px+env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-2 mb-2">
              <StatusPill status={agent.status} />
              <span className="text-[12px] font-semibold text-foreground">
                {agent.status === "done" ? "Refine the brief" : "Cortardo"}
              </span>
            </div>
            <PromptInput
              compact
              onSubmit={(p, opts: PromptOptions) => onPrompt(p, { model: opts.model, reasoning: opts.reasoning })}
              placeholder={agent.status === "done" ? "Refine the review…" : "Describe what you want reviewed…"}
              isLoading={agent.loading}
              systemError={agent.systemError}
              initialModel={agent.model}
              initialReasoning={agent.reasoning}
              showFocusPlaceholder={false}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <AgentPanel
              status={agent.status}
              reasoningText={agent.reasoningText}
              planText={agent.planText}
              reasoningMs={agent.reasoningMs}
              questions={agent.questions}
              answers={agent.answers}
              components={agent.components}
              editedComponents={agent.editedComponents}
              componentBuilds={agent.componentBuilds}
              prompt={agent.prompt}
              loading={agent.loading}
              systemError={agent.systemError}
              chats={agent.chats}
              currentChatId={agent.currentChatId}
              initialModel={agent.model}
              initialReasoning={agent.reasoning}
              onAnswerChange={agent.setAnswer}
              onSubmit={agent.submitAnswers}
              onPrompt={onPrompt}
              onSelectChat={agent.selectChat}
              onNewChat={agent.newChat}
              onRefreshChats={() => {}}
            />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
