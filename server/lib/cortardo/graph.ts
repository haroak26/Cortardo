import { Annotation, Command, END, Send, START, StateGraph, getWriter } from "@langchain/langgraph";
import type {
  CortardoAssetFile,
  CortardoBaseComponent,
  CortardoDesignTokens,
  CortardoQuestion,
  CortardoScreen,
  EditedComponent,
} from "@shared/schema";
import { generateAssets, generateDesignTokens, generateScreens } from "./artifacts";
import { generateQuestions } from "./clarify";
import { selectBaseComponents, streamEditComponent } from "./components";
import { PLAN_SYSTEM, streamReasoning } from "./gateway";

/**
 * Cortardo Agent — orchestrated as a LangGraph state machine so each stage of
 * the build is a discrete, controllable node:
 *
 *   reasoning+plan → artifacts (screens, design tokens, assets)
 *   → base-component selection → [parallel component-edit agents] → questions
 *
 * Reasoning deltas and each component's rewrite stream through LangGraph's
 * "custom" stream mode (getWriter) so the UI can reveal the build live, while
 * every stage emits its full result as a node update. The component-edit
 * stage fans out one sub-agent per selected base component via `Send`, runs
 * them in parallel, and re-joins before the clarification questions.
 */

/** Throttle between reasoning chunks so the SSE stream doesn't flood the client. */
const CHUNK_DELAY_MS = 12;

export const CortardoAgentState = Annotation.Root({
  prompt: Annotation<string>(),
  model: Annotation<string | undefined>(),
  reasoning: Annotation<string | undefined>(),
  reasoningText: Annotation<string>(),
  plan: Annotation<string>(),
  reasoningMs: Annotation<number>(),
  screens: Annotation<CortardoScreen[]>(),
  designTokens: Annotation<CortardoDesignTokens | null>(),
  assets: Annotation<CortardoAssetFile[]>(),
  components: Annotation<CortardoBaseComponent[]>(),
  editedComponents: Annotation<EditedComponent[]>({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
  }),
  questions: Annotation<CortardoQuestion[] | null>(),
});

export type CortardoAgentStateType = typeof CortardoAgentState.State;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stage 1 — Reasoning + plan. Streams the model's *real* reasoning token by
 * token through the custom stream writer (the UI shows it live in the
 * "Thinking" panel), accumulates the concise "what I'll do" plan, and records
 * how long the reasoning took.
 */
async function reasoningPlanNode(state: CortardoAgentStateType, config: any) {
  const writer = getWriter(config);
  const reasoningStart = Date.now();
  let reasoningAcc = "";
  let planAcc = "";

  for await (const chunk of streamReasoning(
    [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: state.prompt },
    ],
    { model: state.model, reasoning: state.reasoning },
  )) {
    if (chunk.kind === "reasoning") {
      if (!chunk.text) continue;
      reasoningAcc += chunk.text;
      writer?.({ type: "reasoning", text: chunk.text });
      await sleep(CHUNK_DELAY_MS);
    } else if (chunk.kind === "plan") {
      planAcc += chunk.text;
    } else if (chunk.kind === "error") {
      throw new Error(chunk.text);
    }
  }

  return { reasoningText: reasoningAcc, plan: planAcc, reasoningMs: Date.now() - reasoningStart };
}

/**
 * Stage 2 — Artifacts. Derives screens, design tokens and assets from the
 * brief (+ the plan) in parallel; each generator falls back to safe defaults.
 */
async function artifactsNode(state: CortardoAgentStateType) {
  const [screens, designTokens, assets] = await Promise.all([
    generateScreens(state.prompt, state.plan),
    generateDesignTokens(state.prompt),
    generateAssets(state.prompt),
  ]);
  return { screens, designTokens, assets };
}

/** Stage 3 — Base-component selection. With the plan and design tokens set,
 * pick the base components (shadcn preset "b0") the build will be assembled
 * from. Only registry ids are ever returned.
 */
async function selectComponentsNode(state: CortardoAgentStateType) {
  const components = await selectBaseComponents(state.prompt, state.plan, state.designTokens);
  return { components };
}

