import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  cortardoAgentRuns,
  projects,
  type CortardoAssetFile,
  type CortardoBaseComponent,
  type CortardoDesignTokens,
  type CortardoQuestion,
  type CortardoScreen,
  type EditedComponent,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "./helpers";
import { generateChatTitle } from "../lib/cortardo/clarify";
import { CORTARDO_MODEL_ID, resolveModel } from "../lib/cortardo/gateway";
import { runCortardoAgent } from "../lib/cortardo/graph";
import { calcCost } from "../lib/pricing";

const INITIAL_BUILD_TITLE = "Initial Build";

/** Verifies the authenticated user owns the project the run belongs to. */
async function assertProjectAccess(req: Request, res: Response, projectId: string): Promise<boolean> {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const p = project[0];
  if (!p) {
    res.status(404).json({ message: "Project not found" });
    return false;
  }
  const user = (req as any).user;
  if (!user || p.ownerId !== user.id) {
    res.status(403).json({ message: "You do not have access to this project" });
    return false;
  }
  return true;
}

const createRunSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(4000),
});

const answersSchema = z.object({
  answers: z.record(z.string()).default({}),
  final: z.boolean().optional(),
});

export function registerCortardoAgentRoutes(app: Express) {
  // Start a Cortardo Agent run: creates a run and returns its id. The first run for a
  // project is always titled "Initial Build"; every later run gets a short
  // title generated in the background by a small model.
  app.post("/api/cortardo-agent/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = createRunSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.issues });
      }
      const projectId = parsed.data.projectId;
      if (!(await assertProjectAccess(req, res, projectId))) return;

      // Is this the first run for the project?
      const existing = await db
        .select({ id: cortardoAgentRuns.id })
        .from(cortardoAgentRuns)
        .where(eq(cortardoAgentRuns.projectId, projectId))
        .limit(1);
      const isFirst = existing.length === 0;

      const [run] = await db
        .insert(cortardoAgentRuns)
        .values({
          projectId,
          prompt: parsed.data.prompt,
          title: isFirst ? INITIAL_BUILD_TITLE : null,
          status: "thinking",
        })
        .returning();

      // Background: generate a short title for non-initial chats, in parallel
      // with the agent run. Fire-and-forget; updates the run when ready.
      if (!isFirst) {
        generateChatTitle(parsed.data.prompt)
          .then((title) =>
            db
              .update(cortardoAgentRuns)
              .set({ title, updatedAt: new Date() })
              .where(eq(cortardoAgentRuns.id, run.id)),
          )
          .catch(() => {});
      }

      return res.status(201).json({ runId: run.id, isFirst });
    } catch (err: any) {
      console.error("[cortardo-agent] create run error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to start Cortardo Agent run" });
    }
  });

  // List all chat runs for a project (used by the agent panel chat switcher).
  app.get("/api/cortardo-agent/runs/list", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = String(req.query.projectId || "");
      if (!projectId) return res.status(400).json({ message: "projectId required" });
      if (!(await assertProjectAccess(req, res, projectId))) return;
      const runs = await db
        .select({
          id: cortardoAgentRuns.id,
          title: cortardoAgentRuns.title,
          prompt: cortardoAgentRuns.prompt,
          status: cortardoAgentRuns.status,
          createdAt: cortardoAgentRuns.createdAt,
          reasoning: cortardoAgentRuns.reasoning,
          plan: cortardoAgentRuns.plan,
          reasoningMs: cortardoAgentRuns.reasoningMs,
        })
        .from(cortardoAgentRuns)
        .where(eq(cortardoAgentRuns.projectId, projectId))
        .orderBy(cortardoAgentRuns.createdAt);
      return res.json(
        runs.map((r) => ({
          id: r.id,
          title: r.title || (r.prompt ? r.prompt.slice(0, 40) : "New chat"),
          prompt: r.prompt,
          status: r.status,
          createdAt: r.createdAt,
          // Estimated credit cost of the run (same estimator used across the
          // app): reasoning + plan output at the run's model pricing.
          credits: calcCost(
            CORTARDO_MODEL_ID,
            r.prompt.length,
            (r.reasoning?.length ?? 0) + (r.plan?.length ?? 0) + (r.reasoningMs ?? 0) / 8,
          ).credits,
        })),
      );
    } catch (err: any) {
      console.error("[cortardo-agent] list runs error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to load chats" });
    }
  });

  // Fetch the latest run for a project (used to restore an in-progress or
  // completed Cortardo Agent brief after a page reload, so work is never lost).
  app.get("/api/cortardo-agent/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = String(req.query.projectId || "");
      if (!projectId) return res.status(400).json({ message: "projectId required" });
      if (!(await assertProjectAccess(req, res, projectId))) return;
      const [run] = await db
        .select()
        .from(cortardoAgentRuns)
        .where(eq(cortardoAgentRuns.projectId, projectId))
        .orderBy(desc(cortardoAgentRuns.createdAt))
        .limit(1);
      if (!run) return res.json(null);
      return res.json({
        id: run.id,
        title: run.title,
        prompt: run.prompt,
        questions: run.questions,
        answers: run.answers,
        reasoning: run.reasoning,
        plan: run.plan,
        reasoningMs: run.reasoningMs,
        screens: run.screens,
        designTokens: run.designTokens,
        assets: run.assets,
        components: run.components,
        editedComponents: run.editedComponents,
        status: run.status,
      });
    } catch (err: any) {
      console.error("[cortardo-agent] get run error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to load run" });
    }
  });

  // Fetch a specific chat run by id.
  app.get("/api/cortardo-agent/runs/:runId", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const [run] = await db.select().from(cortardoAgentRuns).where(eq(cortardoAgentRuns.id, runId)).limit(1);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (!(await assertProjectAccess(req, res, run.projectId))) return;
      return res.json({
        id: run.id,
        title: run.title,
        prompt: run.prompt,
        questions: run.questions,
        answers: run.answers,
        reasoning: run.reasoning,
        plan: run.plan,
        reasoningMs: run.reasoningMs,
        screens: run.screens,
        designTokens: run.designTokens,
        assets: run.assets,
        components: run.components,
        editedComponents: run.editedComponents,
        status: run.status,
      });
    } catch (err: any) {
      console.error("[cortardo-agent] get run by id error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to load run" });
    }
  });

  // Run event stream (SSE). The agent is a LangGraph state machine — each
  // stage is a graph node: reasoning+plan -> artifacts (screens/tokens/assets)
  // -> base-component selection -> questions. Reasoning deltas stream live via
  // the graph's custom stream mode; node results arrive as "updates".
  app.get("/api/cortardo-agent/runs/:runId/events", async (req: Request, res: Response) => {
    const runId = String(req.params.runId);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (event: Record<string, unknown>) => {
      try {
        res.write("data: " + JSON.stringify(event) + "\n\n");
      } catch {}
    };

    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {}
    }, 15000);

    const close = (err?: unknown) => {
      clearInterval(heartbeat);
      if (err) console.error("[cortardo-agent] stream error:", err);
      try {
        res.end();
      } catch {}
    };

    req.on("close", () => close());

    // Persist a partial patch to the run. Called incrementally as each graph
    // stage completes so that reasoning + plan are saved to the DB as soon as
    // they exist — not only at the very end. This guarantees a reload or
    // chat-switch mid-run restores the full conversation instead of just the
    // answered questions card.
    const persistRun = (patch: Partial<typeof cortardoAgentRuns.$inferInsert>) =>
      db.update(cortardoAgentRuns).set({ ...patch, updatedAt: new Date() }).where(eq(cortardoAgentRuns.id, runId));

    try {
      const [run] = await db.select().from(cortardoAgentRuns).where(eq(cortardoAgentRuns.id, runId));
      if (!run) {
        write({ type: "error", message: "Run not found" });
        return close();
      }

      // Honor the user's chosen model + reasoning effort for this run. The UI
      // sends a friendly model name; resolve it to a valid gateway model id.
      const requestedModel = typeof req.query.model === "string" ? resolveModel(req.query.model) : undefined;
      const requestedReasoning = typeof req.query.reasoning === "string" ? req.query.reasoning : undefined;

      for await (const step of runCortardoAgent({
        prompt: run.prompt,
        model: requestedModel,
        reasoning: requestedReasoning,
      })) {
        if (step.mode === "custom") {
          // Live reasoning deltas pushed from the reasoning+plan node.
          const chunk = step.chunk as { type?: string; text?: string };
          if (chunk?.type === "reasoning" && typeof chunk.text === "string" && chunk.text.length > 0) {
            write({ type: "reasoning", text: chunk.text });
          }
          // Live component-edit progress from the parallel edit agents.
          if (chunk?.type === "componentEdit") {
            write(chunk as Record<string, unknown>);
          }
          continue;
        }

        // A graph node finished — emit its result to the client and persist it.
        switch (step.node) {
          case "reasoningPlan": {
            const u = step.update as { reasoningText?: string; plan?: string; reasoningMs?: number };
            const reasoningText = u.reasoningText ?? "";
            const plan = u.plan ?? "";
            const reasoningMs = u.reasoningMs ?? 0;
            if (plan) write({ type: "plan", text: plan });
            await persistRun({ reasoning: reasoningText, plan, reasoningMs });
            break;
          }
          case "artifacts": {
            const u = step.update as { screens?: CortardoScreen[]; designTokens?: CortardoDesignTokens; assets?: CortardoAssetFile[] };
            await persistRun({ screens: u.screens, designTokens: u.designTokens, assets: u.assets });
            write({ type: "artifacts", screens: u.screens, designTokens: u.designTokens, assets: u.assets });
            break;
          }
          case "selectComponents": {
            const u = step.update as { components?: CortardoBaseComponent[] };
            await persistRun({ components: u.components });
            write({ type: "components", components: u.components });
            break;
          }
          case "editComponent": {
            const u = step.update as { editedComponents?: EditedComponent[] };
            const items = u.editedComponents ?? [];
            // Persist incrementally: fold each finished component into the run.
            const [run] = await db
              .select({ editedComponents: cortardoAgentRuns.editedComponents })
              .from(cortardoAgentRuns)
              .where(eq(cortardoAgentRuns.id, runId));
            await persistRun({
              editedComponents: [...(run?.editedComponents ?? []), ...items],
            });
            for (const item of items) write({ type: "componentEdited", component: item });
            break;
          }
          case "generateQuestions": {
            const u = step.update as { questions?: CortardoQuestion[] };
            await db
              .update(cortardoAgentRuns)
              .set({ questions: u.questions, status: "awaiting_answers", updatedAt: new Date() })
              .where(eq(cortardoAgentRuns.id, runId));
            write({ type: "questions", questions: u.questions });
            break;
          }
        }
      }

      write({ type: "done" });
      return close();
    } catch (err: any) {
      const message = err?.message || "Cortardo Agent run failed";
      console.error("[cortardo-agent] run error:", message);
      try {
        await db.update(cortardoAgentRuns).set({ status: "error" }).where(eq(cortardoAgentRuns.id, runId));
      } catch {}
      write({ type: "error", message });
      return close();
    }
  });

  // Submit answers to the clarification questions.
  app.post("/api/cortardo-agent/runs/:runId/answers", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const parsed = answersSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid answers" });
      }
      const final = parsed.data.final ?? true;
      const set: { answers: Record<string, string>; updatedAt: Date; status?: string } = {
        answers: parsed.data.answers,
        updatedAt: new Date(),
      };
      if (final) set.status = "answered";
      const [run] = await db
        .update(cortardoAgentRuns)
        .set(set)
        .where(eq(cortardoAgentRuns.id, runId))
        .returning();
      if (!run) return res.status(404).json({ message: "Run not found" });
      return res.json({ ok: true, runId });
    } catch (err: any) {
      console.error("[cortardo-agent] answers error:", err?.message || err);
      return res.status(500).json({ message: err?.message || "Failed to save answers" });
    }
  });
}
