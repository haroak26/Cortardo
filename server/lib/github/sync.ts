import { storage } from "../../storage";
import type { GithubInstallation } from "@shared/schema";
import { listInstallationRepositories } from "./api";
import { mapPullRequestPayload } from "./mappers";

export { mapPullRequestPayload, type GithubPullRequestPayload } from "./mappers";

/**
 * Reconcile the repos the workspace has chosen to track with the installation's
 * current access. Metadata is refreshed for tracked repos; repos that are no
 * longer accessible are removed. Newly available repos are *not* imported
 * automatically — the user selects them explicitly (see the repository picker).
 */
export async function syncInstallationRepositories(installation: GithubInstallation): Promise<number> {
  const repos = await listInstallationRepositories(installation.installationId);
  const accessibleById = new Map(repos.map((repo) => [repo.externalId, repo]));
  const accessibleNames = new Set(repos.map((repo) => repo.fullName.toLowerCase()));

  const existing = await storage.listRepositoriesByInstallation(installation.installationId);
  let kept = 0;

  for (const row of existing) {
    const remote = (row.externalId ? accessibleById.get(row.externalId) : undefined) ??
      repos.find((repo) => repo.fullName.toLowerCase() === row.fullName.toLowerCase());
    if (!remote) {
      await storage.deleteRepository(row.id);
      continue;
    }
    kept += 1;
    await storage.updateRepository(row.id, {
      workspaceId: installation.workspaceId,
      ownerId: installation.userId,
      externalId: remote.externalId,
      fullName: remote.fullName,
      defaultBranch: remote.defaultBranch,
      cloneUrl: remote.cloneUrl,
      installationId: installation.installationId,
      isPrivate: remote.isPrivate,
    });
  }

  return kept;
}
