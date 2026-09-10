import { ArrowRight, PartyPopper, Building2 } from "lucide-react";
import { Button } from "@/components/button";

type Props = {
  workspaceName: string;
  onFinish: () => void;
  isLoading: boolean;
};

export function FinalizingStep({ workspaceName, onFinish, isLoading }: Props) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-[14px] bg-primary shrink-0">
          <PartyPopper size={22} className="text-primary-foreground" />
        </div>
        <div>
          <p className="text-[15px] font-semibold text-foreground">You&apos;re all set!</p>
          <p className="text-[13px] text-fg-muted">Your account is ready to use.</p>
        </div>
      </div>

      {workspaceName && (
        <div className="rounded-xl border border-border bg-surface-muted divide-y divide-border overflow-hidden">
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <Building2 size={13} className="text-fg-faint shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-fg-faint uppercase tracking-wide font-semibold">Workspace</p>
              <p className="text-[13px] text-foreground font-medium truncate">{workspaceName}</p>
            </div>
          </div>
        </div>
      )}

      <Button onClick={onFinish} isLoading={isLoading} size="md" className="w-full">
        Go to your account <ArrowRight size={14} />
      </Button>
    </div>
  );
}
