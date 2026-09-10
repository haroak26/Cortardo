import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";

type Props = {
  displayName: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
};

export function ProfileNameStep({ displayName, onChange, onSubmit, isLoading }: Props) {
  const [touched, setTouched] = useState(false);
  const isValid = displayName.trim().length > 0;
  const showError = touched && !isValid;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="displayName" className="text-[13px] font-medium text-foreground">
          Your name
        </label>
        <TextInput
          id="displayName"
          type="text"
          placeholder="Alex Johnson"
          value={displayName}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          autoFocus
          autoComplete="name"
          onKeyDown={(e) => { if (e.key === "Enter" && isValid) onSubmit(); }}
          className={`w-full ${showError ? "border-[hsl(var(--danger))]!" : ""}`}
          aria-invalid={showError}
          aria-describedby={showError ? "displayName-error" : undefined}
        />
        {showError && (
          <p id="displayName-error" className="text-[12px] text-[hsl(var(--danger))]">
            Please enter your name to continue.
          </p>
        )}
      </div>
      <Button onClick={onSubmit} isLoading={isLoading} disabled={!isValid} size="md" className="w-full">
        Continue <ArrowRight size={14} />
      </Button>
    </div>
  );
}