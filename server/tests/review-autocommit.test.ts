import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding } from "../../cortardobot/src/v3/types.ts";
import {
  autoCommitVerifiedFixes,
  looksLikeSecret,
  protectedPathReason,
  type AutoCommitDeps,
} from "../lib/review/autocommit";

const CONTENT = ["const a = 1;", "const x = undefined;", "export default a;"].join("\n");

function finding(overrides: { id?: string; path?: string; fileContent?: string } = {}): Finding {
  const id = overrides.id ?? "c_1";
  const path = overrides.path ?? "src/a.ts";
  const content = overrides.fileContent ?? CONTENT;
  return {
    candidate: {
      id,
      claim: `${path} dereferences undefined`,
      severity: "high",
      confidence: 0.9,
      file: path,
      line: 2,
      evidence: [`${path}:2`],
      source: "detector",
      agentKind: "runtime",
      suggestedProof: "browser",
      tags: ["test"],
      occurrences: 1,
      score: 5,
      mergedFrom: [],
    },
    proof: {
      candidateId: id,
      status: "confirmed",
      strategy: "browser",
      attempts: [],
      reproduction: "assertion failed (expected pass)",
      explanation: "Reproduced in a real browser",
      durationMs: 10,
    },
    repair: {
      candidateId: id,
      severity: "high",
      exit: "VERIFIED",
      attempts: [],
      finalPatch: `--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n const a = 1;\n-const x = undefined;\n+const x = 1;\n export default a;`,
      finalEdits: [{ path, find: "const x = undefined;", replace: "const x = 1;" }],
      durationMs: 10,
      toolCalls: 1,
      reason: "fix applied and the reproduction passes",
    },
    verification: {
      passed: true,
      durationMs: 10,
      steps: [{ kind: "reproduction", command: "browser", passed: true, skipped: false, reason: "passes twice", durationMs: 5 }],
    },
  };
}

function unverifiedFinding(): Finding {
  const entry = finding({ id: "c_unverified", path: "src/b.ts" });
  entry.verification = { passed: false, durationMs: 1, steps: [] };
  return entry;
}

interface Harness {
  deps: AutoCommitDeps;
  recorded: {
    blobs: string[];
    trees: Array<{ base: string; entries: Array<{ path: string; blobSha: string }> }>;
    commits: Array<{ message: string; treeSha: string; parentSha: string }>;
    refs: Array<{ branch: string; sha: string }>;
  };
}

function harness(files: Record<string, string>, overrides: Partial<AutoCommitDeps> = {}): Harness {
  const recorded = { blobs: [] as string[], trees: [] as Harness["recorded"]["trees"], commits: [] as Harness["recorded"]["commits"], refs: [] as Harness["recorded"]["refs"] };
  const deps: AutoCommitDeps = {
    getInstallationPermissions: async () => ({ contents: "write", pullRequests: "write", checks: "write" }),
    getBranchHead: async () => "head123",
    getCommitMessage: async () => "previous commit",
    getCommitTreeSha: async () => "tree-base",
    getFileWithSha: async (_installationId, _fullName, path) => (path in files ? { content: files[path], sha: "filesha" } : null),
    createBlob: async (_installationId, _fullName, content) => {
      recorded.blobs.push(content);
      return `blob-${recorded.blobs.length}`;
    },
    createTreeWithChanges: async (_installationId, _fullName, base, entries) => {
      recorded.trees.push({ base, entries });
      return "tree-new";
    },
    createCommit: async (_installationId, _fullName, input) => {
      recorded.commits.push(input);
      return "commit-new";
    },
    updateRef: async (_installationId, _fullName, branch, sha) => {
      recorded.refs.push({ branch, sha });
    },
    ...overrides,
  };
  return { deps, recorded };
}

function options(findings: Finding[], maxFindings?: number) {
  return {
    installationId: 7,
    fullName: "acme/repo",
    branch: "feature",
    headSha: "head123",
    runId: "run-1",
    findings,
    maxFindings,
  };
}

