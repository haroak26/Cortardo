import { getAppOctokit, getInstallationOctokit } from "./app";

export interface GithubInstallationInfo {
  installationId: string;
  accountLogin: string | null;
  accountType: string | null;
  repositorySelection: string;
  suspendedAt: Date | null;
}

export interface GithubRepoSummary {
  externalId: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string | null;
  isPrivate: boolean;
}

export interface GithubPullRequestSummary {
  number: number;
  title: string | null;
  body: string | null;
  author: string | null;
  baseRef: string | null;
  headRef: string | null;
  baseSha: string | null;
  headSha: string | null;
  state: string;
  url: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  providerData: Record<string, unknown>;
}

export interface GithubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface PullRequestReviewInput {
  body?: string;
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  /** Pin the review to the reviewed commit so a later push cannot re-target it. */
  commitId?: string;
  comments?: Array<{
    path: string;
    line: number;
    body: string;
    side?: "LEFT" | "RIGHT";
    /** First line of a multi-line comment/suggestion. */
    start_line?: number;
    start_side?: "LEFT" | "RIGHT";
  }>;
}

export function splitFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository name: ${fullName}`);
  return { owner, repo };
}

/** Confirm an installation exists and return its account metadata (app JWT). */
export async function verifyInstallation(installationId: string | number): Promise<GithubInstallationInfo> {
  const octokit = getAppOctokit();
  const { data } = await octokit.rest.apps.getInstallation({ installation_id: Number(installationId) });
  return {
    installationId: String(data.id),
    accountLogin: (data.account as any)?.login ?? null,
    accountType: (data.account as any)?.type ?? null,
    repositorySelection: data.repository_selection ?? "selected",
    suspendedAt: data.suspended_at ? new Date(data.suspended_at) : null,
  };
}

/** Remove the installation from GitHub entirely (app JWT). */
export async function uninstallApp(installationId: string | number): Promise<void> {
  const octokit = getAppOctokit();
  await octokit.rest.apps.deleteInstallation({ installation_id: Number(installationId) });
}

const MAX_PAGES = 10;

/** Every repository the installation can access (paginated, capped). */
export async function listInstallationRepositories(installationId: string | number): Promise<GithubRepoSummary[]> {
  const octokit = getInstallationOctokit(installationId);
  const repos: GithubRepoSummary[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: 100,
      page,
    });
    for (const repo of asArray(data.repositories)) {
      repos.push({
        externalId: String(repo.id),
        fullName: repo.full_name,
        defaultBranch: repo.default_branch ?? "main",
        cloneUrl: repo.clone_url ?? null,
        isPrivate: Boolean(repo.private),
      });
    }
    if (asArray(data.repositories).length < 100) break;
  }
  return repos;
}

export async function listPullRequests(
  installationId: string | number,
  fullName: string,
  state: "open" | "closed" | "all" = "open",
): Promise<GithubPullRequestSummary[]> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.pulls.list({ owner, repo, state, per_page: 50, sort: "updated" });
  return data.map((pr) => ({
    number: pr.number,
    title: pr.title ?? null,
    body: pr.body ?? null,
    author: pr.user?.login ?? null,
    baseRef: pr.base?.ref ?? null,
    headRef: pr.head?.ref ?? null,
    baseSha: pr.base?.sha ?? null,
    headSha: pr.head?.sha ?? null,
    state: pr.state,
    url: pr.html_url ?? null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    providerData: { draft: pr.draft ?? false, mergedAt: pr.merged_at },
  }));
}

export async function getPullRequest(
  installationId: string | number,
  fullName: string,
  number: number,
): Promise<GithubPullRequestSummary> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
  return {
    number: data.number,
    title: data.title ?? null,
    body: data.body ?? null,
    author: data.user?.login ?? null,
    baseRef: data.base?.ref ?? null,
    headRef: data.head?.ref ?? null,
    baseSha: data.base?.sha ?? null,
    headSha: data.head?.sha ?? null,
    state: data.state,
    url: data.html_url ?? null,
    additions: data.additions ?? 0,
    deletions: data.deletions ?? 0,
    changedFiles: data.changed_files ?? 0,
    providerData: { draft: data.draft ?? false, mergedAt: data.merged_at, mergeableState: (data as any).mergeable_state },
  };
}

export async function listPullRequestFiles(
  installationId: string | number,
  fullName: string,
  number: number,
  maxFiles = 300,
): Promise<GithubPullRequestFile[]> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const files: GithubPullRequestFile[] = [];
  for (let page = 1; page <= Math.ceil(maxFiles / 100); page++) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: number,
      per_page: 100,
      page,
    });
    for (const file of asArray(data)) {
      files.push({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
      });
      if (files.length >= maxFiles) return files;
    }
    if (asArray(data).length < 100) break;
  }
  return files;
}

function mapChangedFile(file: any): GithubPullRequestFile {
  return {
    filename: file.filename,
    status: file.status,
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    changes: file.changes ?? 0,
    patch: file.patch,
  };
}

export interface CommitComparison {
  files: GithubPullRequestFile[];
  commits: string[];
}

/** Files and commit titles between two commits (compare API, capped). */
export async function compareCommits(
  installationId: string | number,
  fullName: string,
  base: string,
  head: string,
): Promise<CommitComparison> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${base}...${head}`,
    per_page: 100,
  });
  return {
    files: asArray(data.files).slice(0, 300).map(mapChangedFile),
    commits: (data.commits ?? [])
      .slice(0, 10)
      .map((commit) => (commit.commit?.message ?? "").split("\n")[0])
      .filter(Boolean),
  };
}

