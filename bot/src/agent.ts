/**
 * A tiny read-only agent loop for the swarm. Same JSON protocol as the rest of
 * Cortardo Bot: the model thinks, calls read-only tools, sees the observations, and
 * finishes with a JSON answer. No sandbox, no writes, no shell.
 */
import type { CortardoBotMessage, CortardoBotModelClient } from "./model.ts";

export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentObservation {
  tool: string;
  ok: boolean;
  summary: string;
  detail: string;
}

export interface AgentRunInput {
  system: string;
  user: string;
  tools: ReadonlySet<string>;
  execute: (action: AgentAction) => Promise<AgentObservation>;
  client: CortardoBotModelClient;
  maxTurns: number;
  maxToolsPerTurn: number;
  deadline: number;
  /** Reject a final answer until this many tools have actually run. */
  minToolCallsBeforeFinal?: number;
  /** If the model answers empty without reading, the harness reads this for it. */
  groundingAction?: AgentAction;
  /** What counts as a substantive final answer; defaults to a non-empty hypotheses list. */
  hasContent?: (parsed: Record<string, unknown>) => boolean;
  label: string;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
  isFinal?: (parsed: Record<string, unknown>) => boolean;
  /** Gateway prompt_cache_key for the shared prefix of this run. */
  cacheKey?: string;
  /** Pre-seeded conversation for a continued (retried) agent run. */
  initialHistory?: CortardoBotMessage[];
  /** Stop when a turn adds no new evidence instead of spending another call. */
  stopWhenNoNewEvidence?: boolean;
}

export interface AgentRunResult {
  final?: Record<string, unknown>;
  lastText: string;
  turns: number;
  toolCalls: number;
  observations: AgentObservation[];
  /** Conversation as of the return, so a retry can continue instead of restart. */
  history: CortardoBotMessage[];
  stoppedReason: string;
}

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function renderObservations(observations: AgentObservation[]): string {
  const blocks = observations.map(
    (observation) =>
      `### ${observation.ok ? "ok" : "error"} — ${observation.tool}: ${observation.summary}\n${observation.detail || "(no output)"}`,
  );
  return [
    "## Tool results",
    ...blocks,
    "Continue with another tool call, or return your final JSON answer now.",
  ].join("\n\n");
}

