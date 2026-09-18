import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import type { GithubInstallation, Repository, User } from "@shared/schema";
import {
  createIssueCommentSchema,
  createIssueSchema,
  createPullRequestReviewSchema,
  updateRepositorySchema,
  updateRepositorySelectionSchema,
} from "@shared/schema";
import { storage } from "../storage";
import { db } from "../db";
import { desc, eq } from "drizzle-orm";
import { reviewFindings } from "@shared/schema";
import { apiRateLimiter, audit, requireAuth } from "./helpers";
import { getGithubAppConfig } from "../lib/github/app";
import * as githubApi from "../lib/github/api";
import { syncInstallationRepositories } from "../lib/github/sync";
import {
  ensureCodegraphSchema,
  isCodegraphIndexing,
  markInterruptedCodegraphsAsError,
  queueCodegraphIndex,
} from "../lib/codegraph/generate";
import { handleGithubWebhook, verifyWebhookSignature } from "../lib/github/webhooks";
import {
  GITHUB_INSTALL_STATE_COOKIE,
  GITHUB_PENDING_INSTALL_COOKIE,
  createInstallState,
  createPendingInstall,
  githubCookieOptions,
  readInstallState,
  readPendingInstall,
} from "../lib/github/state";

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

async function loadRepository(
  req: Request,
  res: Response,
  repositoryId: string,
): Promise<Repository | null> {
  const repository = await storage.getRepositoryById(repositoryId);
  if (!repository) {
    res.status(404).json({ message: "Repository not found" });
    return null;
  }
  const access = await storage.canAccessWorkspace(currentUser(req).id, repository.workspaceId);
  if (!access.allowed) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  return repository;
}

function serializeInstallation(installation: GithubInstallation) {
  return {
    id: installation.id,
    installationId: installation.installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    repositorySelection: installation.repositorySelection,
    suspended: Boolean(installation.suspendedAt),
    workspaceId: installation.workspaceId,
    createdAt: installation.createdAt,
  };
}

async function linkInstallation(input: {
  installationId: string;
  workspaceId: string;
  userId: string;
  setupAction: string;
}): Promise<GithubInstallation> {
  const info = await githubApi.verifyInstallation(input.installationId);
  const existing = await storage.getGithubInstallationByInstallationId(input.installationId);

  let installation: GithubInstallation;
  if (existing) {
    if (existing.workspaceId !== input.workspaceId) {
      const access = await storage.canAccessWorkspace(input.userId, existing.workspaceId);
      if (!access.allowed) {
        throw new Error("This GitHub installation is already linked to another workspace");
      }
    }
    installation = await storage.updateGithubInstallation(existing.id, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      accountLogin: info.accountLogin,
      accountType: info.accountType,
      repositorySelection: info.repositorySelection,
      suspendedAt: info.suspendedAt,
    });
  } else {
    installation = await storage.createGithubInstallation({
      workspaceId: input.workspaceId,
      userId: input.userId,
      installationId: input.installationId,
      accountLogin: info.accountLogin,
      accountType: info.accountType,
      repositorySelection: info.repositorySelection,
      suspendedAt: info.suspendedAt,
    });
  }

  await syncInstallationRepositories(installation);
  return installation;
}

