import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { TextInput } from "@/components/text-input";
import { useWorkspace } from "@/contexts/workspace-context";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface CreateWorkspacePopupProps {
  open: boolean;
  onClose: () => void;
}

export function CreateWorkspacePopup({ open, onClose }: CreateWorkspacePopupProps) {
  const { setActiveWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setBudget("");
      setError("");
      setTimeout(() => nameRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const valid = name.trim().length >= 2;
  const parsedBudget = budget.trim() === "" ? undefined : Number(budget);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!valid) return;
    if (budget.trim() !== "" && (!Number.isFinite(parsedBudget) || (parsedBudget as number) <= 0)) {
      setError("Credit budget must be a positive number");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          creditBudget: parsedBudget ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Failed to create workspace");
      await queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      setActiveWorkspaceId(json.id);
      toast({ title: "Workspace created", variant: "success" });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-transparent"
      onClick={onClose}
    >
      <form
        onSubmit={handleCreate}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[340px] bg-background border border-border rounded-[20px] shadow-xl p-5 flex flex-col gap-4 animate-in zoom-in-95 fade-in-0 duration-150"
      >
        <div>
          <label className="block text-[12px] font-medium text-foreground mb-1.5">
            Workspace name
          </label>
          <TextInput
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Inc."
            size="sm"
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-foreground mb-1.5">
            Credit budget <span className="text-[11px] font-medium text-fg-faint">· optional</span>
          </label>
          <TextInput
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="e.g. 5000"
            type="text"
            inputMode="numeric"
            size="sm"
            suffix="credits"
            className="w-full"
          />
          <p className="text-[11px] text-fg-muted mt-1">Leave empty for no credit limit.</p>
        </div>

        {error && <p className="text-[12px] text-destructive">{error}</p>}

        <Button type="submit" size="sm" disabled={!valid || creating} isLoading={creating}>
          Create workspace
        </Button>
      </form>
    </div>
  );
}
