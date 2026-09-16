/**
 * One agent loop for every role. A role only changes the system prompt, the
 * tool subset and the answer shape it is waiting for.
 */
import { z } from "zod";
import type { ModelRouter } from "../models";
import type { ModelRole } from "../types";
import { extractJson, truncate, type Logger } from "../util";
import { executeTool, type ToolCall, type ToolContext, type ToolObservation } from "./tools";

const actionSchema = z.object({
  thought: z.string().max(1_500).optional().default(""),
  actions: z
    .array(
      z.object({
        tool: z.string().min(1),
        args: z.record(z.unknown()).optional().default({}),
      }),
    )
    .optional()
    .default([]),
  done: z.boolean().optional().default(false),
  summary: z.string().max(1_000).optional(),
});

export interface AgentRunInput {
  role: ModelRole;
  kind: string;
  system: string;
  user: string;
  allowedTools: ReadonlySet<string>;
  toolContext: ToolContext;
  transport: ModelRouter;
  logger: Logger;
  maxTurns: number;
  maxToolsPerTurn: number;
  /** Absolute epoch ms after which the agent stops taking new turns. */
  deadline: number;
  signal?: AbortSignal;
  label: string;
  /** Return true when the parsed JSON is the agent's final answer. */
  isFinal?: (parsed: Record<string, unknown>) => boolean;
}

export interface AgentRunResult {
  final?: Record<string, unknown>;
  lastText: string;
  turns: number;
  toolCalls: number
  observations: ToolObservation[];
  stoppedReason: string;
}

export function observationsMessage(observations: ToolObservation[]): string {
  return [
    "## Observations from your last actions",
    ...observations.map((entry) => `${entry.ok ? "ok" : "fail"} ${entry.tool}: ${entry.detail}`),
    "",
    "Return the next JSON action object. Use the tools to keep investigating. When you have enough evidence, give your final answer.",
  ].join("\n\n");
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const { logger } = input;
  let lastText = "";
  let turns = 0;
  let toolCalls = 0;
  const observations: ToolObservation[] = [];
  let stoppedReason = "turn budget exhausted";
  let nextUser = input.user;

  for (let turn = 1; turn <= Math.max(1, input.maxTurns); turn += 1) {
    const remaining = input.deadline - Date.now();
    if (remaining < 8_000) {
      stoppedReason = "deadline reached";
      break;
    }
    if (input.signal?.aborted) {
      stoppedReason = "aborted";
      break;
    }
    turns = turn;
    let raw: string;
    try {
      const response = await input.transport.complete({
        role: input.role,
        kind: input.kind,
        system: input.system,
        user: nextUser,
        expectJson: true,
        maxTokens: undefined,
        timeoutMs: Math.max(10_000, Math.min(remaining - 2_000, 90_000)),
        retries: 1,
        signal: input.signal,
        label: `${input.label}-t${turn}`,
      });
      raw = response.text;
    } catch (error) {
      stoppedReason = `model call failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.warn(`${input.label}: model call failed`, { error: error instanceof Error ? error.message : String(error) });
      break;
    }
    lastText = raw;

    let parsed: z.infer<typeof actionSchema>;
    let json: Record<string, unknown>;
    try {
      json = extractJson(raw) as Record<string, unknown>;
      parsed = actionSchema.parse(json);
    } catch (error) {
      stoppedReason = `invalid JSON: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
      break;
    }

    if (input.isFinal?.(json)) {
      stoppedReason = "final answer";
      return { final: json, lastText, turns, toolCalls, observations, stoppedReason };
    }

    const calls: ToolCall[] = (parsed.actions ?? []).slice(0, Math.max(1, input.maxToolsPerTurn)).map((entry) => ({
      tool: entry.tool,
      args: (entry.args ?? {}) as Record<string, unknown>,
    }));

    const turnObservations: ToolObservation[] = [];
    for (const call of calls) {
      if (!input.allowedTools.has(call.tool)) {
        turnObservations.push({
          tool: call.tool,
          ok: false,
          summary: `${call.tool} is not available in this phase`,
          detail: `Allowed tools: ${[...input.allowedTools].join(", ")}.`,
          durationMs: 0,
        });
        continue;
      }
      const result = await executeTool(call, input.toolContext);
      toolCalls += 1;
      turnObservations.push(result);
      observations.push(result);
      if (!result.ok) logger.debug(`${input.label}: ${call.tool} failed — ${result.summary}`);
    }

    if (parsed.done || calls.some((call) => call.tool === "finish")) {
      stoppedReason = parsed.summary ? `finished: ${truncate(parsed.summary, 200)}` : "finished";
      return { lastText, turns, toolCalls, observations, stoppedReason };
    }

    nextUser = observationsMessage(turnObservations.length > 0 ? turnObservations : [
      { tool: "none", ok: false, summary: "no actions", detail: "You returned no actions. Use a tool or give your final answer.", durationMs: 0 },
    ]);
  }

  return { lastText, turns, toolCalls, observations, stoppedReason };
}