/** Files changed by a single commit. */
export async function getCommitFiles(
  installationId: string | number,
  fullName: string,
  sha: string,
): Promise<GithubPullRequestFile[]> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: sha });
  return asArray(data.files).slice(0, 300).map(mapChangedFile);
}

/** Comment on a commit (used for push reviews where no PR exists). */
export async function createCommitComment(
  installationId: string | number,
  fullName: string,
  sha: string,
  body: string,
): Promise<{ id: number; url: string | null }> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.repos.createCommitComment({
    owner,
    repo,
    commit_sha: sha,
    body,
  });
  return { id: data.id, url: data.html_url ?? null };
}

export interface InstallationPermissions {
  contents: string;
  pullRequests: string;
  checks: string;
}

/** App-level installation permissions (used to gate fix PRs and check runs). */
export async function getInstallationPermissions(
  installationId: string | number,
): Promise<InstallationPermissions> {
  const octokit = getAppOctokit();
  const { data } = await octokit.rest.apps.getInstallation({ installation_id: Number(installationId) });
  const permissions = (data.permissions ?? {}) as Record<string, string>;
  return {
    contents: permissions.contents ?? "read",
    pullRequests: permissions.pull_requests ?? "read",
    checks: permissions.checks ?? "read",
  };
}

// ── Checks API ─────────────────────────────────────────────────────────

export type CheckRunStatus = "queued" | "in_progress" | "completed";

export type CheckConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "success"
  | "skipped"
  | "stale"
  | "timed_out";

export interface CheckRunHandle {
  id: number;
  url: string | null;
}

export interface CreateCheckRunInput {
  name: string;
  headSha: string;
  status?: CheckRunStatus;
  conclusion?: CheckConclusion | null;
  title?: string;
  summary?: string;
  /** Full markdown detail body shown on the check run page (3.3). */
  text?: string;
  /** Deep link that backs the check run's "Details" button. */
  detailsUrl?: string | null;
  /** Correlates the check run with the review run id. */
  externalId?: string | null;
}

function checkRunOutput(input: { title?: string; summary?: string; text?: string }): { title: string; summary: string; text?: string } | undefined {
  if (!input.title && !input.summary && !input.text) return undefined;
  return {
    title: input.title ?? "Cortardo",
    summary: (input.summary ?? "").slice(0, 65_000),
    ...(input.text ? { text: input.text.slice(0, 65_000) } : {}),
  };
}

/** Create a check run for a commit (requires `checks: write`). */
export async function createCheckRun(
  installationId: string | number,
  fullName: string,
  input: CreateCheckRunInput,
): Promise<CheckRunHandle> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const output = checkRunOutput(input);
  const { data } = await octokit.rest.checks.create({
    owner,
    repo,
    name: input.name,
    head_sha: input.headSha,
    status: input.status ?? "in_progress",
    ...(input.conclusion ? { conclusion: input.conclusion } : {}),
    ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
    ...(input.externalId ? { external_id: input.externalId } : {}),
    ...(output ? { output } : {}),
  });
  return { id: data.id, url: data.html_url ?? null };
}

/** Update an existing check run (status, conclusion, output). */
export async function updateCheckRun(
  installationId: string | number,
  fullName: string,
  checkRunId: number,
  input: Omit<CreateCheckRunInput, "name" | "headSha" | "externalId">,
): Promise<CheckRunHandle> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const output = checkRunOutput(input);
  const { data } = await octokit.rest.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    ...(input.status ? { status: input.status } : {}),
    ...(input.conclusion ? { conclusion: input.conclusion } : {}),
    ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
    ...(output ? { output } : {}),
  });
  return { id: data.id, url: data.html_url ?? null };
}

