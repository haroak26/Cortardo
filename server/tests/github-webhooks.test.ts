import assert from "node:assert/strict";
import test from "node:test";
import type { GithubInstallation, NewPullRequest, Repository } from "@shared/schema";
import {
  handleGithubWebhook,
  signWebhookPayload,
  verifyWebhookSignature,
  type GithubWebhookDeps,
} from "../lib/github/webhooks";

const SECRET = "test-webhook-secret";

function createFakeDeps() {
  const calls = {
    synced: 0,
    deletedRepositories: [] as string[],
    deletedInstallations: [] as string[],
    upsertedPullRequests: [] as NewPullRequest[],
  };

  const installation = {
    id: "install-row",
    workspaceId: "ws-1",
    userId: "user-1",
    installationId: "123",
    accountLogin: "acme",
    accountType: "Organization",
    repositorySelection: "selected",
    suspendedAt: null,
  } as GithubInstallation;

  const repository = {
    id: "repo-row",
    workspaceId: "ws-1",
    ownerId: "user-1",
    provider: "github",
    fullName: "acme/api",
    defaultBranch: "main",
    installationId: "123",
    reviewEnabled: true,
    isPrivate: true,
  } as Repository;

  const deps: GithubWebhookDeps = {
    storage: {
      getGithubInstallationByInstallationId: async (installationId) =>
        installationId === "123" ? installation : undefined,
      createGithubInstallation: async (data) => ({ ...installation, ...data }) as GithubInstallation,
      updateGithubInstallation: async (_id, data) => ({ ...installation, ...data }) as GithubInstallation,
      deleteGithubInstallation: async (id) => {
        calls.deletedInstallations.push(id);
      },
      deleteRepositoriesByInstallation: async (installationId) => {
        calls.deletedRepositories.push(installationId);
      },
      getRepositoryByExternalId: async (externalId) => (externalId === "42" ? repository : undefined),
      upsertPullRequest: async (data) => {
        calls.upsertedPullRequests.push(data);
        return { id: "pr-row", ...data } as any;
      },
    },
    syncInstallationRepositories: async () => {
      calls.synced += 1;
      return 3;
    },
  };

  return { deps, calls, installation, repository };
}

function pullRequestPayload(action: string, overrides: Record<string, unknown> = {}) {
  return {
    action,
    repository: { id: 42, full_name: "acme/api" },
    installation: { id: 123 },
    pull_request: {
      number: 7,
      title: "Add rate limiting",
      user: { login: "priya" },
      base: { ref: "main", sha: "base-sha" },
      head: { ref: "feature", sha: "head-sha" },
      state: "open",
      html_url: "https://github.com/acme/api/pull/7",
      ...overrides,
    },
  };
}

test("verifyWebhookSignature accepts a valid signature", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const signature = signWebhookPayload(body, SECRET);
  assert.equal(verifyWebhookSignature(body, signature, SECRET), true);
});

test("verifyWebhookSignature rejects tampered bodies, wrong secrets and missing values", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const signature = signWebhookPayload(body, SECRET);

  assert.equal(verifyWebhookSignature(Buffer.from("{}"), signature, SECRET), false);
  assert.equal(verifyWebhookSignature(body, signature, "other-secret"), false);
  assert.equal(verifyWebhookSignature(body, undefined, SECRET), false);
  assert.equal(verifyWebhookSignature(body, signature, null), false);
  assert.equal(verifyWebhookSignature(undefined, signature, SECRET), false);
});

test("pull_request opened on a connected repo upserts the PR", async () => {
  const { deps, calls } = createFakeDeps();
  const result = await handleGithubWebhook("pull_request", pullRequestPayload("opened"), deps);

  assert.equal(result.handled, true);
  assert.equal(calls.upsertedPullRequests.length, 1);
  assert.equal(calls.upsertedPullRequests[0].number, 7);
  assert.equal(calls.upsertedPullRequests[0].author, "priya");
});

test("pull_request updates the PR on every action", async () => {
  const { deps, calls } = createFakeDeps();
  await handleGithubWebhook("pull_request", pullRequestPayload("synchronize"), deps);
  await handleGithubWebhook("pull_request", pullRequestPayload("closed", { state: "closed" }), deps);

  assert.equal(calls.upsertedPullRequests.length, 2);
});

test("pull_request is ignored for unknown repositories", async () => {
  const { deps, calls } = createFakeDeps();
  const result = await handleGithubWebhook(
    "pull_request",
    pullRequestPayload("opened"),
    { ...deps, storage: { ...deps.storage, getRepositoryByExternalId: async () => undefined } },
  );
  assert.equal(result.handled, true);
  assert.equal(calls.upsertedPullRequests.length, 0);
});

test("installation deleted removes repositories and the local link", async () => {
  const { deps, calls } = createFakeDeps();
  const result = await handleGithubWebhook(
    "installation",
    { action: "deleted", installation: { id: 123 } },
    deps,
  );

  assert.equal(result.handled, true);
  assert.deepEqual(calls.deletedRepositories, ["123"]);
  assert.deepEqual(calls.deletedInstallations, ["install-row"]);
});

test("installation created for an unlinked installation does not create a row", async () => {
  let created = 0;
  const { deps } = createFakeDeps();
  await handleGithubWebhook(
    "installation",
    { action: "created", installation: { id: 999, account: { login: "acme" } } },
    {
      ...deps,
      storage: {
        ...deps.storage,
        getGithubInstallationByInstallationId: async () => undefined,
        createGithubInstallation: async (data) => {
          created += 1;
          return data as GithubInstallation;
        },
      },
    },
  );
  assert.equal(created, 0);
});

test("installation_repositories syncs the repo list", async () => {
  const { deps, calls } = createFakeDeps();
  const result = await handleGithubWebhook(
    "installation_repositories",
    { action: "added", installation: { id: 123 }, repositories_added: [{ id: 1 }] },
    deps,
  );

  assert.equal(result.handled, true);
  assert.equal(calls.synced, 1);
});

test("unhandled events are ignored", async () => {
  const { deps } = createFakeDeps();
  const result = await handleGithubWebhook("ping", { zen: "hello" }, deps);
  assert.equal(result.handled, false);
});

