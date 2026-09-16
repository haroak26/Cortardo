import type { Express, Request, Response } from "express";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import {
  botExclusions,
  botSettings,
  createBotExclusionSchema,
  createBotLearningSchema,
  createBotRuleSchema,
  repositories,
  repositoryLearnings,
  repositoryRules,
  updateBotExclusionSchema,
  updateBotLearningSchema,
  updateBotRuleSchema,
  updateBotSettingsSchema,
  type User,
} from "@shared/schema";
import { normalizeBotSettings } from "@shared/bot";
import { db } from "../db";
import { storage } from "../storage";
import { apiRateLimiter, audit, requireAuth } from "./helpers";
import { ensureBotSchema } from "../lib/bot/schema";

async function ready(): Promise<void> {
  await ensureBotSchema();
}

function currentUser(req: Request): User {
  return req.user as User;
}

async function resolveWorkspaceAccess(
  req: Request,
  res: Response,
  workspaceId?: string | null,
): Promise<string | null> {
  const user = currentUser(req);
  const resolved = workspaceId || user.lastWorkspaceId || "";
  if (!resolved) {
    res.status(400).json({ message: "No workspace selected" });
    return null;
  }
  const access = await storage.canAccessWorkspace(user.id, resolved);
  if (!access.allowed) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  return resolved;
}

async function resolveScope(
  res: Response,
  workspaceId: string,
  repositoryId: string | null | undefined,
): Promise<{ repositoryId: string | null; scope: string } | null> {
  if (!repositoryId) return { repositoryId: null, scope: "All repositories" };
  const repository = await storage.getRepositoryById(repositoryId);
  if (!repository || repository.workspaceId !== workspaceId) {
    res.status(404).json({ message: "Repository not found in this workspace" });
    return null;
  }
  return { repositoryId: repository.id, scope: repository.fullName };
}

/**
 * Rows visible from a workspace. With a repositoryId, that repository's rows
 * plus workspace-wide rows; without, every row in the workspace.
 */
function visibleRuleRows(workspaceId: string, repositoryId: string | null) {
  if (!repositoryId) return eq(repositoryRules.workspaceId, workspaceId);
  return and(
    eq(repositoryRules.workspaceId, workspaceId),
    or(isNull(repositoryRules.repositoryId), eq(repositoryRules.repositoryId, repositoryId)),
  );
}

function visibleLearningRows(workspaceId: string, repositoryId: string | null) {
  if (!repositoryId) return eq(repositoryLearnings.workspaceId, workspaceId);
  return and(
    eq(repositoryLearnings.workspaceId, workspaceId),
    or(isNull(repositoryLearnings.repositoryId), eq(repositoryLearnings.repositoryId, repositoryId)),
  );
}

