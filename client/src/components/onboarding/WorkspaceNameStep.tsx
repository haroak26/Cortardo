import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";

type Props = {
  workspaceName: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
};

export function WorkspaceNameStep({ workspaceName, onChange, onSubmit, isLoading }: Props) {
  const [touched, setTouched] = useState(false);
  const isValid = workspaceName.trim().length > 0;
  const showError = touched && !isValid;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="workspaceName" className="text-[13px] font-medium text-foreground">
          Workspace name
        </label>
        <TextInput
          id="workspaceName"
          type="text"
          placeholder="My Company"
          value={workspaceName}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          autoFocus
          autoComplete="organization"
          onKeyDown={(e) => { if (e.key === "Enter" && isValid) onSubmit(); }}
          className={`w-full ${showError ? "border-[hsl(var(--danger))]!" : ""}`}
          aria-invalid={showError}
          aria-describedby={showError ? "workspaceName-error" : undefined}
        />
        {showError && (
          <p id="workspaceName-error" className="text-[12px] text-[hsl(var(--danger))]">
            Enter a workspace name to continue.
          </p>
        )}
      </div>
      <Button onClick={onSubmit} isLoading={isLoading} disabled={!isValid} size="md" className="w-full">
        Continue <ArrowRight size={14} />
      </Button>
    </div>
  );
}