export async function getBranchHead(
  installationId: string | number,
  fullName: string,
  branch: string,
): Promise<string> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.repos.getBranch({ owner, repo, branch });
  return data.commit.sha;
}

export async function createBranch(
  installationId: string | number,
  fullName: string,
  branch: string,
  sha: string,
): Promise<void> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha });
}

export interface FileWithSha {
  content: string;
  sha: string;
}

/** File contents plus blob sha at a ref (needed to update a file). */
export async function getFileWithSha(
  installationId: string | number,
  fullName: string,
  filePath: string,
  ref: string,
): Promise<FileWithSha | null> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
    return {
      content: Buffer.from(data.content, (data.encoding as BufferEncoding) ?? "base64").toString("utf8"),
      sha: data.sha,
    };
  } catch (error: any) {
    if (error?.status === 404) return null;
    throw error;
  }
}

export async function updateFileContents(
  installationId: string | number,
  fullName: string,
  filePath: string,
  branch: string,
  content: string,
  message: string,
  sha?: string | null,
): Promise<void> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    branch,
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    ...(sha ? { sha } : {}),
  });
}

export async function createPullRequest(
  installationId: string | number,
  fullName: string,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<{ number: number; url: string | null }> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.pulls.create({ owner, repo, head, base, title, body });
  return { number: data.number, url: data.html_url ?? null };
}

// ── Git data API (atomic multi-file commits) ─────────────────────────────

/** Create a blob for raw UTF-8 content and return its sha. */
export async function createBlob(
  installationId: string | number,
  fullName: string,
  content: string,
): Promise<string> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.git.createBlob({ owner, repo, content, encoding: "utf-8" });
  return data.sha;
}

/** Tree of a commit (the base for an atomic multi-file commit). */
export async function getCommitTreeSha(
  installationId: string | number,
  fullName: string,
  sha: string,
): Promise<string> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: sha });
  return data.tree.sha;
}

/** Commit message for a sha (used to keep bot commits idempotent). */
export async function getCommitMessage(
  installationId: string | number,
  fullName: string,
  sha: string,
): Promise<string> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: sha });
  return data.message ?? "";
}

/** New tree replacing only the given paths on top of a base tree. */
export async function createTreeWithChanges(
  installationId: string | number,
  fullName: string,
  baseTreeSha: string,
  entries: Array<{ path: string; blobSha: string }>,
): Promise<string> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: entries.map((entry) => ({ path: entry.path, mode: "100644" as const, type: "blob" as const, sha: entry.blobSha })),
  });
  return data.sha;
}

/** Commit a tree on top of a single parent. */
export async function createCommit(
  installationId: string | number,
  fullName: string,
  input: { message: string; treeSha: string; parentSha: string },
): Promise<string> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: input.message,
    tree: input.treeSha,
    parents: [input.parentSha],
  });
  return data.sha;
}

/** Fast-forward a branch ref; fails when the ref moved concurrently. */
export async function updateRef(
  installationId: string | number,
  fullName: string,
  branch: string,
  sha: string,
): Promise<void> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha, force: false });
}

/** Raw file contents at a ref (null when missing or >1MB / not a file). */
export async function getFileContent(
  installationId: string | number,
  fullName: string,
  filePath: string,
  ref?: string | null,
): Promise<string | null> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ...(ref ? { ref } : {}),
    });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
    return Buffer.from(data.content, (data.encoding as BufferEncoding) ?? "base64").toString("utf8");
  } catch (error: any) {
    if (error?.status === 404) return null;
    throw error;
  }
}

export interface GithubCodeMatch {
  path: string;
  /** Matching fragments are provided by GitHub's text-match media type. */
  fragments: string[];
}

/**
 * Repository-wide code search for a literal query. Returns file paths and text
 * fragments; the caller reads the file when it needs line numbers. Throws on
 * failure (rate limit, search unavailable for the installation), so callers can
 * degrade to a bounded local search.
 */
export async function searchCode(
  installationId: string | number,
  fullName: string,
  query: string,
  maxResults = 10,
): Promise<GithubCodeMatch[]> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.search.code({
    q: `${query} repo:${owner}/${repo}`,
    per_page: Math.min(30, Math.max(1, maxResults)),
    headers: { accept: "application/vnd.github.text-match+json" },
  });
  return (data.items ?? []).slice(0, maxResults).map((item) => {
    const matches = (item as { text_matches?: Array<{ fragment?: string }> }).text_matches ?? [];
    return {
      path: item.path,
      fragments: matches
        .map((match) => (typeof match.fragment === "string" ? match.fragment.trim() : ""))
        .filter(Boolean)
        .slice(0, 2),
    };
  });
}