export function registerBotRoutes(app: Express): void {
  // ── Rules ─────────────────────────────────────────────────────────────
  app.get("/api/bot/rules", requireAuth, async (req: Request, res: Response) => {
    try {
      await ready();
      const workspaceId = await resolveWorkspaceAccess(req, res, req.query.workspaceId as string | undefined);
      if (!workspaceId) return;
      const repositoryId = typeof req.query.repositoryId === "string" ? req.query.repositoryId : null;
      const rows = await db
        .select()
        .from(repositoryRules)
        .where(visibleRuleRows(workspaceId, repositoryId))
        .orderBy(desc(repositoryRules.createdAt));
      return res.json(rows);
    } catch (error: any) {
      console.error("[bot] rules list error:", error?.message || error);
      return res.status(500).json({ message: "Failed to list rules" });
    }
  });

  app.post("/api/bot/rules", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const parsed = createBotRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
      }
      const workspaceId = await resolveWorkspaceAccess(req, res, parsed.data.workspaceId);
      if (!workspaceId) return;
      const scope = await resolveScope(res, workspaceId, parsed.data.repositoryId);
      if (!scope) return;

      const [row] = await db
        .insert(repositoryRules)
        .values({
          workspaceId,
          repositoryId: scope.repositoryId,
          instruction: parsed.data.instruction,
          glob: parsed.data.glob?.trim() ? parsed.data.glob.trim() : null,
          scope: scope.scope,
          enabled: parsed.data.enabled ?? true,
          createdBy: currentUser(req).id,
        })
        .returning();
      await audit(req, "bot.rule.create", `rule=${row.id}`);
      return res.status(201).json(row);
    } catch (error: any) {
      console.error("[bot] rule create error:", error?.message || error);
      return res.status(500).json({ message: "Failed to create rule" });
    }
  });

  app.patch("/api/bot/rules/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const parsed = updateBotRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
      }
      const [existing] = await db
        .select()
        .from(repositoryRules)
        .where(eq(repositoryRules.id, String(req.params.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Rule not found" });
      const workspaceId = await resolveWorkspaceAccess(req, res, existing.workspaceId);
      if (!workspaceId) return;

      const patch: Record<string, unknown> = {};
      if (parsed.data.instruction !== undefined) patch.instruction = parsed.data.instruction;
      if (parsed.data.glob !== undefined) patch.glob = parsed.data.glob?.trim() ? parsed.data.glob.trim() : null;
      if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
      if (parsed.data.repositoryId !== undefined) {
        const scope = await resolveScope(res, workspaceId, parsed.data.repositoryId);
        if (!scope) return;
        patch.repositoryId = scope.repositoryId;
        patch.scope = scope.scope;
      }
      patch.updatedAt = new Date();

      const [row] = await db
        .update(repositoryRules)
        .set(patch)
        .where(eq(repositoryRules.id, existing.id))
        .returning();
      return res.json(row);
    } catch (error: any) {
      console.error("[bot] rule update error:", error?.message || error);
      return res.status(500).json({ message: "Failed to update rule" });
    }
  });

  app.delete("/api/bot/rules/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const [existing] = await db
        .select()
        .from(repositoryRules)
        .where(eq(repositoryRules.id, String(req.params.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Rule not found" });
      const workspaceId = await resolveWorkspaceAccess(req, res, existing.workspaceId);
      if (!workspaceId) return;
      await db.delete(repositoryRules).where(eq(repositoryRules.id, existing.id));
      await audit(req, "bot.rule.delete", `rule=${existing.id}`);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("[bot] rule delete error:", error?.message || error);
      return res.status(500).json({ message: "Failed to delete rule" });
    }
  });

  // ── Learnings ─────────────────────────────────────────────────────────
  app.get("/api/bot/learnings", requireAuth, async (req: Request, res: Response) => {
    try {
      await ready();
      const workspaceId = await resolveWorkspaceAccess(req, res, req.query.workspaceId as string | undefined);
      if (!workspaceId) return;
      const repositoryId = typeof req.query.repositoryId === "string" ? req.query.repositoryId : null;
      const rows = await db
        .select()
        .from(repositoryLearnings)
        .where(visibleLearningRows(workspaceId, repositoryId))
        .orderBy(desc(repositoryLearnings.createdAt));
      return res.json(rows);
    } catch (error: any) {
      console.error("[bot] learnings list error:", error?.message || error);
      return res.status(500).json({ message: "Failed to list learnings" });
    }
  });

  app.post("/api/bot/learnings", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const parsed = createBotLearningSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
      }
      const workspaceId = await resolveWorkspaceAccess(req, res, parsed.data.workspaceId);
      if (!workspaceId) return;
      const scope = await resolveScope(res, workspaceId, parsed.data.repositoryId);
      if (!scope) return;

      const [row] = await db
        .insert(repositoryLearnings)
        .values({
          workspaceId,
          repositoryId: scope.repositoryId,
          text: parsed.data.text,
          scope: scope.scope,
          source: parsed.data.source ?? "manual",
          active: parsed.data.active ?? true,
          createdBy: currentUser(req).id,
        })
        .returning();
      await audit(req, "bot.learning.create", `learning=${row.id}`);
      return res.status(201).json(row);
    } catch (error: any) {
      console.error("[bot] learning create error:", error?.message || error);
      return res.status(500).json({ message: "Failed to save learning" });
    }
  });

  app.patch("/api/bot/learnings/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const parsed = updateBotLearningSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
      }
      const [existing] = await db
        .select()
        .from(repositoryLearnings)
        .where(eq(repositoryLearnings.id, String(req.params.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Learning not found" });
      const workspaceId = await resolveWorkspaceAccess(req, res, existing.workspaceId);
      if (!workspaceId) return;

      const patch: Record<string, unknown> = {};
      if (parsed.data.text !== undefined) patch.text = parsed.data.text;
      if (parsed.data.active !== undefined) patch.active = parsed.data.active;
      if (parsed.data.repositoryId !== undefined) {
        const scope = await resolveScope(res, workspaceId, parsed.data.repositoryId);
        if (!scope) return;
        patch.repositoryId = scope.repositoryId;
        patch.scope = scope.scope;
      }
      patch.updatedAt = new Date();

      const [row] = await db
        .update(repositoryLearnings)
        .set(patch)
        .where(eq(repositoryLearnings.id, existing.id))
        .returning();
      return res.json(row);
    } catch (error: any) {
      console.error("[bot] learning update error:", error?.message || error);
      return res.status(500).json({ message: "Failed to update learning" });
    }
  });

  app.delete("/api/bot/learnings/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const [existing] = await db
        .select()
        .from(repositoryLearnings)
        .where(eq(repositoryLearnings.id, String(req.params.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Learning not found" });
      const workspaceId = await resolveWorkspaceAccess(req, res, existing.workspaceId);
      if (!workspaceId) return;
      await db.delete(repositoryLearnings).where(eq(repositoryLearnings.id, existing.id));
      await audit(req, "bot.learning.delete", `learning=${existing.id}`);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("[bot] learning delete error:", error?.message || error);
      return res.status(500).json({ message: "Failed to delete learning" });
    }
  });

  // ── Exclusions ────────────────────────────────────────────────────────
  app.get("/api/bot/exclusions", requireAuth, async (req: Request, res: Response) => {
    try {
      await ready();
      const workspaceId = await resolveWorkspaceAccess(req, res, req.query.workspaceId as string | undefined);
      if (!workspaceId) return;
      const rows = await db
        .select({ exclusion: botExclusions, repositoryFullName: repositories.fullName })
        .from(botExclusions)
        .leftJoin(repositories, eq(botExclusions.repositoryId, repositories.id))
        .where(eq(botExclusions.workspaceId, workspaceId))
        .orderBy(desc(botExclusions.createdAt));
      return res.json(
        rows.map(({ exclusion, repositoryFullName }) => ({
          ...exclusion,
          scope: repositoryFullName ?? "All repositories",
        })),
      );
    } catch (error: any) {
      console.error("[bot] exclusions list error:", error?.message || error);
      return res.status(500).json({ message: "Failed to list exclusions" });
    }
  });

  app.post("/api/bot/exclusions", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const parsed = createBotExclusionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
      }
      const workspaceId = await resolveWorkspaceAccess(req, res, parsed.data.workspaceId);
      if (!workspaceId) return;
      const scope = await resolveScope(res, workspaceId, parsed.data.repositoryId);
      if (!scope) return;

      const [row] = await db
        .insert(botExclusions)
        .values({
          workspaceId,
          repositoryId: scope.repositoryId,
          pattern: parsed.data.pattern,
          note: parsed.data.note?.trim() ? parsed.data.note.trim() : null,
          enabled: parsed.data.enabled ?? true,
          createdBy: currentUser(req).id,
        })
        .returning();
      await audit(req, "bot.exclusion.create", `exclusion=${row.id}`);
      return res.status(201).json({ ...row, scope: scope.scope });
    } catch (error: any) {
      console.error("[bot] exclusion create error:", error?.message || error);
      return res.status(500).json({ message: "Failed to add exclusion" });
    }
  });

  app.patch("/api/bot/exclusions/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const parsed = updateBotExclusionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
      }
      const [existing] = await db
        .select()
        .from(botExclusions)
        .where(eq(botExclusions.id, String(req.params.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Exclusion not found" });
      const workspaceId = await resolveWorkspaceAccess(req, res, existing.workspaceId);
      if (!workspaceId) return;

      const patch: Record<string, unknown> = {};
      if (parsed.data.pattern !== undefined) patch.pattern = parsed.data.pattern;
      if (parsed.data.note !== undefined) patch.note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;
      if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
      if (parsed.data.repositoryId !== undefined) {
        const scope = await resolveScope(res, workspaceId, parsed.data.repositoryId);
        if (!scope) return;
        patch.repositoryId = scope.repositoryId;
      }
      patch.updatedAt = new Date();

      const [row] = await db
        .update(botExclusions)
        .set(patch)
        .where(eq(botExclusions.id, existing.id))
        .returning();
      const repository = row.repositoryId ? await storage.getRepositoryById(row.repositoryId) : undefined;
      return res.json({ ...row, scope: repository?.fullName ?? "All repositories" });
    } catch (error: any) {
      console.error("[bot] exclusion update error:", error?.message || error);
      return res.status(500).json({ message: "Failed to update exclusion" });
    }
  });

  app.delete("/api/bot/exclusions/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const [existing] = await db
        .select()
        .from(botExclusions)
        .where(eq(botExclusions.id, String(req.params.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Exclusion not found" });
      const workspaceId = await resolveWorkspaceAccess(req, res, existing.workspaceId);
      if (!workspaceId) return;
      await db.delete(botExclusions).where(eq(botExclusions.id, existing.id));
      await audit(req, "bot.exclusion.delete", `exclusion=${existing.id}`);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("[bot] exclusion delete error:", error?.message || error);
      return res.status(500).json({ message: "Failed to delete exclusion" });
    }
  });

  // ── Settings ──────────────────────────────────────────────────────────
  app.get("/api/bot/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      await ready();
      const workspaceId = await resolveWorkspaceAccess(req, res, req.query.workspaceId as string | undefined);
      if (!workspaceId) return;
      const [row] = await db
        .select()
        .from(botSettings)
        .where(eq(botSettings.workspaceId, workspaceId))
        .limit(1);
      return res.json(normalizeBotSettings(row));
    } catch (error: any) {
      console.error("[bot] settings read error:", error?.message || error);
      return res.status(500).json({ message: "Failed to load bot settings" });
    }
  });

  app.patch("/api/bot/settings", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      await ready();
      const parsed = updateBotSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
      }
      const workspaceId = await resolveWorkspaceAccess(req, res, parsed.data.workspaceId);
      if (!workspaceId) return;

      const [existing] = await db
        .select()
        .from(botSettings)
        .where(eq(botSettings.workspaceId, workspaceId))
        .limit(1);
      const current = normalizeBotSettings(existing);
      const commitReviews = { ...current.commitReviews, ...(parsed.data.commitReviews ?? {}) };
      const settings = {
        instructions: parsed.data.settings?.instructions ?? current.settings.instructions,
        pullRequests: {
          ...current.settings.pullRequests,
          ...(parsed.data.settings?.pullRequests ?? {}),
        },
      };

      const [row] = await db
        .insert(botSettings)
        .values({ workspaceId, commitReviews, settings })
        .onConflictDoUpdate({
          target: botSettings.workspaceId,
          set: { commitReviews, settings, updatedAt: new Date() },
        })
        .returning();
      return res.json(normalizeBotSettings(row));
    } catch (error: any) {
      console.error("[bot] settings update error:", error?.message || error);
      return res.status(500).json({ message: "Failed to save bot settings" });
    }
  });
}
