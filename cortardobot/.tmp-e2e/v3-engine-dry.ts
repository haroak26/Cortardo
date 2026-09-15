import { readFileSync } from "node:fs";
import { CortadoV3Engine } from "../src/v3/engine.ts";
import { MemorySandbox } from "../src/v3/sandbox-memory.ts";
import type { BrowserCheck, BrowserCheckResult, ModelClient, ModelTask, ReviewRequest } from "../src/v3/types.ts";

const input = JSON.parse(readFileSync("/home/runner/workspace/cortardobot/.tmp-e2e/pr6-input.json", "utf8"));
const files: Record<string, string> = {};
for (const file of input.files) files[file.path] = file.content;
const request: ReviewRequest = {
  runId: "dry-replay",
  repo: { fullName: "haroak26/Artificial-Gateway", defaultBranch: "main", installationId: 1, cloneUrl: "x", token: "x" },
  pr: { number: 6, title: input.title, body: input.body ?? "", baseSha: "", headSha: "0b19da07", baseBranch: "main", headBranch: "new-pricing-page" },
  files: input.files,
};

function checkPassed(route: string, sandboxFiles: Record<string, string>): boolean {
  const docs = sandboxFiles["client/src/pages/Docs.tsx"] ?? "";
  const pricing = sandboxFiles["client/src/pages/Pricing.tsx"] ?? "";
  const auth = sandboxFiles["client/src/pages/Auth.tsx"] ?? "";
  if (route === "/docs") return !docs.includes("undefinedValue.property.nested.value");
  if (route === "/pricing") return !pricing.includes(".filter((_, i) => i !== 1)");
  if (route === "/auth") return auth.includes('setLocation("/auth/register")');
  return true;
}

let currentFiles: Record<string, string> = { ...files };
const sandbox = new MemorySandbox({
  files,
  profile: { typecheckCommand: "npm run check --silent", devCommand: "npx vite" },
  execHandler: (command) => ({ exitCode: command.includes("check") ? 0 : 0, stdout: "ok" }),
  browserHandler: (checks: Array<{ id: string; check: BrowserCheck }>): BrowserCheckResult[] =>
    checks.map((entry) => {
      const passed = checkPassed(entry.check.path, currentFiles);
      return {
        id: entry.id,
        path: entry.check.path,
        passed,
        pageErrors: passed ? [] : ["TypeError: Cannot read properties of undefined (reading 'property')"],
        consoleErrors: [],
        detail: passed ? "assertion passed" : "assertion failed",
        durationMs: 1,
      };
    }),
});

const originalApply = sandbox.applyEdits.bind(sandbox);
sandbox.applyEdits = async (edits) => {
  const result = await originalApply(edits);
  currentFiles = Object.fromEntries((
    await Promise.all((await sandbox.list()).map(async (path) => [path, await sandbox.read(path)] as const))
  ));
  return result;
};

const repairEdits: Record<string, { path: string; find: string; replace: string }> = {
  Docs: {
    path: "client/src/pages/Docs.tsx",
    find: "  const undefinedValue = undefined as any;\n  console.log(undefinedValue.property.nested.value);",
    replace: "",
  },
  Pricing: {
    path: "client/src/pages/Pricing.tsx",
    find: "{tiers.filter((_, i) => i !== 1).map((tier, index) => {",
    replace: "{tiers.map((tier, index) => {",
  },
  Auth: {
    path: "client/src/pages/Auth.tsx",
    find: 'onClick={() => setLocation("/")}',
    replace: 'onClick={() => setLocation("/auth/register")}',
  },
};

function scripted(role: "terra" | "astra" | "luna"): ModelClient {
  return {
    id: `scripted-${role}`,
    async complete(task: ModelTask) {
      const base = { model: "scripted", tokensIn: 10, tokensOut: 10, durationMs: 1 };
      if (role === "terra" && task.kind === "repair") {
        const match = /## Source file (.+?) \(/.exec(task.user);
        const path = match?.[1] ?? "";
        const edit = repairEdits[path.split("/").pop()?.replace(".tsx", "") ?? ""];
        const adjusted = edit && path.endsWith("Pricing.tsx") ? { ...edit, find: `${edit.find}\n` } : edit;
        return {
          ...base,
          text: JSON.stringify({ strategy: `fix ${path}`, rationale: "root cause", edits: adjusted ? [adjusted] : [] }),
        };
      }
      if (role === "astra" && task.kind === "final_review") {
        const ids = [...task.user.matchAll(/## Finding (\S+)/g)].map((match) => match[1]);
        return {
          ...base,
          text: JSON.stringify({
            reviews: ids.map((candidateId) => ({ candidateId, validity: "valid", fixCorrectness: "correct", risk: "low", approval: "approve", confidence: 0.9, summary: `xxx${"y".repeat(1200)}` })),
          }),
        };
      }
      if (role === "terra") return { ...base, text: '{"decisions":[]}' };
      return { ...base, text: '{"hypotheses":[],"reviews":[]}' };
    },
  };
}

const engine = new CortadoV3Engine({
  config: { mode: "live" },
  models: { luna: scripted("luna"), terra: scripted("terra"), astra: scripted("astra") },
  sandboxFactory: async () => sandbox,
  logger: { debug: () => {}, info: () => {}, warn: (m) => console.log("WARN", m), error: (m) => console.log("ERROR", m) },
});

const result = await engine.run(request);
console.log(`status=${result.status} candidates=${result.candidates.length} confirmed=${result.summary.issuesConfirmed} fixed=${result.summary.issuesFixed} verified=${result.summary.issuesVerified}`);
console.log("decisions:", result.decisions.map((d) => `${d.verdict} p${d.priority} ${d.candidateId} ${d.reason}`).join(" | "));
console.log("proofs:", result.proofs.map((p) => `${p.status}/${p.strategy} ${p.explanation.slice(0, 80)}`).join(" | "));
for (const finding of result.findings) {
  console.log(`- ${finding.candidate.file}:${finding.candidate.line} proof=${finding.proof.status} repair=${finding.repair?.exit} attempts=${finding.repair?.attempts.length} verification=${finding.verification?.passed}`);
}
const pricingRepair = result.repairs.find((repair) => result.candidates.find((candidate) => candidate.id === repair.candidateId)?.file?.endsWith("Pricing.tsx"));
const patchOk = Boolean(pricingRepair?.finalPatch?.includes("Pricing.tsx") && pricingRepair.finalPatch.includes("tiers.map"));
const astraOk = result.reviews.every((review) => review.summary.length <= 700) && result.reviews.some((review) => review.summary.includes("xxx"));
console.log(`locateEdit trailing-newline patch ok=${patchOk} | astra truncation ok=${astraOk}`);
const ok = result.summary.issuesVerified === 3 && result.summary.issuesFixed === 3 && patchOk && astraOk;
console.log(ok ? "DRY REPLAY PASS" : "DRY REPLAY FAIL");
if (!ok) process.exit(1);
