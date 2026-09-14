import { END, START, StateGraph } from "@langchain/langgraph";
import type { CortadoConfig } from "../config";
import type { CortadoResult, PipelineStage, StageEvent } from "../types";
import type { ModelRouter } from "../models/router";
import type { Sandbox } from "../sandbox";
import type { Clock } from "../util/clock";
import type { Logger } from "../util/logger";
import { analyzeChange } from "../stages/change-intelligence";
import { runSwarm } from "../stages/swarm";
import { mergeEvidence } from "../stages/evidence-merge";
import { judgeCandidates } from "../stages/judge";
import { proveCandidates, type RepoCommands } from "../stages/proof";
import { repairFindings } from "../stages/repair";
import { verifyRepairs } from "../stages/verify";
import { reviewFindings } from "../stages/final-review";
import { assembleResult, buildFindings } from "../result";
import { CortadoStateAnnotation, type CortadoState, type CortadoStateUpdate } from "./state";

export interface GraphDeps {
  config: CortadoConfig;
  models: ModelRouter;
  sandbox: Sandbox;
  commands: RepoCommands;
  logger: Logger;
  clock: Clock;
}

export function buildCortadoGraph(deps: GraphDeps) {
  const now = () => deps.clock.now();

  const stageNode = (
    stage: PipelineStage,
    run: (state: CortadoState) => Promise<Partial<CortadoStateUpdate>>,
    options: { critical?: boolean } = {},
  ) => {
    return async (state: CortadoState): Promise<Partial<CortadoStateUpdate>> => {
      const started = now();
      try {
        const update = await run(state);
        const duration = now() - started;
        const event: StageEvent = { stage, status: "completed", at: started, durationMs: duration };
        const updateEvents = Array.isArray(update.events) ? (update.events as StageEvent[]) : [];
        const updateTimings = (update.timings ?? {}) as Partial<Record<PipelineStage, number>>;
        const resultUpdate =
          (update.result as CortadoResult | null | undefined) ?? state.result ?? undefined;
        if (resultUpdate) {
          resultUpdate.timings = { ...resultUpdate.timings, [stage]: duration };
          resultUpdate.events = [...resultUpdate.events, event];
        }
        return {
          ...update,
          events: [event, ...updateEvents],
          timings: { ...updateTimings, [stage]: duration },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.error(`stage failed: ${stage}`, { error: message });
        const duration = now() - started;
        const failedEvent: StageEvent = { stage, status: "failed", at: started, durationMs: duration, detail: message };
        if (state.result) {
          state.result.timings = { ...state.result.timings, [stage]: duration };
          state.result.events = [...state.result.events, failedEvent];
        }
        return {
          ...(options.critical ? { status: "failed" as const, error: message } : {}),
          stageErrors: [`${stage}: ${message}`],
          events: [failedEvent],
          timings: { [stage]: duration },
        };
      }
    };
  };

  const graph = new StateGraph(CortadoStateAnnotation)
    .addNode(
      "change_intelligence",
      stageNode(
        "change_intelligence",
        async (state) => ({ context: analyzeChange(state.input) }),
        { critical: true },
      ),
    )
    .addNode(
      "sandbox_setup",
      stageNode("sandbox_setup", async () => {
        await deps.sandbox.setup();
        await deps.sandbox.warm();
        return {};
      }),
    )
    .addNode(
      "swarm",
      stageNode("swarm", async (state) => {
        if (!state.context) return {};
        const report = await runSwarm(state.context, state.input, deps.models, deps.config, deps.logger);
        return { hypotheses: report.hypotheses };
      }),
    )
    .addNode(
      "evidence_merge",
      stageNode("evidence_merge", async (state) => {
        if (!state.context) return {};
        const { candidates } = mergeEvidence(state.hypotheses, state.context, deps.config);
        return { candidates };
      }),
    )
    .addNode(
      "judge",
      stageNode("judge", async (state) => {
        if (!state.context) return {};
        const report = await judgeCandidates(state.candidates, state.context, deps.models, deps.config, deps.logger);
        return { decisions: report.decisions };
      }),
    )
    .addNode(
      "proof",
      stageNode("proof", async (state) => {
        if (!state.context) return {};
        const proofs = await proveCandidates(state.candidates, state.decisions, state.context, {
          sandbox: deps.sandbox,
          config: deps.config,
          commands: deps.commands,
          logger: deps.logger,
          now,
        });
        return { proofs };
      }),
    )
    .addNode(
      "repair",
      stageNode("repair", async (state) => {
        if (!state.context) return {};
        const repairs = await repairFindings(state.proofs, state.candidates, state.context, {
          sandbox: deps.sandbox,
          models: deps.models,
          config: deps.config,
          commands: deps.commands,
          logger: deps.logger,
          now,
        });
        return { repairs };
      }),
    )
    .addNode(
      "verify",
      stageNode("verify", async (state) => {
        if (!state.context) return {};
        const reports = await verifyRepairs(state.repairs, state.candidates, state.proofs, state.context, {
          sandbox: deps.sandbox,
          config: deps.config,
          commands: deps.commands,
          logger: deps.logger,
          now,
        });
        return { verifications: Object.fromEntries(reports) };
      }),
    )
    .addNode(
      "collect_findings",
      stageNode("findings", async (state) => ({
        findings: buildFindings(state.candidates, state.proofs, state.repairs, state.verifications),
      })),
    )
    .addNode(
      "final_review",
      stageNode("final_review", async (state) => {
        if (!state.context) return {};
        const reviews = await reviewFindings(state.findings, state.context, {
          models: deps.models,
          config: deps.config,
          logger: deps.logger,
        });
        return { reviews };
      }),
    )
    .addNode(
      "assemble",
      stageNode("assemble", async (state) => {
        const built = assembleResult({
          runId: state.runId,
          input: { id: state.input.id, title: state.input.title },
          context: state.context,
          candidates: state.candidates,
          decisions: state.decisions,
          proofs: state.proofs,
          repairs: state.repairs,
          verifications: state.verifications,
          reviews: state.reviews,
          events: state.events,
          timings: state.timings,
          usage: deps.models.usage(),
          dryRun: deps.models.dryRun,
          startedAt: state.startedAt,
          endedAt: now(),
          status: state.status,
          error: state.error,
        });
        return { result: built };
      }),
    )
    .addNode(
      "cleanup",
      stageNode("cleanup", async () => {
        await deps.sandbox.cleanup();
        return {};
      }),
    );

  graph
    .addEdge(START, "change_intelligence")
    .addConditionalEdges("change_intelligence", (state: CortadoState) => (state.status === "failed" ? "cleanup" : "sandbox_setup"), {
      cleanup: "cleanup",
      sandbox_setup: "sandbox_setup",
    })
    .addEdge("sandbox_setup", "swarm")
    .addEdge("swarm", "evidence_merge")
    .addEdge("evidence_merge", "judge")
    .addConditionalEdges(
      "judge",
      (state: CortadoState) =>
        state.decisions.some((decision) => decision.verdict === "PROVE") ? "proof" : "findings",
      { proof: "proof", findings: "collect_findings" },
    )
    .addConditionalEdges(
      "proof",
      (state: CortadoState) =>
        state.proofs.some((proof) => proof.status === "confirmed") ? "repair" : "findings",
      { repair: "repair", findings: "collect_findings" },
    )
    .addConditionalEdges(
      "repair",
      (state: CortadoState) =>
        state.repairs.some((repair) => repair.exit === "VERIFIED") ? "verify" : "findings",
      { verify: "verify", findings: "collect_findings" },
    )
    .addEdge("verify", "collect_findings")
    .addEdge("collect_findings", "final_review")
    .addEdge("final_review", "assemble")
    .addEdge("assemble", "cleanup")
    .addEdge("cleanup", END);

  return graph.compile();
}

export type CompiledCortadoGraph = ReturnType<typeof buildCortadoGraph>;
