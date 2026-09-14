import type { ModelClient, ModelResponse, ModelTask } from "../../src/models/types";

export class ScriptedModel implements ModelClient {
  readonly id: string;
  readonly dryRun = true;
  readonly calls: string[] = [];
  private readonly responses: Partial<Record<ModelTask["kind"], string[]>>;

  constructor(responses: Partial<Record<ModelTask["kind"], string[]>>, id = "scripted") {
    this.responses = responses;
    this.id = id;
  }

  async complete(task: ModelTask): Promise<ModelResponse> {
    this.calls.push(task.kind);
    const queue = this.responses[task.kind];
    const text = queue && queue.length > 0 ? queue.shift()! : "{}";
    return { text, model: this.id, tokensIn: 2, tokensOut: 2, durationMs: 1 };
  }
}

export function planResponse(strategy = "fix the root cause"): string {
  return JSON.stringify({ strategy, files: [], rationale: "minimal change" });
}

export function patchResponse(patch: string): string {
  return JSON.stringify({ patch, description: "apply the fix" });
}

export function diagnosisResponse(reason = "reproduction still fails", nextStrategy = "change layer"): string {
  return JSON.stringify({ reason, nextStrategy });
}