export function registerGithubRoutes(app: Express): void {
  // Create the codegraph table if needed and reconcile interrupted builds.
  void ensureCodegraphSchema()
    .then(() => markInterruptedCodegraphsAsError())
    .catch((error) => {
      console.error("[github] failed to reconcile codegraphs:", error?.message || error);
    });

  // ── Connection status ─────────────────────────────────────────────────
  app.get("/api/github/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = currentUser(req);
      const config = getGithubAppConfig();
      const workspaceId = (req.query.workspaceId as string) || user.lastWorkspaceId || "";

      let installations: GithubInstallation[] = [];
      if (workspaceId) {
        const access = await storage.canAccessWorkspace(user.id, workspaceId);
        if (access.allowed) installations = await storage.listGithubInstallations(workspaceId);
      }

      const pending = readPendingInstall(req.cookies?.[GITHUB_PENDING_INSTALL_COOKIE]);
      return res.json({
        configured: Boolean(config),
        appName: config?.name ?? null,
        appSlug: config?.slug ?? null,
        workspaceId: workspaceId || null,
        installations: installations.map(serializeInstallation),
        pendingInstallation:
          pending && pending.userId === user.id
            ? { installationId: pending.installationId, workspaceId: pending.workspaceId }
            : null,
      });
    } catch (error: any) {
      console.error("[github] status error:", error?.message || error);
      return res.status(500).json({ message: "Failed to load GitHub status" });
    }
  });

  // ── Install flow ──────────────────────────────────────────────────────
  app.get("/api/github/install-url", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const config = getGithubAppConfig();
      if (!config) return res.status(503).json({ message: "GitHub App is not configured" });
      if (!config.slug) return res.status(503).json({ message: "GITHUB_APP_SLUG is not set" });

      const workspaceId = await resolveWorkspaceAccess(req, res, req.query.workspaceId as string | undefined);
      if (!workspaceId) return;

      const { state, cookieValue } = createInstallState(workspaceId, currentUser(req).id);
      res.cookie(GITHUB_INSTALL_STATE_COOKIE, cookieValue, githubCookieOptions());
      return res.json({
        url: `https://github.com/apps/${config.slug}/installations/new?state=${encodeURIComponent(state)}`,
      });
    } catch (error: any) {
      console.error("[github] install url error:", error?.message || error);
      return res.status(500).json({ message: "Failed to start GitHub install" });
    }
  });

  // GitHub App Setup URL. GitHub redirects the user's browser here after an
  // install/update with installation_id, setup_action and our state.
  const handleGithubSetup = async (req: Request, res: Response) => {
    const redirect = (suffix: string, workspaceId?: string | null) => {
      const params = new URLSearchParams({ github: suffix });
      if (workspaceId) params.set("workspaceId", workspaceId);
      return res.redirect(`/account/integrations?${params.toString()}`);
    };

    try {
      const config = getGithubAppConfig();
      if (!config) return redirect("unconfigured");

      const installationId = String(req.query.installation_id || "");
      const setupAction = String(req.query.setup_action || "install");
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!installationId) return redirect("error");

      const statePayload = readInstallState(req.cookies?.[GITHUB_INSTALL_STATE_COOKIE]);
      const validState = Boolean(statePayload && statePayload.state === state);

      if (!req.isAuthenticated() || !req.user) {
        if (validState && statePayload) {
          res.cookie(
            GITHUB_PENDING_INSTALL_COOKIE,
            createPendingInstall({
              installationId,
              setupAction,
              workspaceId: statePayload.workspaceId,
              userId: statePayload.userId,
            }),
            githubCookieOptions(),
          );
        }
        return res.redirect(`/auth/login?next=${encodeURIComponent("/account/integrations")}`);
      }

      const user = currentUser(req);
      if (!validState || !statePayload || statePayload.userId !== user.id) {
        return redirect("state_error");
      }

      const access = await storage.canAccessWorkspace(user.id, statePayload.workspaceId);
      if (!access.allowed) return redirect("access_denied");

      await linkInstallation({
        installationId,
        workspaceId: statePayload.workspaceId,
        userId: user.id,
        setupAction,
      });
      res.clearCookie(GITHUB_INSTALL_STATE_COOKIE, githubCookieOptions());
      return redirect("connected", statePayload.workspaceId);
    } catch (error: any) {
      console.error("[github] setup error:", error?.message || error);
      return redirect("error");
    }
  };

  app.get("/api/github/setup", handleGithubSetup);
  // Legacy path kept so GitHub Apps created before the route rename (their
  // configured Setup URL still points here) keep working.
  app.get("/api/cortardo-bot/github/setup", handleGithubSetup);

  app.post("/api/github/installations/claim", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const user = currentUser(req);
      const pending = readPendingInstall(req.cookies?.[GITHUB_PENDING_INSTALL_COOKIE]);
      if (!pending || pending.userId !== user.id) {
        return res.status(400).json({ message: "No pending GitHub installation" });
      }
      const access = await storage.canAccessWorkspace(user.id, pending.workspaceId);
      if (!access.allowed) return res.status(403).json({ message: "Access denied" });

      const installation = await linkInstallation({
        installationId: pending.installationId,
        workspaceId: pending.workspaceId,
        userId: user.id,
        setupAction: pending.setupAction,
      });
      res.clearCookie(GITHUB_PENDING_INSTALL_COOKIE, githubCookieOptions());
      await audit(req, "github.installation.claim", `installation=${installation.installationId}`);
      return res.json({ installation: serializeInstallation(installation) });
    } catch (error: any) {
      console.error("[github] claim error:", error?.message || error);
      return res.status(error?.message?.includes("already linked") ? 409 : 500).json({
        message: error?.message || "Failed to link GitHub installation",
      });
    }
  });

  app.post("/api/github/installations/:id/sync", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const installation = await storage.getGithubInstallation(String(req.params.id));
      if (!installation) return res.status(404).json({ message: "Installation not found" });
      const access = await storage.canAccessWorkspace(currentUser(req).id, installation.workspaceId);
      if (!access.allowed) return res.status(403).json({ message: "Access denied" });

      const count = await syncInstallationRepositories(installation);
      return res.json({ repositories: count });
    } catch (error: any) {
      console.error("[github] sync error:", error?.message || error);
      return res.status(500).json({ message: "Failed to sync repositories" });
    }
  });

  // Repositories the installation can access, annotated with what the
  // workspace has imported and the codegraph status for each.
  app.get("/api/github/installations/:id/repositories", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const installation = await storage.getGithubInstallation(String(req.params.id));
      if (!installation) return res.status(404).json({ message: "Installation not found" });
      const access = await storage.canAccessWorkspace(currentUser(req).id, installation.workspaceId);
      if (!access.allowed) return res.status(403).json({ message: "Access denied" });

      const [remote, stored] = await Promise.all([
        githubApi.listInstallationRepositories(installation.installationId),
        storage.listRepositoriesByInstallation(installation.installationId),
      ]);
      const graphs = await storage.listRepositoryCodegraphs(stored.map((row) => row.id));
      const byExternalId = new Map(stored.filter((row) => row.externalId).map((row) => [row.externalId as string, row]));
      const byFullName = new Map(stored.map((row) => [row.fullName.toLowerCase(), row]));
      const byRepositoryId = new Map(graphs.map((graph) => [graph.repositoryId, graph]));

      return res.json({
        repositories: remote.map((repo) => {
          const row = byExternalId.get(repo.externalId) ?? byFullName.get(repo.fullName.toLowerCase());
          const graph = row ? byRepositoryId.get(row.id) : undefined;
          return {
            ...repo,
            imported: Boolean(row),
            repositoryId: row?.id ?? null,
            reviewEnabled: row?.reviewEnabled ?? false,
            codegraphStatus: graph?.status ?? (row ? "missing" : null),
            codegraphFileCount: graph?.fileCount ?? 0,
            codegraphGeneratedAt: graph?.generatedAt ?? null,
            indexing: row ? isCodegraphIndexing(row.id) : false,
          };
        }),
      });
    } catch (error: any) {
      console.error("[github] catalog error:", error?.message || error);
      if (error?.status === 404) {
        return res.status(409).json({
          message: "This GitHub installation no longer exists. Disconnect it and reconnect GitHub.",
        });
      }
      return res.status(500).json({ message: "Failed to load repositories from GitHub. Please try again." });
    }
  });

  // Replace the workspace's repository selection for an installation. Newly
  // imported repositories are queued for codegraph indexing.
  app.put("/api/github/installations/:id/repositories", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const installation = await storage.getGithubInstallation(String(req.params.id));
      if (!installation) return res.status(404).json({ message: "Installation not found" });
      const access = await storage.canAccessWorkspace(currentUser(req).id, installation.workspaceId);
      if (!access.allowed) return res.status(403).json({ message: "Access denied" });

      const parsed = updateRepositorySelectionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.issues });
      }

      await ensureCodegraphSchema();
      const remote = await githubApi.listInstallationRepositories(installation.installationId);
      const byExternalId = new Map(remote.map((repo) => [repo.externalId, repo]));
      const unknown = parsed.data.externalIds.filter((externalId) => !byExternalId.has(externalId));
      if (unknown.length > 0) {
        return res.status(400).json({ message: "Some repositories are not accessible to this installation" });
      }

      const stored = await storage.listRepositoriesByInstallation(installation.installationId);
      const storedByExternalId = new Set(stored.filter((row) => row.externalId).map((row) => row.externalId as string));
      const keptIds = new Set<string>();
      const imported: Repository[] = [];

      for (const externalId of parsed.data.externalIds) {
        const repo = byExternalId.get(externalId)!;
        const row = await storage.upsertRepository({
          workspaceId: installation.workspaceId,
          ownerId: installation.userId,
          provider: "github",
          externalId: repo.externalId,
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch,
          cloneUrl: repo.cloneUrl,
          installationId: installation.installationId,
          isPrivate: repo.isPrivate,
        });
        keptIds.add(row.id);
        if (!storedByExternalId.has(externalId)) imported.push(row);
      }

      let removed = 0;
      for (const row of stored) {
        if (keptIds.has(row.id)) continue;
        await storage.deleteRepository(row.id);
        removed += 1;
      }

      for (const repository of imported) {
        void queueCodegraphIndex(repository).catch(() => {});
      }

      await audit(
        req,
        "github.repositories.select",
        `installation=${installation.installationId} imported=${imported.length} removed=${removed}`,
      );
      return res.json({ imported: imported.length, removed, queued: imported.length });
    } catch (error: any) {
      console.error("[github] selection error:", error?.message || error);
      return res.status(500).json({ message: error?.message || "Failed to update repository selection" });
    }
  });

  app.delete("/api/github/installations/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const installation = await storage.getGithubInstallation(String(req.params.id));
      if (!installation) return res.status(404).json({ message: "Installation not found" });
      const access = await storage.canAccessWorkspace(currentUser(req).id, installation.workspaceId);
      if (!access.allowed) return res.status(403).json({ message: "Access denied" });

      let githubUninstalled = false;
      if (req.query.uninstall === "true") {
        try {
          await githubApi.uninstallApp(installation.installationId);
          githubUninstalled = true;
        } catch (error: any) {
          // 404 means the app is already gone on GitHub — treat as uninstalled.
          if (error?.status === 404) {
            githubUninstalled = true;
          } else {
            console.error("[github] remote uninstall failed:", error?.message || error);
            return res.status(502).json({
              message: "GitHub could not uninstall the app. Check the app permissions and try again.",
            });
          }
        }
      }

      await storage.deleteRepositoriesByInstallation(installation.installationId);
      await storage.deleteGithubInstallation(installation.id);
      await audit(
        req,
        "github.installation.disconnect",
        `installation=${installation.installationId} githubUninstalled=${githubUninstalled}`,
      );
      return res.json({ ok: true, githubUninstalled });
    } catch (error: any) {
      console.error("[github] disconnect error:", error?.message || error);
      return res.status(500).json({ message: "Failed to disconnect installation" });
    }
  });

  // ── Repositories ──────────────────────────────────────────────────────
  app.get("/api/repositories", requireAuth, async (req: Request, res: Response) => {
    try {
      const workspaceId = await resolveWorkspaceAccess(req, res, req.query.workspaceId as string | undefined);
      if (!workspaceId) return;

      const [rows, installations] = await Promise.all([
        storage.listRepositories(workspaceId),
        storage.listGithubInstallations(workspaceId),
      ]);
      const byInstallation = new Map(installations.map((row) => [row.installationId, row]));
      const graphs = await storage.listRepositoryCodegraphs(rows.map((row) => row.id));
      const byRepositoryId = new Map(graphs.map((graph) => [graph.repositoryId, graph]));

      return res.json(
        rows.map((row) => {
          const installation = row.installationId ? byInstallation.get(row.installationId) : undefined;
          const graph = byRepositoryId.get(row.id);
          return {
            ...row,
            indexed: Boolean(row.indexedAt),
            codegraphStatus: graph?.status ?? "missing",
            codegraphFileCount: graph?.fileCount ?? 0,
            codegraphGeneratedAt: graph?.generatedAt ?? null,
            indexing: isCodegraphIndexing(row.id),
            installation: installation
              ? {
                  id: installation.id,
                  accountLogin: installation.accountLogin,
                  accountType: installation.accountType,
                  suspended: Boolean(installation.suspendedAt),
                }
              : null,
          };
        }),
      );
    } catch (error: any) {
      console.error("[repositories] list error:", error?.message || error);
      return res.status(500).json({ message: "Failed to list repositories" });
    }
  });

  app.patch("/api/repositories/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const repository = await loadRepository(req, res, String(req.params.id));
      if (!repository) return;

      const parsed = updateRepositorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.issues });
      }

      const updated = await storage.updateRepository(repository.id, {
        ...(parsed.data.reviewEnabled !== undefined ? { reviewEnabled: parsed.data.reviewEnabled } : {}),
        ...(parsed.data.settings !== undefined
          ? { settings: { ...((repository.settings as Record<string, unknown> | null) ?? {}), ...parsed.data.settings } }
          : {}),
      });
      return res.json(updated);
    } catch (error: any) {
      console.error("[repositories] update error:", error?.message || error);
      return res.status(500).json({ message: "Failed to update repository" });
    }
  });

  app.delete("/api/repositories/:id", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const repository = await loadRepository(req, res, String(req.params.id));
      if (!repository) return;
      await storage.deleteRepository(repository.id);
      await audit(req, "github.repository.remove", `repository=${repository.fullName}`);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("[repositories] delete error:", error?.message || error);
      return res.status(500).json({ message: "Failed to remove repository" });
    }
  });

  // ── Codegraph ─────────────────────────────────────────────────────────
  app.get("/api/repositories/:id/codegraph", requireAuth, async (req: Request, res: Response) => {
    try {
      const repository = await loadRepository(req, res, String(req.params.id));
      if (!repository) return;

      const graph = await storage.getRepositoryCodegraph(repository.id);
      const indexing = isCodegraphIndexing(repository.id);
      if (!graph) {
        return res.json({
          repository: repository.fullName,
          status: indexing ? "indexing" : "missing",
          indexing,
          files: [],
          connections: [],
          commitSha: null,
          fileCount: 0,
          generatedAt: null,
          error: null,
        });
      }

      return res.json({
        repository: repository.fullName,
        status: graph.status,
        indexing,
        files: graph.files,
        connections: graph.connections,
        commitSha: graph.commitSha,
        fileCount: graph.fileCount,
        generatedAt: graph.generatedAt,
        error: graph.error,
      });
    } catch (error: any) {
      console.error("[codegraph] get error:", error?.message || error);
      return res.status(500).json({ message: "Failed to load codegraph" });
    }
  });

  app.post("/api/repositories/:id/codegraph", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const repository = await loadRepository(req, res, String(req.params.id));
      if (!repository) return;
      if (!repository.installationId) {
        return res.status(409).json({ message: "Repository is not linked to a GitHub installation" });
      }

      void queueCodegraphIndex(repository).catch(() => {});
      return res.status(202).json({ status: "indexing" });
    } catch (error: any) {
      console.error("[codegraph] build error:", error?.message || error);
      return res.status(500).json({ message: "Failed to start codegraph build" });
    }
  });

  // ── Pull requests ─────────────────────────────────────────────────────
  app.get("/api/repositories/:id/pulls", requireAuth, async (req: Request, res: Response) => {
    try {
      const repository = await loadRepository(req, res, String(req.params.id));
      if (!repository) return;

      if (req.query.refresh === "true" && repository.installationId) {
        const state = (req.query.state as "open" | "closed" | "all") || "open";
        const remote = await githubApi.listPullRequests(repository.installationId, repository.fullName, state);
        for (const pr of remote) {
          await storage.upsertPullRequest({ repositoryId: repository.id, ...pr });
        }
      }

      const pullRequests = await storage.listPullRequests(repository.id, req.query.state as string | undefined);
      return res.json(pullRequests);
    } catch (error: any) {
      console.error("[pulls] list error:", error?.message || error);
      return res.status(500).json({ message: "Failed to list pull requests" });
    }
  });

  app.get("/api/repositories/:id/pulls/:number", requireAuth, async (req: Request, res: Response) => {
    try {
      const repository = await loadRepository(req, res, String(req.params.id));
      if (!repository) return;

      const number = Number(req.params.number);
      if (!Number.isInteger(number) || number <= 0) {
        return res.status(400).json({ message: "Invalid pull request number" });
      }

      let pullRequest = await storage.getPullRequestByNumber(repository.id, number);
      let files: unknown[] = [];
      let filesError: string | null = null;

      if (repository.installationId) {
        try {
          if (!pullRequest) {
            const remote = await githubApi.getPullRequest(repository.installationId, repository.fullName, number);
            pullRequest = await storage.upsertPullRequest({ repositoryId: repository.id, ...remote });
          }
          files = await githubApi.listPullRequestFiles(repository.installationId, repository.fullName, number);
        } catch (error: any) {
          filesError = error?.message || "Failed to load files from GitHub";
        }
      }

      if (!pullRequest) return res.status(404).json({ message: "Pull request not found" });
      return res.json({ pullRequest, files, filesError });
    } catch (error: any) {
      console.error("[pulls] detail error:", error?.message || error);
      return res.status(500).json({ message: "Failed to load pull request" });
    }
  });

  app.post(
    "/api/repositories/:id/pulls/:number/reviews",
    requireAuth,
    apiRateLimiter,
    async (req: Request, res: Response) => {
      try {
        const repository = await loadRepository(req, res, String(req.params.id));
        if (!repository) return;
        if (!repository.installationId) {
          return res.status(409).json({ message: "Repository is not linked to a GitHub installation" });
        }

        const parsed = createPullRequestReviewSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request", errors: parsed.error.issues });
        }

        const number = Number(req.params.number);
        if (!Number.isInteger(number) || number <= 0) {
          return res.status(400).json({ message: "Invalid pull request number" });
        }

        const review = await githubApi.createPullRequestReview(
          repository.installationId,
          repository.fullName,
          number,
          parsed.data,
        );
        await audit(req, "github.pull_request.review", `repository=${repository.fullName} pr=${number}`);
        return res.status(201).json(review);
      } catch (error: any) {
        console.error("[pulls] review error:", error?.message || error);
        return res.status(error?.status === 403 ? 403 : 500).json({ message: error?.message || "Failed to post review" });
      }
    },
  );

  app.get("/api/repositories/:id/findings", requireAuth, async (req: Request, res: Response) => {
    try {
      const repository = await loadRepository(req, res, String(req.params.id));
      if (!repository) return;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const rows = await db
        .select()
        .from(reviewFindings)
        .where(eq(reviewFindings.repositoryId, repository.id))
        .orderBy(desc(reviewFindings.createdAt))
        .limit(200);
      return res.json(status ? rows.filter((row) => row.status === status) : rows);
    } catch (error: any) {
      console.error("[findings] list error:", error?.message || error);
      return res.status(500).json({ message: "Failed to list findings" });
    }
  });

  // ── Issues + comments ─────────────────────────────────────────────────
  app.post("/api/repositories/:id/issues", requireAuth, apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const repository = await loadRepository(req, res, String(req.params.id));
      if (!repository) return;
      if (!repository.installationId) {
        return res.status(409).json({ message: "Repository is not linked to a GitHub installation" });
      }

      const parsed = createIssueSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.issues });
      }

      const issue = await githubApi.createIssue(
        repository.installationId,
        repository.fullName,
        parsed.data.title,
        parsed.data.body,
      );
      await audit(req, "github.issue.create", `repository=${repository.fullName} issue=${issue.number}`);
      return res.status(201).json(issue);
    } catch (error: any) {
      console.error("[issues] create error:", error?.message || error);
      return res.status(500).json({ message: error?.message || "Failed to create issue" });
    }
  });

  app.post(
    "/api/repositories/:id/issues/:number/comments",
    requireAuth,
    apiRateLimiter,
    async (req: Request, res: Response) => {
      try {
        const repository = await loadRepository(req, res, String(req.params.id));
        if (!repository) return;
        if (!repository.installationId) {
          return res.status(409).json({ message: "Repository is not linked to a GitHub installation" });
        }

        const parsed = createIssueCommentSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request", errors: parsed.error.issues });
        }

        const number = Number(req.params.number);
        if (!Number.isInteger(number) || number <= 0) {
          return res.status(400).json({ message: "Invalid issue number" });
        }

        const comment = await githubApi.createIssueComment(
          repository.installationId,
          repository.fullName,
          number,
          parsed.data.body,
        );
        await audit(req, "github.issue.comment", `repository=${repository.fullName} issue=${number}`);
        return res.status(201).json(comment);
      } catch (error: any) {
        console.error("[issues] comment error:", error?.message || error);
        return res.status(500).json({ message: error?.message || "Failed to post comment" });
      }
    },
  );

  // ── Webhooks ──────────────────────────────────────────────────────────
  // Mounted under /api/webhooks/ so it bypasses CSRF; authenticity comes from
  // the X-Hub-Signature-256 HMAC over the raw body.
  app.post("/api/webhooks/github", async (req: Request, res: Response) => {
    const config = getGithubAppConfig();
    if (!config?.webhookSecret) {
      return res.status(503).json({ message: "GitHub webhook is not configured" });
    }

    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
      return res.status(401).json({ message: "Invalid signature" });
    }

    const event = String(req.headers["x-github-event"] || "");
    if (!event) return res.status(400).json({ message: "Missing X-GitHub-Event" });

    const bodyBuffer = rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const deliveryId = String(
      req.headers["x-github-delivery"] || createHash("sha256").update(bodyBuffer).digest("hex"),
    );
    const payloadHash = createHash("sha256").update(bodyBuffer).digest("hex");

    let delivery;
    try {
      delivery = await storage.recordWebhookDelivery({ event, deliveryId, payloadHash });
    } catch (error: any) {
      console.error("[github] webhook record error:", error?.message || error);
      return res.status(500).json({ message: "Failed to record webhook" });
    }
    if (!delivery) return res.status(202).json({ received: true, duplicate: true });

    res.status(202).json({ received: true });

    setImmediate(() => {
      void (async () => {
        try {
          const result = await handleGithubWebhook(event, req.body ?? {}, {
            storage,
            syncInstallationRepositories,
          });
          await storage.markWebhookDelivery(delivery.id, "processed", result.reason ?? null);
        } catch (error: any) {
          console.error("[github] webhook handler error:", error?.message || error);
          await storage.markWebhookDelivery(
            delivery.id,
            "error",
            error?.message ? String(error.message).slice(0, 2000) : "Webhook handling failed",
          ).catch(() => {});
        }
      })();
    });
  });
}
