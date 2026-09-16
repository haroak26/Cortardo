import assert from "node:assert/strict";
import { test } from "node:test";
import { repairFindings } from "../../src/v3/repair.ts";
import { classifyFailure } from "../../src/v3/agent/loop.ts";
import { ModelRouter } from "../../src/v3/models.ts";
import { resolveV3Config } from "../../src/v3/config.ts";
import { MemoryCacheStore } from "../../src/v3/cache/memory-store.ts";
import { candidate, contentProof, contextWith, packFor, proof, scriptedClient, silentLogger } from "./helpers.ts";
import { MemorySandbox } from "../../src/v3/sandbox-memory.ts";
import type { ContextPack, ModelTask } from "../../src/v3/types.ts";

const ORIGINAL = "const x = undefined\nconst y = 2\n";
const FIXED = "const x = 1\nconst y = 2\n";

function editResponse(find: string, replace: string, path = "src/a.ts"): string {
  return JSON.stringify({ thought: "fix it", strategy: "exact edit", actions: [{ tool: "apply_edit", args: { edits: [{ path, find, replace }] } }] });
}

const FINISH_RESPONSE = JSON.stringify({ thought: "cannot fix", done: true, summary: "no safe fix" });

function multiEditResponse(edits: Array<{ path: string; find: string; replace: string }>): string {
  return JSON.stringify({ thought: "multi-file fix", strategy: "two-file edit", actions: [{ tool: "apply_edit", args: { edits } }] });
}

function terra(script: string[], role: "luna" | "terra" | "astra" = "terra") {
  return scriptedClient(role, (_task: ModelTask, index: number) => script[Math.min(index, script.length - 1)]!);
}

function router(terraClient: ReturnType<typeof scriptedClient>) {
  const config = resolveV3Config().models;
  const idle = scriptedClient("luna", () => "{}");
  const astra = scriptedClient("astra", () => JSON.stringify({ reviews: [] }));
  return new ModelRouter({ clients: { luna: idle, terra: terraClient, codegen: terraClient, astra }, config, maxCalls: 60 });
}

async function runRepair(options: {
  script: string[];
  files?: Record<string, string>;
  autoFix?: boolean;
  cache?: MemoryCacheStore;
  cachePack?: (candidateId: string) => ContextPack;
  execHandler?: (command: string) => { exitCode: number; stdout?: string };
  defect?: (content: string) => boolean;
}) {
  const files = options.files ?? { "src/a.ts": ORIGINAL };
  const sandbox = new MemorySandbox({
    files,
    profile: { typecheckCommand: "true" },
    execHandler: options.execHandler ?? (() => ({ exitCode: 0, stdout: "" })),
  });
  const candidateValue = candidate({ file: "src/a.ts", autoFix: options.autoFix ? [{ path: "src/a.ts", find: "const x = undefined", replace: "const x = 1" }] : undefined });
  const context = contextWith([{ path: "src/a.ts", content: ORIGINAL }]);
  const terraClient = terra(options.script);
  let cost = 0;
  const repairs = await repairFindings([proof(candidateValue)], [candidateValue], context, {
    sandbox,
    models: router(terraClient),
    profile: { packageManager: "npm", installCommand: "npm ci", hasNodeModules: true, hasTests: false, typecheckCommand: "true", scripts: {} },
    logger: silentLogger,
    maxAttempts: 2,
    maxRepairs: 3,
    maxTurns: 3,
    maxToolsPerTurn: 4,
    proveCandidate: contentProof(sandbox, "src/a.ts", options.defect ?? ((content) => content.includes("undefined"))),
    contextPackFor: async (cand) => options.cachePack?.(cand.id) ?? packFor(cand, [{ path: "src/a.ts", content: ORIGINAL }]),
    cache: options.cache,
    cacheTtlMs: 60_000,
    repo: "o/r",
    headSha: "sha1",
    modelId: "openai/gpt-5.6-terra",
    costNow: () => (cost += 0.01),
  });
  return { repair: repairs[0]!, sandbox, terraClient };
}

test("agent fixes the defect on the first attempt with a real patch", async () => {
  const { repair, sandbox } = await runRepair({ script: [editResponse("const x = undefined", "const x = 1")] });
  assert.equal(repair.exit, "VERIFIED");
  assert.equal(repair.attempts.length, 1);
  assert.ok(repair.finalPatch?.includes("@@"));
  assert.match(repair.finalPatch!, /-const x = undefined/);
  assert.match(repair.finalPatch!, /\+const x = 1/);
  assert.equal(await sandbox.read("src/a.ts"), FIXED);
});