/**
 * Stage 4a — Fan-out. Once the base components are chosen, dispatch one
 * parallel edit agent per component (Send). Each task gets the component's
 * registry id so its sub-agent can read the base implementation and rewrite
 * it against the design tokens + plan.
 */
function editComponentsFanOutNode(state: CortardoAgentStateType): Command {
  const tasks = (state.components ?? []).map(
    (component) =>
      new Send("editComponent", {
        component,
        prompt: state.prompt,
        plan: state.plan,
        designTokens: state.designTokens,
      }),
  );
  return new Command({ goto: tasks });
}

/**
 * Stage 4b — One parallel sub-agent per base component. Streams the rewrite
 * through the custom stream writer (tagged with the component id so the UI
 * can show each component being built live), then returns the finished file.
 */
async function editComponentNode(
  state: { component: CortardoBaseComponent; prompt: string; plan: string; designTokens: CortardoDesignTokens | null },
  config: any,
) {
  const writer = getWriter(config);
  const component = state.component;
  writer?.({ type: "componentEdit", componentId: component.id, name: component.name, status: "start" });
  try {
    for await (const step of streamEditComponent({
      component,
      prompt: state.prompt,
      plan: state.plan,
      tokens: state.designTokens,
    })) {
      if (step.type === "start") continue;
      if (step.type === "delta") {
        writer?.({ type: "componentEdit", componentId: component.id, status: "delta", delta: step.delta });
      } else if (step.type === "done") {
        writer?.({ type: "componentEdit", componentId: component.id, status: "done", source: step.source });
        return {
          editedComponents: [{ id: component.id, name: component.name, source: step.source } satisfies EditedComponent],
        };
      }
    }
  } catch (err) {
    const message = (err as Error)?.message || "Component edit failed";
    writer?.({ type: "componentEdit", componentId: component.id, status: "error", message });
    return {
      editedComponents: [
        { id: component.id, name: component.name, source: "", error: message } satisfies EditedComponent,
      ],
    };
  }
  return { editedComponents: [] as EditedComponent[] };
}

/** Stage 5 — Clarification questions (exactly 3, multiple choice). */
async function generateQuestionsNode(state: CortardoAgentStateType) {
  const questions = await generateQuestions(state.prompt);
  return { questions };
}

let compiledGraph: Awaited<ReturnType<typeof compileGraph>> | null = null;

function compileGraph() {
  const graph = new StateGraph(CortardoAgentState)
    .addNode("reasoningPlan", reasoningPlanNode)
    .addNode("artifacts", artifactsNode)
    .addNode("selectComponents", selectComponentsNode)
    .addNode("editComponentsFanOut", editComponentsFanOutNode, { ends: ["editComponent"] })
    .addNode("editComponent", editComponentNode)
    .addNode("generateQuestions", generateQuestionsNode)
    .addEdge(START, "reasoningPlan")
    .addEdge("reasoningPlan", "artifacts")
    .addEdge("artifacts", "selectComponents")
    .addEdge("selectComponents", "editComponentsFanOut")
    .addEdge("editComponent", "generateQuestions")
    .addEdge("generateQuestions", END);
  return graph.compile();
}

export function buildCortardoGraph() {
  if (!compiledGraph) compiledGraph = compileGraph();
  return compiledGraph;
}

/** Result of one streamed step of the agent graph, shaped for the SSE layer. */
export type AgentStreamStep =
  | { mode: "custom"; chunk: unknown }
  | { mode: "updates"; node: string; update: Record<string, unknown> };

export async function* runCortardoAgent(input: {
  prompt: string;
  model?: string;
  reasoning?: string;
}): AsyncGenerator<AgentStreamStep> {
  const graph = buildCortardoGraph();
  const stream = await graph.stream(
    { prompt: input.prompt, model: input.model, reasoning: input.reasoning },
    { streamMode: ["custom", "updates"] },
  );
  for await (const step of stream) {
    const [mode, value] = step as [string, unknown];
    if (mode === "custom") {
      yield { mode: "custom", chunk: value };
    } else if (mode === "updates") {
      const updates = (value ?? {}) as Record<string, Record<string, unknown>>;
      for (const [node, update] of Object.entries(updates)) {
        yield { mode: "updates", node, update: update ?? {} };
      }
    }
  }
}