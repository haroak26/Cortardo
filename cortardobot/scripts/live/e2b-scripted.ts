/**
 * Ladder step 3 — real E2B sandbox, scripted models (zero gateway spend).
 *
 * Clones a real pull request into E2B, proves the detector findings in a real
 * Chromium, repairs them with the engine-derived deterministic edits, and
 * verifies the fixes end to end. This validates the sandbox, browser harness,
 * agent plumbing and publisher inputs without spending model credits.
 *
 *   GITHUB_TOKEN=... E2B_API_KEY=... \
 *     node --import tsx scripts/live/e2b-scripted.ts --input .tmp-e2e/pr6-input.json
 *
 * Never run this in CI.
 */
import { readFileSync } from "node:fs";
import { CortadoV3Engine } from "../../src/v3/engine.ts";
import { E2BSandboxInstance } from "../../src/v3/sandbox-e2b.ts";
import { resolveV3Config } from "../../src/v3/config.ts";
import { createLogger } from "../../src/v3/util.ts";
import { analyzeChanges } from "../../src/v3/intelligence.ts";
import { runDetectors } from "../../src/v3/detectors.ts";
import type { ModelClient, ModelTask, ReviewRequest } from "../../src/v3/types.ts";

interface InputFile {
  path: string;
  content?: string;
  patch?: string;
  status?: "added" | "modified" | "removed" | "renamed";
}

interface Input {
  id?: string;
  title?: string;
  body?: string;
  files: InputFile[];
}

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const inputPath = arg("--input", ".tmp-e2e/pr6-input.json")!;
const installationId = Number(arg("--installation-id", process.env.CORTADO_INSTALLATION_ID ?? "0"));
const repoFullName = arg("--repo", "haroak26/Artificial-Gateway")!;
const headBranch = arg("--head-branch", "new-pricing-page")!;

const input = JSON.parse(readFileSync(inputPath, "utf8")) as Input;

async function resolveToken(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY || !installationId) {
    throw new Error("Provide GITHUB_TOKEN, or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + CORTADO_INSTALLATION_ID");
  }
  const { getInstallationToken } = await import("../../../server/lib/github/app.ts");
  return getInstallationToken(installationId);
}

const request: ReviewRequest = {
  runId: `e2b-scripted-${input.id ?? "local"}`,
  repo: {
    fullName: repoFullName,
    defaultBranch: "main",
    installationId: installationId || 1,
    cloneUrl: `https://github.com/${repoFullName}.git`,
    token: await resolveToken(),
  },
  pr: {
    number: 6,
    title: input.title ?? "New pricing page",
    body: input.body ?? "",
    baseSha: "",
    headSha: "e2b-scripted",
    baseBranch: "main",
    headBranch,
  },
  files: input.files.map((file) => ({ path: file.path, status: file.status, patch: file.patch, content: file.content })),
};

const scripted = (role: "luna" | "terra" | "astra"): ModelClient => ({
  id: `scripted-${role}`,
  async complete(task: ModelTask) {
    const base = { model: `scripted-${role}`, tokensIn: 0, tokensOut: 0, durationMs: 0 };
    if (role === "terra" && task.kind === "repair_agent") {
      const user = `${task.user}\n${(task.history ?? []).map((message) => message.content).join("\n")}`;
      const file = /### File ([\w./-]+) \(changed\)/.exec(user)?.[1];
      const candidate = candidates.find((entry) => entry.file === file);
      if (!candidate?.autoFix) {
        return { ...base, text: JSON.stringify({ thought: "no deterministic fix", done: true, summary: "no deterministic fix available" }) };
      }
      return {
        ...base,
        text: JSON.stringify({
          thought: "apply the deterministic root-cause edit",
          strategy: `fix ${file}`,
          actions: [{ tool: "apply_edit", args: { edits: candidate.autoFix } }],
        }),
      };
    }
    if (role === "terra" && task.kind === "judge") return { ...base, text: JSON.stringify({ decisions: [] }) };
    if (role === "astra" && task.kind === "final_review") {
      const ids = [...task.user.matchAll(/## Finding (\S+)/g)].map((match) => match[1]);
      return {
        ...base,
        text: JSON.stringify({
          reviews: ids.map((candidateId) => ({ candidateId, validity: "valid", fixCorrectness: "correct", risk: "low", approval: "approve", confidence: 0.9, summary: "scripted review" })),
        }),
      };
    }
    return { ...base, text: JSON.stringify({ hypotheses: [], reviews: [], decisions: [] }) };
  },
});

const config = resolveV3Config({ mode: "live" });
if (!config.sandbox.apiKey) throw new Error("E2B_API_KEY is required");

const logger = createLogger("info", "e2b-scripted");
const candidates = runDetectors(analyzeChanges(request)).filter((candidate) => Boolean(candidate.check));
logger.info(`captured ${candidates.length} provable detector candidate(s) for the scripted repair model`);

const engine = new CortadoV3Engine({
  config: { mode: "live", cache: { enabled: false } },
  models: { luna: scripted("luna"), terra: scripted("terra"), astra: scripted("astra") },
  sandboxFactory: async () =>
    E2BSandboxInstance.create({
      template: config.sandbox.template,
      apiKey: config.sandbox.apiKey,
      timeoutMs: config.sandbox.timeoutMs,
      repoDir: config.sandbox.repoDir,
    }),
  logger,
  skipModelPreflight: true,
});

const started = Date.now();
const result = await engine.run(request);
const duration = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n[e2b-scripted] status=${result.status} duration=${duration}s`);
console.log(`[e2b-scripted] confirmed=${result.summary.issuesConfirmed} fixed=${result.summary.issuesFixed} verified=${result.summary.issuesVerified}`);
for (const finding of result.findings) {
  console.log(`  - ${finding.candidate.file} proof=${finding.proof.status} repair=${finding.repair?.exit} patchHunks=${Boolean(finding.repair?.finalPatch?.includes("@@"))} verification=${finding.verification?.passed}`);
}
const ok = result.summary.issuesVerified === result.summary.issuesConfirmed && result.findings.every((finding) => finding.verification?.passed);
console.log(ok ? "[e2b-scripted] PASS" : "[e2b-scripted] FAIL");
if (!ok) process.exitCode = 1;