export interface GithubReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  userLogin: string | null;
  reviewId: number | null;
}

/** Review comments on a PR (both sides), used to replace prior suggestions. */
export async function listPullRequestReviewComments(
  installationId: string | number,
  fullName: string,
  number: number,
): Promise<GithubReviewComment[]> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const comments: GithubReviewComment[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: number,
      per_page: 100,
      page,
    });
    for (const comment of asArray(data)) {
      comments.push({
        id: comment.id,
        body: comment.body ?? "",
        path: comment.path,
        line: comment.line ?? null,
        userLogin: comment.user?.login ?? null,
        reviewId: comment.pull_request_review_id ?? null,
      });
    }
    if (asArray(data).length < 100) break;
  }
  return comments;
}

export async function deletePullRequestReviewComment(
  installationId: string | number,
  fullName: string,
  commentId: number,
): Promise<void> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: commentId });
}

export async function createPullRequestReview(
  installationId: string | number,
  fullName: string,
  number: number,
  input: PullRequestReviewInput,
): Promise<{ id: number; url: string | null }> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: number,
    body: input.body,
    event: input.event,
    ...(input.commitId ? { commit_id: input.commitId } : {}),
    comments: input.comments?.map((comment) => {
      const multiLine = comment.start_line !== undefined && comment.start_line !== comment.line;
      return {
        path: comment.path,
        line: comment.line,
        side: comment.side ?? "RIGHT",
        body: comment.body,
        ...(multiLine
          ? {
              start_line: comment.start_line,
              start_side: comment.start_side ?? comment.side ?? "RIGHT",
            }
          : {}),
      };
    }),
  });
  return { id: data.id, url: data.html_url ?? null };
}

/** Commit titles for a pull request (context for the reviewer). */
export interface PullRequestReviewSummary {
  id: number;
  userLogin: string | null;
  userType: string | null;
  state: string;
  commitId: string | null;
  submittedAt: string | null;
  body: string;
}

/** List reviews on a pull request (used for idempotent re-reviews). */
export async function listPullRequestReviews(
  installationId: string | number,
  fullName: string,
  number: number,
): Promise<PullRequestReviewSummary[]> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.pulls.listReviews({ owner, repo, pull_number: number, per_page: 100 });
  return data.map((review) => ({
    id: review.id,
    userLogin: review.user?.login ?? null,
    userType: review.user?.type ?? null,
    state: review.state ?? "COMMENTED",
    commitId: review.commit_id ?? null,
    submittedAt: review.submitted_at ?? null,
    body: review.body ?? "",
  }));
}

/** Dismiss a submitted review (best effort; requires write access). */
export async function dismissPullRequestReview(
  installationId: string | number,
  fullName: string,
  number: number,
  reviewId: number,
  message: string,
): Promise<void> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  await octokit.rest.pulls.dismissReview({
    owner,
    repo,
    pull_number: number,
    review_id: reviewId,
    message,
  });
}

export async function listPullRequestCommits(
  installationId: string | number,
  fullName: string,
  number: number,
  max = 10,
): Promise<string[]> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.pulls.listCommits({ owner, repo, pull_number: number, per_page: max });
  return data
    .map((commit) => (commit.commit?.message ?? "").split("\n")[0].trim())
    .filter(Boolean)
    .slice(0, max);
}

export interface PullRequestCommentSummary {
  author: string | null;
  body: string;
  createdAt: string | null;
}

/** Existing issue/PR comments, treated as untrusted discussion context. */
export async function listPullRequestComments(
  installationId: string | number,
  fullName: string,
  number: number,
  max = 20,
): Promise<PullRequestCommentSummary[]> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: number,
    per_page: max,
  });
  return data.map((comment) => ({
    author: comment.user?.login ?? null,
    body: (comment.body ?? "").slice(0, 500),
    createdAt: comment.created_at ?? null,
  }));
}

export async function createIssue(
  installationId: string | number,
  fullName: string,
  title: string,
  body?: string,
): Promise<{ number: number; url: string | null }> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.issues.create({ owner, repo, title, body });
  return { number: data.number, url: data.html_url ?? null };
}

export async function createIssueComment(
  installationId: string | number,
  fullName: string,
  issueNumber: number,
  body: string,
): Promise<{ id: number; url: string | null }> {
  const { owner, repo } = splitFullName(fullName);
  const octokit = getInstallationOctokit(installationId);
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
  return { id: data.id, url: data.html_url ?? null };
}

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}