test("auto-commit lands verified fixes in one atomic commit and skips the rest", async () => {
  const { deps, recorded } = harness({ "src/a.ts": CONTENT, "src/b.ts": CONTENT });
  const result = await autoCommitVerifiedFixes(
    options([finding(), unverifiedFinding(), finding({ id: "c_test", path: "src/a.test.ts" })]),
    deps,
  );
  assert.equal(result.committed.length, 1);
  assert.deepEqual(result.committed[0].paths, ["src/a.ts"]);
  assert.equal(result.committed[0].commitSha, "commit-new");
  assert.ok(result.skipped.some((entry) => entry.findingId === "c_test" && /test/.test(entry.reason)));
  assert.equal(recorded.blobs.length, 1);
  assert.match(recorded.blobs[0], /const x = 1;/);
  assert.doesNotMatch(recorded.blobs[0], /undefined/);
  assert.equal(recorded.trees[0].base, "tree-base");
  assert.deepEqual(recorded.trees[0].entries, [{ path: "src/a.ts", blobSha: "blob-1" }]);
  assert.equal(recorded.commits[0].parentSha, "head123");
  assert.match(recorded.commits[0].message, /Cortado-Autocommit: run-1/);
  assert.deepEqual(recorded.refs, [{ branch: "feature", sha: "commit-new" }]);
  assert.match(result.note, /Auto-committed 1 verified fix/);
});

test("auto-commit refuses without contents:write", async () => {
  const { deps, recorded } = harness(
    { "src/a.ts": CONTENT },
    { getInstallationPermissions: async () => ({ contents: "read", pullRequests: "read", checks: "read" }) },
  );
  const result = await autoCommitVerifiedFixes(options([finding()]), deps);
  assert.equal(result.committed.length, 0);
  assert.match(result.skipped[0].reason, /contents:write/);
  assert.equal(recorded.commits.length, 0);
});

test("auto-commit refuses when the branch moved after the review", async () => {
  const { deps, recorded } = harness({ "src/a.ts": CONTENT }, { getBranchHead: async () => "other-head" });
  const result = await autoCommitVerifiedFixes(options([finding()]), deps);
  assert.equal(result.committed.length, 0);
  assert.match(result.skipped[0].reason, /branch moved/);
  assert.equal(recorded.commits.length, 0);
});

test("auto-commit is idempotent per review run", async () => {
  const { deps, recorded } = harness(
    { "src/a.ts": CONTENT },
    { getCommitMessage: async () => "fix: 2 verified Cortado fix(es)\n\nCortado-Autocommit: run-1" },
  );
  const result = await autoCommitVerifiedFixes(options([finding()]), deps);
  assert.equal(result.committed.length, 0);
  assert.match(result.skipped[0].reason, /already auto-committed/);
  assert.equal(recorded.commits.length, 0);
});

test("auto-commit caps the number of findings per run", async () => {
  const { deps } = harness({ "src/a.ts": CONTENT, "src/b.ts": CONTENT });
  const result = await autoCommitVerifiedFixes(options([finding({ id: "c_1" }), finding({ id: "c_2", path: "src/b.ts" })], 1), deps);
  assert.equal(result.committed.length, 1);
  assert.equal(result.committed[0].findingId, "c_1");
  assert.match(result.skipped[0].reason, /limit reached/);
});

test("auto-commit skips edits that no longer match the reviewed commit", async () => {
  const { deps, recorded } = harness({ "src/a.ts": "const a = 1;\nconst x = 1;\nexport default a;" });
  const result = await autoCommitVerifiedFixes(options([finding()]), deps);
  assert.equal(result.committed.length, 0);
  assert.match(result.skipped[0].reason, /no longer match/);
  assert.equal(recorded.commits.length, 0);
});

test("protected path policy covers lockfiles, tests, workflows and env files", () => {
  assert.equal(protectedPathReason("package-lock.json"), "lockfile");
  assert.equal(protectedPathReason("server/package-lock.json"), "lockfile");
  assert.equal(protectedPathReason("src/a.test.ts"), "test");
  assert.equal(protectedPathReason("tests/integration/api.py"), "test");
  assert.equal(protectedPathReason("pkg/handler_test.go"), "test");
  assert.equal(protectedPathReason(".github/workflows/release.yml"), "workflow");
  assert.equal(protectedPathReason("client/.env.local"), "environment");
  assert.equal(protectedPathReason("src/app.ts"), undefined);
});

test("the deny-list covers token-bearing config and key material", () => {
  for (const path of [".npmrc", "packages/app/.envrc", "certs/server.pem", "keys/deploy.key", "config/secrets.yaml", "credentials.json", "ssh/id_rsa"]) {
    assert.ok(protectedPathReason(path), `${path} must be protected`);
  }
  assert.equal(protectedPathReason("src/index.ts"), undefined);
});

test("looksLikeSecret flags literal credentials in a fix", () => {
  assert.equal(looksLikeSecret("const token = 'ghp_abcdefghijklmnopqrstuvwxyz1234';"), true);
  assert.equal(looksLikeSecret("password: \"hunter2hunter2\""), true);
  assert.equal(looksLikeSecret("const token = process.env.GITHUB_TOKEN;"), false);
  assert.equal(looksLikeSecret("const key = config.apiKey;"), false);
});
