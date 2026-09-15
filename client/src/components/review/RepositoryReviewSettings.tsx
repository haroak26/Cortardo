import { useState } from "react";
import { Button } from "@/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/base/dialog";
import { SettingsLargeTextRow, SettingsRow, SettingsSection, SettingsSwitchRow } from "@/components/settings-ui";
import { TextInput } from "@/components/text-input";
import { useUpdateRepository, type ApiRepository } from "@/hooks/use-github";
import { useToast } from "@/hooks/use-toast";

function learningsFrom(settings: Record<string, unknown>): string[] {
  return Array.isArray(settings.learnings) ? settings.learnings.filter((item): item is string => typeof item === "string") : [];
}

export function RepositoryReviewSettingsDialog({
  repository,
  onClose,
}: {
  repository: ApiRepository;
  onClose: () => void;
}) {
  const updateRepository = useUpdateRepository();
  const { toast } = useToast();
  const settings = repository.settings ?? {};
  const [autoCommit, setAutoCommit] = useState(settings.autoCommitFixes === true);
  const [maxFixes, setMaxFixes] = useState(
    typeof settings.autoCommitMaxFindings === "number" && settings.autoCommitMaxFindings > 0 ? settings.autoCommitMaxFindings : 3,
  );
  const [learnings, setLearnings] = useState(learningsFrom(settings).join("\n"));

  const save = () => {
    const parsedLearnings = learnings
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);
    const boundedMax = Math.min(10, Math.max(1, Math.floor(maxFixes) || 1));
    updateRepository.mutate(
      {
        id: repository.id,
        settings: {
          ...settings,
          autoCommitFixes: autoCommit,
          autoCommitMaxFindings: boundedMax,
          learnings: parsedLearnings,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Review settings saved", description: repository.fullName });
          onClose();
        },
        onError: (error) =>
          toast({
            title: "Could not save review settings",
            description: (error as Error).message,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Review settings</DialogTitle>
          <DialogDescription className="font-mono">{repository.fullName}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          <SettingsSection title="Verified fixes">
            <SettingsSwitchRow
              label="Auto-commit verified fixes"
              description="Commit fixes that passed execution verification straight to the pull request branch. Off means suggestions only."
              checked={autoCommit}
              onCheckedChange={setAutoCommit}
            />
            <SettingsRow
              label="Max fixes per run"
              description="Upper bound on findings auto-committed in a single review (1–10)."
              align="center"
            >
              <TextInput
                type="number"
                min={1}
                max={10}
                value={String(maxFixes)}
                disabled={!autoCommit}
                onChange={(event) => setMaxFixes(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
                className="w-[72px] text-center"
                aria-label="Maximum fixes auto-committed per run"
              />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection title="Repository learnings">
            <SettingsLargeTextRow
              label="What should the bot know?"
              description="One durable lesson per line. Learnings are injected into investigation, repair and review prompts on every run."
              value={learnings}
              onChange={(event) => setLearnings(event.target.value)}
              placeholder={"Prefer the repository error helper over throwing raw errors\nNever change public API signatures without a migration"}
              rows={5}
            />
          </SettingsSection>
        </div>
        <DialogFooter>
          <Button design="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" isLoading={updateRepository.isPending} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
