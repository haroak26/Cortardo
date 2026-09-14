import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalSandbox } from "../../../src/sandbox";
import { assessPatchSafety } from "../../../src/sandbox/safety";
import { applyUnifiedDiff } from "../../../src/util/diff";
import { makeUnifiedDiff } from "../../../src/util/diff";
import { CortadoEngine } from "../../../src/engine";
import { ModelRouter } from "../../../src/models/router";
import { OpenAiCompatibleClient } from "../../../src/models/live";
import { resolveConfig } from "../../../src/config";
import { silentLogger } from "../../../src/util/logger";
import { runSwarm, normalizeEvidence } from "../../../src/stages/swarm";
import { discoverTests, relatedTests } from "../../../src/stages/proof";
import { judgeSystemPrompt } from "../../../src/agents/prompts";
import { MemorySandbox } from "../../../src/sandbox";
import { makeCandidate, makeContext } from "../../helpers/factories";
import { defineCases } from "../../exhaustive/types";
import type { ModelClient, ModelTask } from "../../../src/models/types";

const config = resolveConfig({ mode: "dry" });

function tmpRoot(): string {
  return path.join(os.tmpdir(), `cortado-hardening-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

export function buildHardeningGroup() {
  return defineCases("hardening", [
    {
      name: "LocalSandbox cleanup preserves a pre-existing root",
      run: async () => {
        const root = tmpRoot();
        await fs.mkdir(root, { recursive: true });
        const marker = path.join(root, "keep.txt");
        await fs.writeFile(marker, "keep", "utf8");
        const sandbox = new LocalSandbox({ root, files: {} });
        try {
          await sandbox.setup();
          await sandbox.cleanup();
          assert.equal(await fs.readFile(marker, "utf8"), "keep");
        } finally {
          await fs.rm(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: "LocalSandbox cleanup removes a self-created root",
      run: async () => {
        const root = tmpRoot();
        const sandbox = new LocalSandbox({ root, files: {} });
        await sandbox.setup();
        await sandbox.cleanup();
        await assert.rejects(() => fs.access(root));
      },
    },
    {
      name: "LocalSandbox cleanup honours an explicit override",
      run: async () => {
        const root = tmpRoot();
        await fs.mkdir(root, { recursive: true });
        const sandbox = new LocalSandbox({ root, files: {}, cleanupRoot: true });
        await sandbox.setup();
        await sandbox.cleanup();
        await assert.rejects(() => fs.access(root));
      },
    },
    {
      name: "LocalSandbox hides host secrets from commands",
      run: async () => {
        process.env.CORTADO_TEST_SECRET = "top-secret-value";
        const sandbox = new LocalSandbox({ root: tmpRoot(), files: {}, timeoutMs: 5000 });
        try {
          await sandbox.setup();
          const result = await sandbox.exec('printf "%s" "$CORTADO_TEST_SECRET"');
          assert.equal(result.stdout, "");
          assert.equal(result.exitCode, 0);
        } finally {
          delete process.env.CORTADO_TEST_SECRET;
          await sandbox.cleanup();
        }
      },
    },
    {
      name: "LocalSandbox keeps PATH available",
      run: async () => {
        const sandbox = new LocalSandbox({ root: tmpRoot(), files: {}, timeoutMs: 5000 });
        try {
          await sandbox.setup();
          const result = await sandbox.exec('printf "%s" "$PATH"');
          assert.ok(result.stdout.length > 0);
        } finally {
          await sandbox.cleanup();
        }
      },
    },
    {
      name: "LocalSandbox forwards explicit command env",
      run: async () => {
        const sandbox = new LocalSandbox({ root: tmpRoot(), files: {}, timeoutMs: 5000 });
        try {
          await sandbox.setup();
          const result = await sandbox.exec('printf "%s" "$CORTADO_CUSTOM"', {
            env: { CORTADO_CUSTOM: "allowed" },
          });
          assert.equal(result.stdout, "allowed");
        } finally {
          await sandbox.cleanup();
        }
      },
    },
    {
      name: "local sandbox warm skips dependency installs without network",
      run: async () => {
        const sandbox = new LocalSandbox({
          root: tmpRoot(),
          files: { "package.json": "{}" },
          warmDependencies: true,
          allowNetwork: false,
        });
        try {
          await sandbox.setup();
          await sandbox.warm();
          assert.equal(sandbox.toolCalls, 0);
        } finally {
          await sandbox.cleanup();
        }
      },
    },
    {
      name: "local sandbox applies new-file patches from /dev/null",
      run: async () => {
        const sandbox = new LocalSandbox({ root: tmpRoot(), files: {}, timeoutMs: 5000 });
        try {
          await sandbox.setup();
          const patch = "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;\n";
          const result = await sandbox.applyPatch(patch);
          assert.equal(result.ok, true, result.reason);
          assert.equal(await sandbox.read("src/new.ts"), "export const a = 1;\nexport const b = 2;\n");
        } finally {
          await sandbox.cleanup();
        }
      },
    },
    {
      name: "local sandbox applies deletion patches to /dev/null",
      run: async () => {
        const sandbox = new LocalSandbox({ root: tmpRoot(), files: { "src/gone.ts": "a\nb\n" }, timeoutMs: 5000 });
        try {
          await sandbox.setup();
          const patch = "--- a/src/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n";
          const result = await sandbox.applyPatch(patch);
          assert.equal(result.ok, true, result.reason);
          assert.equal(await sandbox.exists("src/gone.ts"), false);
        } finally {
          await sandbox.cleanup();
        }
      },
    },
    {
      name: "local sandbox rejects patches that escape the root",
      run: async () => {
        const sandbox = new LocalSandbox({ root: tmpRoot(), files: {}, timeoutMs: 5000 });
        try {
          await sandbox.setup();
          const patch = "--- a/../escape.ts\n+++ b/../escape.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n";
          const result = await sandbox.applyPatch(patch);
          assert.equal(result.ok, false);
          assert.match(result.files[0].reason ?? "", /escapes sandbox root/);
        } finally {
          await sandbox.cleanup();
        }
      },
    },
    {
      name: "relatedTests ignores substring false positives",
      run: () => {
        const tests = relatedTests(
          makeCandidate({ id: "c1", file: "src/a.ts" }),
          makeContext({ tests: ["tests/data.test.ts", "tests/banana.test.ts"] }),
        );
        assert.deepEqual(tests, []);
      },
    },
    {
      name: "relatedTests matches the same stem",
      run: () => {
        const tests = relatedTests(
          makeCandidate({ id: "c1", file: "server/auth/session.ts" }),
          makeContext({ tests: ["server/auth/session.test.ts"] }),
        );
        assert.deepEqual(tests, ["server/auth/session.test.ts"]);
      },
    },
    {
      name: "discoverTests ignores substring false positives",
      run: async () => {
        const sandbox = new MemorySandbox({
          files: { "tests/data.test.ts": "", "tests/banana.test.ts": "" },
        });
        const tests = await discoverTests(
          makeCandidate({ id: "c1", file: "src/a.ts" }),
          makeContext({ tests: [] }),
          sandbox,
        );
        assert.deepEqual(tests, []);
      },
    },
    {
      name: "discoverTests finds an exact stem match",
      run: async () => {
        const sandbox = new MemorySandbox({ files: { "server/auth/session.test.ts": "" } });
        const tests = await discoverTests(
          makeCandidate({ id: "c1", file: "server/auth/session.ts" }),
          makeContext({ tests: [] }),
          sandbox,
        );
        assert.deepEqual(tests, ["server/auth/session.test.ts"]);
      },
    },
    {
      name: "normalizeEvidence accepts plain file:line",
      run: () => assert.equal(normalizeEvidence("src/app.ts:10"), "src/app.ts:10"),
    },
    {
      name: "normalizeEvidence accepts ranges and columns",
      run: () => {
        assert.equal(normalizeEvidence("src/app.ts:10-14"), "src/app.ts:10");
        assert.equal(normalizeEvidence("src/app.ts:10:4"), "src/app.ts:10");
      },
    },
    {
      name: "normalizeEvidence strips backticks and dot slashes",
      run: () => assert.equal(normalizeEvidence("`./src/app.ts:42`"), "src/app.ts:42"),
    },
    {
      name: "normalizeEvidence rejects garbage and traversal",
      run: () => {
        assert.equal(normalizeEvidence("not-a-location"), null);
        assert.equal(normalizeEvidence("../etc/passwd:1"), null);
        assert.equal(normalizeEvidence("src/app.ts"), null);
      },
    },
    {
      name: "swarm stores normalized evidence",
      run: async () => {
        const luna: ModelClient = {
          id: "ranges",
          dryRun: true,
          complete: async () => ({
            text: JSON.stringify({
              hypotheses: [
                {
                  claim: "Range evidence defect in the changed module",
                  evidence: ["src/app.ts:10-14", "`./src/app.ts:20`"],
                  severity: "high",
                  confidence: 0.8,
                  suggestedExperiment: "run the test",
                },
              ],
            }),
            model: "ranges",
            tokensIn: 1,
            tokensOut: 1,
            durationMs: 1,
          }),
        };
        const router = new ModelRouter({ config: config.models, mode: "dry", luna, terra: luna, astra: luna });
        const report = await runSwarm(
          makeContext({ id: "pr", size: "tiny", classification: ["UNKNOWN"], files: [] }),
          { title: "t", files: [] },
          router,
          config,
          silentLogger,
        );
        assert.deepEqual(report.hypotheses[0].evidence, ["src/app.ts:10", "src/app.ts:20"]);
      },
    },
    {
      name: "live client applies the default model timeout",
      run: async () => {
        const fakeFetch = ((_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(new Response(JSON.stringify({ choices: [{ message: { content: "late" } }] }), { status: 200 })), 40);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("aborted by default timeout"));
            });
          })) as unknown as typeof fetch;
        const client = new OpenAiCompatibleClient({
          role: "luna",
          model: "luna-test",
          config: { ...config.models, apiKey: "k", timeoutMs: 5, maxRetries: 0 },
          fetchImpl: fakeFetch,
        });
        await assert.rejects(() => client.complete(taskFor()), /aborted by default timeout/);
      },
    },
    {
      name: "explicit task timeout overrides the default",
      run: async () => {
        const fakeFetch = ((_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(new Response(JSON.stringify({ choices: [{ message: { content: "on time" } }] }), { status: 200 })), 30);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("aborted early"));
            });
          })) as unknown as typeof fetch;
        const client = new OpenAiCompatibleClient({
          role: "luna",
          model: "luna-test",
          config: { ...config.models, apiKey: "k", timeoutMs: 5, maxRetries: 0 },
          fetchImpl: fakeFetch,
        });
        const response = await client.complete(taskFor({ timeoutMs: 1000 }));
        assert.equal(response.text, "on time");
      },
    },
    {
      name: "judge prompt documents the probe marker contract",
      run: () => {
        const prompt = judgeSystemPrompt();
        assert.match(prompt, /CORTADO_VULNERABLE/);
        assert.match(prompt, /CORTADO_SAFE/);
        assert.match(prompt, /reproductionCommand/);
      },
    },
    {
      name: "patch safety rejects traversal paths",
      run: () => {
        const findings = assessPatchSafety("", [{ path: "../escape.ts", removedLines: [], addedLines: [] }]);
        assert.ok(findings.some((finding) => finding.reason.includes("outside the repository")));
      },
    },
    {
      name: "patch safety rejects absolute paths",
      run: () => {
        const findings = assessPatchSafety("", [{ path: "/etc/passwd", removedLines: [], addedLines: [] }]);
        assert.ok(findings.some((finding) => finding.reason.includes("outside the repository")));
      },
    },
    {
      name: "new-file patches apply through the shared diff engine",
      run: () => {
        const files: Record<string, string> = {};
        const patch = "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+export const a = 1;\n";
        const result = applyUnifiedDiff(patch, files);
        assert.equal(result.ok, true, result.reason);
        assert.equal(files["src/new.ts"], "export const a = 1;\n");
      },
    },
    {
      name: "deletion patches remove the record entry",
      run: () => {
        const files: Record<string, string> = { "src/gone.ts": "a\n" };
        const patch = "--- a/src/gone.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n";
        const result = applyUnifiedDiff(patch, files);
        assert.equal(result.ok, true, result.reason);
        assert.equal(files["src/gone.ts"], undefined);
      },
    },
    {
      name: "engine preserves a host supplied sandbox root",
      run: async () => {
        const root = tmpRoot();
        await fs.mkdir(root, { recursive: true });
        const marker = path.join(root, "keep.txt");
        await fs.writeFile(marker, "keep", "utf8");
        const sandbox = new LocalSandbox({ root, files: {} });
        try {
          const engine = new CortadoEngine({ mode: "dry", sandbox, logger: silentLogger });
          const result = await engine.run({ title: "preserve", files: [] });
          assert.equal(result.status, "completed");
          assert.equal(await fs.readFile(marker, "utf8"), "keep");
        } finally {
          await fs.rm(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: "engine dry mode still uses the safe default sandbox",
      run: async () => {
        const result = await new CortadoEngine({ logger: silentLogger }).run({ title: "default", files: [] });
        assert.equal(result.status, "completed");
        assert.equal(result.dryRun, true);
      },
    },
  ]);
}

function taskFor(overrides: Partial<ModelTask> = {}): ModelTask {
  return {
    role: overrides.role ?? "luna",
    kind: overrides.kind ?? "swarm_agent",
    system: overrides.system ?? "system",
    user: overrides.user ?? "user",
    expectJson: overrides.expectJson ?? true,
    context: overrides.context ?? {},
    timeoutMs: overrides.timeoutMs,
  };
}
