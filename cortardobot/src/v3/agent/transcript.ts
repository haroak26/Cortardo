import type { AgentTranscript, AgentTurn, ToolObservation } from "../types";

const MAX_DETAIL = 1_200;

export function truncateObservation(observation: ToolObservation): ToolObservation {
  return { ...observation, detail: observation.detail.length > MAX_DETAIL ? `${observation.detail.slice(0, MAX_DETAIL)}\n... [truncated]` : observation.detail };
}

export class TranscriptRecorder {
  private readonly turns: AgentTurn[] = [];
  private toolCalls = 0;
  private truncated = false;

  constructor(private readonly candidateId: string) {}

  addTurn(turn: AgentTurn): void {
    this.turns.push({ ...turn, observations: turn.observations.map(truncateObservation) });
    this.toolCalls += turn.observations.length;
    if (this.turns.length > 12) {
      this.turns.splice(0, this.turns.length - 12);
      this.truncated = true;
    }
  }

  get count(): number {
    return this.toolCalls;
  }

  snapshot(): AgentTranscript {
    return { candidateId: this.candidateId, turns: this.turns.map((turn) => ({ ...turn })), toolCalls: this.toolCalls, truncated: this.truncated };
  }
}

/** Compact transcript renderer for follow-up model turns. */
export function renderObservations(observations: ToolObservation[]): string {
  return observations
    .map((observation) => `### ${observation.tool} ${observation.ok ? "ok" : "failed"}\n${observation.summary}\n${observation.detail}`.trim())
    .join("\n\n");
}
