import { ModelRouter } from "../../src/models";
import type { ExecResult, ModelClient, ModelResponse, ModelTask, RepoGraphInput, ReviewRequest } from "../../src/types";
import { MemorySandbox, type MemorySandboxOptions } from "../../src/sandbox-memory";
import { resolveEngineConfig } from "../../src/config";

export const BUGGY_BILLING = `import { useEffect } from "react";

export function applyPlan(store: { setItem: (key: string, value: string) => void }, plan: string) {
  store.setItem("ag.activeWorkspaceId", plan);
}

export function currentPlan(store: { getItem: (key: string) => string | null }): string {
  return store.getItem("ag.activeWorkspaceId") ?? "free";
}
`;

export const FIXED_BILLING = BUGGY_BILLING.replace('store.setItem("ag.activeWorkspaceId", plan);', 'store.setItem("ag.activePlan", plan);');

export const REPRO_SCRIPT = `import { readFileSync } from "node:fs";

const source = readFileSync("src/billing.ts", "utf8");
if (/setItem\\("ag\\.activeWorkspaceId", plan\\)/.test(source)) {
  console.error("src/billing.ts writes the plan into ag.activeWorkspaceId");
  process.exit(1);
}
console.log("ok");
`;

export const WORKSPACE_SOURCE = `export const WORKSPACE_KEY = "ag.activeWorkspaceId";

export function readWorkspace(store: { getItem: (key: string) => string | null }): string | null {
  return store.getItem(WORKSPACE_KEY);
}
`;

export function workflowGraph(): RepoGraphInput {
  return {
    files: [
      { path: "src/billing.ts", kind: "source" },
      { path: "src/workspace.ts", kind: "source" },
      { path: "src/billing.test.ts", kind: "test" },
    ],
    connections: [
      { source: "src/workspace.ts", target: "src/billing.ts", kind: "imports" },
      { source: "src/billing.test.ts", target: "src/billing.ts", kind: "imports" },
    ],
    symbols: [
      { id: "src/billing.ts#applyPlan", fileId: "src/billing.ts", name: "applyPlan", qualifiedName: "applyPlan", kind: "function", line: 3, endLine: 5, signature: "applyPlan(store, plan)", exported: true },
      { id: "src/workspace.ts#readWorkspace", fileId: "src/workspace.ts", name: "readWorkspace", qualifiedName: "readWorkspace", kind: "function", line: 3, endLine: 5, signature: "readWorkspace(store)", exported: true },
    ],
    symbolEdges: [{ source: "src/workspace.ts#readWorkspace", target: "src/billing.ts#applyPlan", kind: "calls" }],
    strings: [{ path: "src/workspace.ts", value: "ag.activeWorkspaceId", line: 1 }],
    knowledge: [{ path: "README.md", content: "Workspace selection lives in localStorage." }],
  };
}