test("a no-op edit is rejected and the agent adapts within the attempt", async () => {
  const { repair, sandbox } = await runRepair({
    script: [editResponse("const x = undefined", "const x = undefined"), editResponse("const x = undefined", "const x = 1")],
  });
  assert.equal(repair.exit, "VERIFIED");
  assert.equal(repair.attempts.length, 1);
  assert.ok(repair.transcript?.turns.some((turn) => turn.observations.some((observation) => /no-op edit rejected/.test(observation.summary))));
  assert.equal(await sandbox.read("src/a.ts"), FIXED);
});

test("a failed edit cannot be repeated verbatim", async () => {
  const { repair } = await runRepair({
    script: [editResponse("THIS DOES NOT EXIST", "x"), editResponse("THIS DOES NOT EXIST", "x"), editResponse("const x = undefined", "const x = 1")],
  });
  assert.equal(repair.exit, "VERIFIED");
  assert.ok(repair.transcript?.turns.some((turn) => turn.observations.some((observation) => /duplicate edit rejected/.test(observation.summary))));
});

test("deterministic fallback saves the repair after two failed model attempts", async () => {
  const { repair } = await runRepair({ script: [FINISH_RESPONSE, FINISH_RESPONSE], autoFix: true });
  assert.equal(repair.exit, "VERIFIED");
  assert.equal(repair.attempts.length, 3);
  assert.match(repair.attempts[2]!.strategy, /deterministic/);
});

test("an unfixed defect is reported unresolved and the file is restored", async () => {
  const { repair, sandbox } = await runRepair({
    script: [editResponse("const y = 2", "const y = 3"), FINISH_RESPONSE],
  });
  assert.equal(repair.exit, "UNRESOLVED");
  assert.equal(await sandbox.read("src/a.ts"), ORIGINAL);
});

test("a verified fix is cached and re-verified on the next run without model calls", async () => {
  const cache = new MemoryCacheStore();
  const first = await runRepair({ script: [editResponse("const x = undefined", "const x = 1")], cache });
  assert.equal(first.repair.exit, "VERIFIED");
  assert.equal(first.repair.servedFromCache, undefined);
  const callsAfterFirst = first.terraClient.calls.length;

  await first.sandbox.write("src/a.ts", ORIGINAL);
  const second = await runRepair({ script: [FINISH_RESPONSE], cache, files: { "src/a.ts": ORIGINAL } });
  assert.equal(second.repair.exit, "VERIFIED");
  assert.equal(second.repair.servedFromCache, true);
  assert.equal(second.terraClient.calls.length, 0);
  assert.ok(callsAfterFirst > 0);
  assert.ok(cache.stats().creditsSavedUsd > 0);
});

test("a cached fix whose re-check fails is restored before the fallback agent runs", async () => {
  const cache = new MemoryCacheStore();
  const first = await runRepair({ script: [editResponse("const x = undefined", "const x = 1")], cache });
  assert.equal(first.repair.exit, "VERIFIED");

  const second = await runRepair({
    script: [FINISH_RESPONSE],
    cache,
    defect: (content) => content.includes("const x = 1"),
  });
  assert.equal(second.repair.exit, "UNRESOLVED");
  assert.equal(await second.sandbox.read("src/a.ts"), ORIGINAL, "the failed cached edit must not leak into the fallback agent");
});

test("an aborted agent restores the file and does not leak probes", async () => {
  const { sandbox } = await runRepair({ script: ['{"not":"an action"}', FINISH_RESPONSE] });
  assert.equal(await sandbox.read("src/a.ts"), ORIGINAL);
});