/** file:line references found in tool output, used to detect a looping turn. */
function evidenceKeys(text: string): string[] {
  return text.match(/[\w./@-]+:\d+/g) ?? [];
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const isFinal = input.isFinal ?? ((parsed: Record<string, unknown>) => Array.isArray(parsed.hypotheses));
  const observations: AgentObservation[] = [];
  const history: CortardoBotMessage[] = [...(input.initialHistory ?? [])];
  const seenEvidence = new Set<string>();
  let user = input.user;
  let turns = 0;
  let toolCalls = 0;
  let finalRejections = 0;
  let stoppedReason = "turn budget exhausted";
  let bestFinal: { parsed: Record<string, unknown>; text: string } | undefined;
  const hasContent =
    input.hasContent ?? ((parsed: Record<string, unknown>) => Array.isArray(parsed.hypotheses) && parsed.hypotheses.length > 0);
  const usesHypothesisContract = (parsed: Record<string, unknown>) => Array.isArray(parsed.hypotheses);

  for (let turn = 1; turn <= Math.max(1, input.maxTurns); turn += 1) {
    if (Date.now() > input.deadline) {
      stoppedReason = "deadline reached";
      break;
    }
    turns = turn;
    const completion = await input.client.complete({
      system: input.system,
      user,
      history,
      signal: input.signal,
      cacheKey: input.cacheKey,
    });
    const parsed = parseJsonObject(completion.text);

    if (parsed && isFinal(parsed)) {
      const required = input.minToolCallsBeforeFinal ?? 0;
      if (hasContent(parsed)) bestFinal = { parsed, text: completion.text };
      // Only empty answers are pushed back: a model that found nothing without
      // reading (or without saying what it read) is guessing, but real findings
      // are never discarded.
      const checked = Array.isArray(parsed.checked) ? parsed.checked.length : 0;
      // The `checked` requirement only applies to hypothesis answers; codegen
      // answers are edits, and validation is their gate.
      const ungrounded = toolCalls < required || (usesHypothesisContract(parsed) && checked === 0);
      if (!hasContent(parsed) && ungrounded && finalRejections < 2) {
        finalRejections += 1;
        const groundings: AgentObservation[] = [];
        if (input.groundingAction && toolCalls === 0) {
          const observation = await input.execute(input.groundingAction).catch((error) => ({
            tool: input.groundingAction!.tool,
            ok: false,
            summary: "grounding tool failed",
            detail: error instanceof Error ? error.message : String(error),
          }));
          toolCalls += 1;
          observations.push(observation);
          groundings.push(observation);
          input.onLog?.(`${input.label}: grounded with ${input.groundingAction.tool}`);
        }
        history.push({ role: "user", content: user }, { role: "assistant", content: completion.text });
        user = [
          ...(groundings.length > 0 ? [renderObservations(groundings)] : []),
          "## Tool use is required before an empty answer",
          `You returned no findings after ${toolCalls} tool call(s). Read the real changed code first with read_file, get_impact or read_diff, then answer.`,
          "If nothing is wrong, say so only after reading the code.",
        ].join("\n\n");
        stoppedReason = "empty final answer rejected: no tool calls";
        continue;
      }
      stoppedReason = "final answer";
      return {
        final: parsed,
        lastText: completion.text,
        turns,
        toolCalls,
        observations,
        // Self-contained so a retry can continue the conversation.
        history: [...history, { role: "user", content: user }, { role: "assistant", content: completion.text }],
        stoppedReason,
      };
    }

    const actions = Array.isArray(parsed?.actions)
      ? (parsed!.actions as unknown[])
          .slice(0, input.maxToolsPerTurn)
          .map((action) => (action && typeof action === "object" ? (action as Record<string, unknown>) : undefined))
          .filter((action): action is Record<string, unknown> => action !== undefined)
          .map((action) => ({
            tool: typeof action.tool === "string" ? action.tool : "",
            args: action.args && typeof action.args === "object" ? (action.args as Record<string, unknown>) : {},
          }))
          .filter((action) => input.tools.has(action.tool))
      : [];

    const turnObservations: AgentObservation[] = [];
    for (const action of actions) {
      const observation = await input.execute(action).catch((error) => ({
        tool: action.tool,
        ok: false,
        summary: "tool crashed",
        detail: error instanceof Error ? error.message : String(error),
      }));
      toolCalls += 1;
      turnObservations.push(observation);
      observations.push(observation);
      input.onLog?.(`${input.label}: ${observation.ok ? "ok" : "error"} ${action.tool} — ${observation.summary}`);
    }

    history.push({ role: "user", content: user }, { role: "assistant", content: completion.text });

    if (input.stopWhenNoNewEvidence && actions.length > 0 && turn >= 2 && turn < Math.max(1, input.maxTurns)) {
      let fresh = false;
      for (const observation of turnObservations) {
        if (!observation.ok) continue;
        for (const key of evidenceKeys(observation.detail)) {
          if (!seenEvidence.has(key)) {
            seenEvidence.add(key);
            fresh = true;
          }
        }
      }
      if (!fresh) {
        stoppedReason = "no new evidence";
        break;
      }
    }

    user =
      turnObservations.length > 0
        ? renderObservations(turnObservations)
        : [
            "## No usable actions",
            `You must answer with JSON. To use a tool: {"thought":"...","actions":[{"tool":"read_file","args":{"path":"..."}}],"done":false}.`,
            `Allowed tools: ${[...input.tools].filter((tool) => tool !== "finish").join(", ")}.`,
          ].join("\n\n");
  }

  if (bestFinal) {
    return {
      final: bestFinal.parsed,
      lastText: bestFinal.text,
      turns,
      toolCalls,
      observations,
      history,
      stoppedReason: "final answer recovered from an earlier turn",
    };
  }

  return {
    final: undefined,
    lastText: "",
    turns,
    toolCalls,
    observations,
    history,
    stoppedReason,
  };
}