export function makeExecHandler(options: { sourcePath?: string; buggy?: () => string } = {}) {
  const sourcePath = options.sourcePath ?? "src/billing.ts";
  return async (command: string, sandbox: MemorySandbox): Promise<ExecResult> => {
    const base = { command, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    if (command.includes("repro.mjs")) {
      const content = await sandbox.read(sourcePath).catch(() => "");
      if (content.includes('setItem("ag.activeWorkspaceId", plan)')) {
        return { ...base, exitCode: 1, stderr: `${sourcePath} writes the plan into ag.activeWorkspaceId` };
      }
      return { ...base, exitCode: 0, stdout: "ok" };
    }
    if (command.includes("repro-does-not-exist") || command.includes("broken.mjs")) {
      return { ...base, exitCode: 1, stderr: "Cannot find module '/repo/.cortado-probes/broken.mjs'" };
    }
    return { ...base, exitCode: 0 };
  };
}

export interface ScriptStep {
  /** Label suffix matcher: "t1", "t2" ... or the full label. */
  match: RegExp;
  /** Response used when the label matches and the call index matches. */
  responses: string[];
}

/**
 * Deterministic scripted client. Responses are keyed by the task label so
 * parallel agents cannot interleave unpredictably.
 */
export class ScriptedClient implements ModelClient {
  readonly id: string;
  private readonly scripts: ScriptStep[];
  private readonly counters = new Map<string, number>();
  private readonly fallback: string;
  readonly seen: string[] = [];

  constructor(id: string, scripts: ScriptStep[], fallback = '{"done":true,"summary":"script exhausted"}') {
    this.id = id;
    this.scripts = scripts;
    this.fallback = fallback;
  }

  async complete(task: ModelTask): Promise<ModelResponse> {
    const label = task.label ?? "";
    this.seen.push(label);
    for (const script of this.scripts) {
      if (!script.match.test(label)) continue;
      const key = `${script.match.source}`;
      const index = this.counters.get(key) ?? 0;
      if (index >= script.responses.length) break;
      this.counters.set(key, index + 1);
      return { text: script.responses[index], model: this.id, tokensIn: 10, tokensOut: 10, durationMs: 1, costUsd: 0.0001 };
    }
    return { text: this.fallback, model: this.id, tokensIn: 10, tokensOut: 10, durationMs: 1, costUsd: 0.0001 };
  }
}

export function makeRouter(investigator: ModelClient, engineer: ModelClient, reviewer: ModelClient, maxCalls = 160): ModelRouter {
  const config = resolveEngineConfig({ models: { apiKey: "test-key" } });
  return new ModelRouter({
    clients: { investigator, engineer, reviewer },
    config: config.models,
    maxCalls,
    maxCostUsd: 0,
  });
}

export function makeSandbox(options: { source?: string; files?: Record<string, string>; exec?: MemorySandboxOptions["exec"]; typecheck?: boolean; tests?: boolean } = {}): MemorySandbox {
  return new MemorySandbox({
    files: {
      "src/billing.ts": options.source ?? BUGGY_BILLING,
      "src/workspace.ts": WORKSPACE_SOURCE,
      "src/billing.test.ts": "test('placeholder', () => {});",
      "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
      ...(options.files ?? {}),
    },
    profile: {
      typecheckCommand: options.typecheck === false ? undefined : "npx tsc --noEmit",
      testCommand: options.tests === false ? undefined : "npm test --silent",
      testFiles: ["src/billing.test.ts"],
    },
    exec: options.exec ?? makeExecHandler(),
  });
}

export function sandboxSnapshot(sandbox: MemorySandbox): Record<string, string> {
  return sandbox.snapshot();
}

export function makeRequest(source: string = BUGGY_BILLING): ReviewRequest {
  return {
    runId: "run-test",
    repo: {
      fullName: "acme/widgets",
      defaultBranch: "main",
      installationId: 1,
      cloneUrl: "https://github.com/acme/widgets.git",
      token: "test-token",
    },
    pr: {
      number: 7,
      title: "training/bug hunt",
      body: "",
      author: "tester",
      baseSha: "base",
      headSha: "head",
      baseBranch: "main",
      headBranch: "training/bug-hunt",
      url: "https://github.com/acme/widgets/pull/7",
    },
    files: [
      {
        path: "src/billing.ts",
        status: "modified" as const,
        content: source,
        patch: "@@ -1,4 +1,5 @@\n import { useEffect } from \"react\";\n \n+export function applyPlan() {}\n",
        additions: 1,
        deletions: 0,
      },
    ],
    rules: [],
    learnings: [],
    settings: {},
    graph: workflowGraph(),
  };
}

export const BUG_HYPOTHESIS = JSON.stringify({
  hypotheses: [
    {
      claim: "Billing writes the user's plan into the ag.activeWorkspaceId storage key, corrupting workspace selection",
      severity: "high",
      confidence: 0.9,
      file: "src/billing.ts",
      line: 3,
      evidence: ["src/billing.ts:4"],
      probe: "repro.mjs",
      suggestedExperiment: "Write the plan under a dedicated key and reload the workspace",
    },
  ],
});

export const BUG_READ = JSON.stringify({
  thought: "read the file first",
  actions: [{ tool: "read_file", args: { path: "src/billing.ts" } }],
  done: false,
});

export const BUG_WRITE_PROBE = JSON.stringify({
  thought: "write the reproduction",
  actions: [{ tool: "write_probe", args: { name: "repro.mjs", content: REPRO_SCRIPT } }],
  done: false,
});

export const BUG_RUN_PROBE = JSON.stringify({
  thought: "run the reproduction",
  actions: [{ tool: "run_probe", args: { name: "repro.mjs" } }],
  done: false,
});

export function severityOf(result: { findings: Array<{ severity: string }> }): string | undefined {
  return result.findings[0]?.severity;
}