test("a failing authored probe is captured and promoted with the verified fix", async () => {
  const probeResponse = JSON.stringify({
    thought: "reproduce with a probe",
    strategy: "probe first",
    actions: [
      { tool: "write_probe", args: { name: "repro.test.ts", content: "test('repro', () => { throw new Error('boom') })" } },
      { tool: "run_probe", args: { name: "repro.test.ts" } },
    ],
  });
  const { repair } = await runRepair({
    script: [probeResponse, editResponse("const x = undefined", "const x = 1")],
    execHandler: (command) => ({ exitCode: command.includes("repro.test.ts") ? 1 : 0, stdout: "boom" }),
  });
  assert.equal(repair.exit, "VERIFIED");
  assert.ok(repair.probe, "the failing probe is attached to the verified repair");
  assert.equal(repair.probe!.name, "repro.test.ts");
  assert.equal(repair.probe!.passed, false);
  assert.match(repair.probe!.content, /throw new Error\('boom'\)/);
  assert.match(repair.probe!.command, /repro\.test\.ts/);
});

test("a probe that only ever passes is not promoted", async () => {
  const probeResponse = JSON.stringify({
    thought: "health check",
    actions: [
      { tool: "write_probe", args: { name: "sanity.test.ts", content: "test('sanity', () => { expect(1).toBe(1) })" } },
      { tool: "run_probe", args: { name: "sanity.test.ts" } },
    ],
  });
  const { repair } = await runRepair({
    script: [probeResponse, editResponse("const x = undefined", "const x = 1")],
  });
  assert.equal(repair.exit, "VERIFIED");
  assert.equal(repair.probe, undefined);
});

test("a failed fix is diagnosed and the next attempt follows the new strategy", async () => {
  const diagnosis = JSON.stringify({
    category: "reproduction_still_confirms",
    reason: "the edit changed an unrelated constant",
    nextStrategy: "replace the undefined constant itself",
  });
  const { repair, terraClient } = await runRepair({
    script: [editResponse("const y = 2", "const y = 3"), diagnosis, editResponse("const x = undefined", "const x = 1")],
  });
  assert.equal(repair.exit, "VERIFIED");
  assert.equal(repair.attempts.length, 2);
  const first = repair.attempts[0]!;
  assert.equal(first.failure?.category, "reproduction_still_confirms");
  assert.equal(first.diagnosis, "the edit changed an unrelated constant");
  assert.match(first.failure?.nextStrategy ?? "", /undefined constant/);
  assert.match(first.failure?.attemptedDiff ?? "", /const y = 3/);
  assert.equal(terraClient.calls[1]?.kind, "diagnosis");
  const secondPrompt = `${terraClient.calls[2]?.user ?? ""}\n${(terraClient.calls[2]?.history ?? []).map((message) => message.content).join("\n")}`;
  assert.match(secondPrompt, /Why the previous attempt failed \(reproduction_still_confirms\)/);
  assert.match(secondPrompt, /replace the undefined constant itself/);
  assert.match(secondPrompt, /const y = 3/);
});

test("a failed multi-file attempt restores every file it touched", async () => {
  const diagnosis = JSON.stringify({ reason: "the edit changed unrelated lines", nextStrategy: "edit the undefined constant itself" });
  const { repair, sandbox } = await runRepair({
    files: { "src/a.ts": ORIGINAL, "src/b.ts": "export const b = 2\n" },
    script: [
      multiEditResponse([
        { path: "src/a.ts", find: "const y = 2", replace: "const y = 3" },
        { path: "src/b.ts", find: "const b = 2", replace: "const b = 3" },
      ]),
      diagnosis,
      FINISH_RESPONSE,
    ],
  });
  assert.equal(repair.exit, "UNRESOLVED");
  assert.equal(await sandbox.read("src/a.ts"), ORIGINAL);
  assert.equal(await sandbox.read("src/b.ts"), "export const b = 2\n");
  assert.deepEqual(repair.attempts[0]?.failure?.files.sort(), ["src/a.ts", "src/b.ts"]);
});

