import { createHmac, timingSafeEqual } from "crypto";
import type {
  GithubInstallation,
  NewGithubInstallation,
  NewPullRequest,
  PullRequest,
  Repository,
} from "@shared/schema";
import { mapPullRequestPayload } from "./mappers";

export interface GithubWebhookStorage {
  getGithubInstallationByInstallationId(installationId: string): Promise<GithubInstallation | undefined>;
  createGithubInstallation(data: NewGithubInstallation): Promise<GithubInstallation>;
  updateGithubInstallation(id: string, data: Partial<NewGithubInstallation>): Promise<GithubInstallation>;
  deleteGithubInstallation(id: string): Promise<void>;
  deleteRepositoriesByInstallation(installationId: string): Promise<void>;
  getRepositoryByExternalId(externalId: string): Promise<Repository | undefined>;
  upsertPullRequest(data: NewPullRequest): Promise<PullRequest>;
}

export interface GithubWebhookDeps {
  storage: GithubWebhookStorage;
  syncInstallationRepositories(installation: GithubInstallation): Promise<number>;
}

export interface GithubWebhookResult {
  handled: boolean;
  action?: string;
  reason?: string;
}

/** HMAC SHA-256 verification for `X-Hub-Signature-256`, timing-safe. */
export function verifyWebhookSignature(
  rawBody: Buffer | string | undefined,
  signature: string | undefined,
  secret: string | null | undefined,
): boolean {
  if (!rawBody || !signature || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/** Test helper: produce the header value GitHub would send. */
export function signWebhookPayload(rawBody: Buffer | string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export async function handleGithubWebhook(
  event: string,
  payload: any,
  deps: GithubWebhookDeps,
): Promise<GithubWebhookResult> {
  switch (event) {
    case "installation":
      return handleInstallationEvent(payload, deps);
    case "installation_repositories":
      return handleInstallationRepositoriesEvent(payload, deps);
    case "pull_request":
      return handlePullRequestEvent(payload, deps);
    default:
      return { handled: false, reason: `ignored event: ${event}` };
  }
}

async function handleInstallationEvent(
  payload: any,
  deps: GithubWebhookDeps,
): Promise<GithubWebhookResult> {
  const action: string = payload?.action;
  const installationId = payload?.installation?.id ? String(payload.installation.id) : "";
  if (!installationId) return { handled: false, reason: "missing installation id" };

  const existing = await deps.storage.getGithubInstallationByInstallationId(installationId);

  if (action === "deleted") {
    if (existing) {
      await deps.storage.deleteRepositoriesByInstallation(installationId);
      await deps.storage.deleteGithubInstallation(existing.id);
    }
    return { handled: true, action };
  }

  if (action === "created") {
    // The install completes through the Setup URL, which links the workspace.
    // Until then the installation may arrive before the user finishes setup.
    if (!existing) return { handled: true, action, reason: "installation not linked yet" };
    const updated = await deps.storage.updateGithubInstallation(existing.id, {
      accountLogin: payload.installation?.account?.login ?? existing.accountLogin,
      accountType: payload.installation?.account?.type ?? existing.accountType,
      repositorySelection: payload.installation?.repository_selection ?? existing.repositorySelection,
      suspendedAt: payload.installation?.suspended_at ? new Date(payload.installation.suspended_at) : null,
    });
    await deps.syncInstallationRepositories(updated);
    return { handled: true, action };
  }

  if (action === "suspend" || action === "unsuspend") {
    if (existing) {
      const suspendedAt =
        action === "suspend"
          ? new Date(payload.installation?.suspended_at ?? Date.now())
          : null;
      await deps.storage.updateGithubInstallation(existing.id, { suspendedAt });
    }
    return { handled: true, action };
  }

  return { handled: true, action };
}

async function handleInstallationRepositoriesEvent(
  payload: any,
  deps: GithubWebhookDeps,
): Promise<GithubWebhookResult> {
  const installationId = payload?.installation?.id ? String(payload.installation.id) : "";
  if (!installationId) return { handled: false, reason: "missing installation id" };

  const existing = await deps.storage.getGithubInstallationByInstallationId(installationId);
  if (!existing) return { handled: true, reason: "installation not linked yet" };

  await deps.syncInstallationRepositories(existing);
  return { handled: true, action: payload?.action };
}

async function handlePullRequestEvent(
  payload: any,
  deps: GithubWebhookDeps,
): Promise<GithubWebhookResult> {
  const action: string = payload?.action;
  const externalId = payload?.repository?.id ? String(payload.repository.id) : "";
  const number = payload?.pull_request?.number;
  if (!externalId || !number) return { handled: false, reason: "missing repository or pull request" };

  const repository = await deps.storage.getRepositoryByExternalId(externalId);
  if (!repository) return { handled: true, reason: "repository not connected", action };

  await deps.storage.upsertPullRequest(
    mapPullRequestPayload(repository.id, payload.pull_request),
  );

  return { handled: true, action };
}
