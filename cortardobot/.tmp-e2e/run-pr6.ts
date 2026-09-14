import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const inputPath = "/home/runner/workspace/cortardobot/.tmp-e2e/pr6-input.json";
const outDir = "/home/runner/workspace/cortardobot/.tmp-e2e";
mkdirSync(outDir, { recursive: true });

process.env.CORTADO_AI_API_KEY = process.env.MERGE_GATEWAY_API_KEY!;
process.env.CORTADO_AI_BASE_URL = "https://api-gateway.merge.dev/v1/ai-sdk";
process.env.CORTADO_MODEL_LUNA = "zai/glm-5.3";
process.env.CORTADO_MODEL_TERRA = "anthropic/claude-sonnet-5";
process.env.CORTADO_MODEL_ASTRA = "anthropic/claude-opus-5";
process.env.CORTADO_MODEL_TIMEOUT_MS = "90000";
process.env.CORTADO_MAX_TOKENS_LUNA = "2000";
process.env.CORTADO_MAX_TOKENS_TERRA = "3000";
process.env.CORTADO_MAX_TOKENS_ASTRA = "3000";

const { CortadoEngine } = await import("../src/engine.ts");
const { LocalSandbox } = await import("../src/sandbox/index.ts");
const { createLogger } = await import("../src/util/logger.ts");

const input = JSON.parse(readFileSync(inputPath, "utf8"));
const files: Record<string, string> = {};
for (const file of input.files) {
  if (typeof file.content === "string" && file.content.length > 0) files[file.path] = file.content;
}

const sandbox = new LocalSandbox({
  root: "/tmp/opencode/cortardobot-pr6-sandbox",
  files,
  timeoutMs: 60_000,
  cleanupRoot: false,
  allowNetwork: false,
});

const engine = new CortadoEngine({
  mode: "live",
  sandbox,
  maxModelCalls: 30,
  globalTimeoutMs: 600_000,
  logger: createLogger({ level: "info", scope: "e2e" }),
});

console.log(`[e2e] starting v3.0 review of ${input.id}`);
console.log(`[e2e] files=${input.files.length} changed; models: luna=zai/glm-5.3 terra=anthropic/claude-sonnet-5 astra=anthropic/claude-opus-5`);
const started = Date.now();
const result = await engine.run(input);
const durationMs = Date.now() - started;

writeFileSync(`${outDir}/pr6-review.md`, result.markdown, "utf8");
writeFileSync(`${outDir}/pr6-result.json`, JSON.stringify(result, null, 2), "utf8");

console.log(`\n[e2e] status=${result.status} duration=${(durationMs / 1000).toFixed(1)}s error=${result.error ?? "none"}`);
console.log(`[e2e] classification=${result.pr.classification.join(",")} size=${result.pr.size}`);
console.log(`[e2e] candidates=${result.candidates.length} decisions=${result.decisions.length}`);
for (const decision of result.decisions) {
  const candidate = result.candidates.find((c) => c.id === decision.hypothesisId);
  console.log(`  - ${decision.verdict.padEnd(11)} [${candidate?.severity}] ${candidate?.claim.slice(0, 90)}`);
}
console.log(`[e2e] proofs=${result.proofs.map((p) => `${p.status}/${p.strategy}`).join(", ") || "none"}`);
console.log(`[e2e] repairs=${result.repairs.map((r) => `${r.exit}(${r.attempts.length})`).join(", ") || "none"}`);
console.log(`[e2e] findings=${result.findings.length} reviews=${result.reviews.length}`);
console.log(`[e2e] usage calls=${result.usage.calls} tokensIn=${result.usage.tokensIn} tokensOut=${result.usage.tokensOut} costUsd=$${(result.usage.costUsd ?? result.usage.credits / 1000).toFixed(4)}`);
console.log(`[e2e] markdown written to .tmp-e2e/pr6-review.md (${result.markdown.length} chars)`);
process.exit(0);