test("a diagnosis from one finding becomes a lesson for the next finding in the run", async () => {
  const files = { "src/a.ts": ORIGINAL, "src/b.ts": "export const b = 1\n" };
  const sandbox = new MemorySandbox({ files, profile: { typecheckCommand: "true" }, execHandler: () => ({ exitCode: 0, stdout: "" }) });
  const a = candidate({ id: "c_a", file: "src/a.ts", claim: "defect A: the undefined constant is dereferenced" });
  const b = candidate({ id: "c_b", file: "src/b.ts", claim: "defect B: unrelated sibling bug" });
  const prompts: string[] = [];
  const terraClient = scriptedClient("terra", (task: ModelTask) => {
    const user = `${task.user}\n${(task.history ?? []).map((message) => message.content).join("\n")}`;
    if (task.kind === "diagnosis") {
      return JSON.stringify({ category: "reproduction_still_confirms", reason: "the edit touched an unrelated line", nextStrategy: "rewrite the undefined constant" });
    }
    if (/defect A/.test(user)) {
      return /Why the previous attempt failed/.test(user) ? FINISH_RESPONSE : editResponse("const y = 2", "const y = 3");
    }
    prompts.push(user);
    return FINISH_RESPONSE;
  });
  const idle = scriptedClient("luna", () => "{}");
  const astra = scriptedClient("astra", () => JSON.stringify({ reviews: [] }));
  const router = new ModelRouter({ clients: { luna: idle, terra: terraClient, codegen: terraClient, astra }, config: resolveV3Config().models, maxCalls: 60 });
  let cost = 0;
  const context = contextWith([
    { path: "src/a.ts", content: ORIGINAL },
    { path: "src/b.ts", content: files["src/b.ts"] },
  ]);
  const repairs = await repairFindings([proof(a), proof(b)], [a, b], context, {
    sandbox,
    models: router,
    profile: { packageManager: "npm", installCommand: "npm ci", hasNodeModules: true, hasTests: false, typecheckCommand: "true", scripts: {} },
    logger: silentLogger,
    maxAttempts: 2,
    maxRepairs: 3,
    maxTurns: 3,
    maxToolsPerTurn: 4,
    proveCandidate: contentProof(sandbox, "src/a.ts", (content) => content.includes("undefined")),
    contextPackFor: async (candidateValue) =>
      packFor(candidateValue, [{ path: candidateValue.file!, content: files[candidateValue.file as keyof typeof files] }]),
    costNow: () => (cost += 0.01),
  });
  assert.equal(repairs.length, 2);
  const nextFindingPrompt = prompts.join("\n");
  assert.match(nextFindingPrompt, /Lessons from other repair attempts in this run/);
  assert.match(nextFindingPrompt, /rewrite the undefined constant/);
});

test("failure classification is deterministic when no diagnosis call is warranted", () => {
  const modelError = classifyFailure({
    attempt: 1,
    strategy: "x",
    edits: [],
    applied: false,
    applyReason: "model call failed: upstream 500",
    testPassed: false,
  });
  assert.equal(modelError.category, "model_error");
  assert.match(modelError.nextStrategy, /retry/i);
  const noEdit = classifyFailure({
    attempt: 1,
    strategy: "x",
    edits: [],
    applied: false,
    applyReason: "agent finished without a verified fix",
    testPassed: false,
  });
  assert.equal(noEdit.category, "no_edit");
});

test("an inconclusive reproduction never verifies a repair", async () => {
  const files = { "src/a.ts": ORIGINAL };
  const sandbox = new MemorySandbox({
    files,
    profile: { typecheckCommand: "true" },
    execHandler: () => ({ exitCode: 0, stdout: "" }),
  });
  const candidateValue = candidate({ file: "src/a.ts" });
  const context = contextWith([{ path: "src/a.ts", content: ORIGINAL }]);
  const terraClient = terra([editResponse("const x = undefined", "const x = 1"), FINISH_RESPONSE]);
  let cost = 0;
  const repairs = await repairFindings([proof(candidateValue)], [candidateValue], context, {
    sandbox,
    models: router(terraClient),
    profile: { packageManager: "npm", installCommand: "npm ci", hasNodeModules: true, hasTests: false, typecheckCommand: "true", scripts: {} },
    logger: silentLogger,
    maxAttempts: 2,
    maxRepairs: 3,
    maxTurns: 2,
    maxToolsPerTurn: 4,
    // The harness could not run: 3.3 treated this as "the defect did not
    // reproduce" and marked the repair VERIFIED. It must not (3.4).
    proveCandidate: async () => ({
      candidateId: candidateValue.id,
      status: "error" as const,
      strategy: "none" as const,
      attempts: [],
      reproduction: "harness failed",
      explanation: "the browser harness could not run",
      durationMs: 1,
    }),
    contextPackFor: async (cand) => packFor(cand, [{ path: "src/a.ts", content: ORIGINAL }]),
    costNow: () => (cost += 0.01),
  });
  assert.notEqual(repairs[0]!.exit, "VERIFIED");
  assert.equal(await sandbox.read("src/a.ts"), ORIGINAL, "the failed edit is restored");
});
