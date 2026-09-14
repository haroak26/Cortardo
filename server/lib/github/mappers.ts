import type { NewPullRequest } from "@shared/schema";

export interface GithubPullRequestPayload {
  number: number;
  title?: string | null;
  body?: string | null;
  user?: { login?: string | null } | null;
  base?: { ref?: string | null; sha?: string | null } | null;
  head?: { ref?: string | null; sha?: string | null } | null;
  state?: string;
  html_url?: string | null;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
}

/** Map a GitHub `pull_request` webhook payload into a storage upsert row. */
export function mapPullRequestPayload(repositoryId: string, pr: GithubPullRequestPayload): NewPullRequest {
  return {
    repositoryId,
    number: pr.number,
    title: pr.title ?? null,
    body: pr.body ?? null,
    author: pr.user?.login ?? null,
    baseRef: pr.base?.ref ?? null,
    headRef: pr.head?.ref ?? null,
    baseSha: pr.base?.sha ?? null,
    headSha: pr.head?.sha ?? null,
    state: pr.state ?? "open",
    url: pr.html_url ?? null,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changed_files ?? 0,
    providerData: {
      draft: Boolean(pr.draft),
      merged: Boolean(pr.merged),
      mergedAt: pr.merged_at ?? null,
    },
  };
}
