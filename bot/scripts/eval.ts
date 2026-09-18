/**
 * Fixture eval: runs stage 2 against the planted-bug PRs and scores whether the
 * hypotheses we publish actually name the expected files and defects. This is a
 * harness for CodeBot, not for the code under review — it proves recall and
 * measures noise before anything is wired into the product.
 *
 * Usage:
 *   npm run bot:eval
 *   npm run bot:eval -- --pr 7
 *   npm run bot:eval -- --deterministic
 */
import pg from "pg";
import { storage } from "../../server/storage.ts";
import { buildHypothesisReport } from "../src/hypotheses.ts";
import { analyseChangedFiles, loadChangedFiles, loadPullRequestContext, loadRepoGraphIndex } from "../src/run-inputs.ts";
import {
  createCodeBotModelClient,
  resolveCodeBotModelConfig,
  resolveCodeBotSwarmConfig,
  swarmModelConfig,
} from "../src/model.ts";

interface ExpectedFinding {
  file: string;
  match: RegExp;
  /** True when the deterministic rules alone are expected to catch it. */
  deterministic?: boolean;
}

interface EvalFixture {
  repository: string;
  pullRequestNumber: number;
  expected: ExpectedFinding[];
}

const FIXTURES: EvalFixture[] = [
  {
    repository: "haroak26/Artificial-Gateway",
    pullRequestNumber: 6,
    expected: [
      { file: "client/src/pages/Billing.tsx", match: /workspace|storage|state|plan/i, deterministic: true },
      { file: "client/src/pages/ApiKeys.tsx", match: /catch|error|fresh|truncat/i, deterministic: true },
    ],
  },
  {
    repository: "haroak26/Artificial-Gateway",
    pullRequestNumber: 7,
    expected: [
      { file: "client/src/pages/Usage.tsx", match: /7 ?d|30 ?d|period|mapping/i, deterministic: true },
      { file: "client/src/pages/Billing.tsx", match: /workspace|storage|state|plan/i, deterministic: true },
      { file: "client/src/pages/Playground.tsx", match: /gpt-4o-mini|hardcod|selectedModel/i },
      { file: "client/src/pages/Models.tsx", match: /modelId|model\.id|details/i },
      { file: "client/src/pages/Providers.tsx", match: /invalidate|provider|query/i },
      { file: "client/src/pages/ApiKeys.tsx", match: /fresh|truncat|substring|rawKey/i },
    ],
  },
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const onlyPr = arg("pr") ? Number(arg("pr")) : undefined;
const deterministic = process.argv.includes("--deterministic");
const repositoryOverride = arg("repository");

async function resolveRepositoryId(fullName: string): Promise<string> {
  if (process.env.CODEBOT_REPOSITORY_ID && (!onlyPr || onlyPr === FIXTURES[0].pullRequestNumber)) {
    return process.env.CODEBOT_REPOSITORY_ID;
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>("SELECT id FROM repositories WHERE full_name = $1", [fullName]);
    if (!rows[0]) throw new Error(`repository not found: ${fullName}`);
    return rows[0].id;
  } finally {
    await client.end();
  }
}

const modelConfig = resolveCodeBotModelConfig();
const swarmConfig = resolveCodeBotSwarmConfig();
let failed = false;

for (const fixture of FIXTURES) {
  if (onlyPr !== undefined && fixture.pullRequestNumber !== onlyPr) continue;
  if (repositoryOverride && fixture.repository !== repositoryOverride) continue;

  const repositoryId = await resolveRepositoryId(fixture.repository);
  const repository = await storage.getRepositoryById(repositoryId);
  if (!repository) throw new Error(`repository row missing: ${repositoryId}`);
  const context = await loadPullRequestContext(repository, fixture.pullRequestNumber);
  const files = await loadChangedFiles({
    installationId: context.installationId,
    fullName: context.fullName,
    pullRequestNumber: fixture.pullRequestNumber,
  });
  const analyses = await analyseChangedFiles({
    installationId: context.installationId,
    fullName: context.fullName,
    headSha: context.headSha,
    files,
  });
  const index = await loadRepoGraphIndex(repository.id).catch(() => null);
  const useModel = !deterministic && Boolean(modelConfig.apiKey);
  const report = await buildHypothesisReport({
    repository: repository.fullName,
    pullRequestNumber: fixture.pullRequestNumber,
    headSha: context.headSha,
    title: context.title,
    body: context.body,
    files,
    analyses,
    index,
    modelClient: useModel ? createCodeBotModelClient(modelConfig) : null,
    swarmClient: useModel ? createCodeBotModelClient(swarmModelConfig(modelConfig)) : null,
    modelConfig,
    swarmConfig,
    installationId: context.installationId,
    fullName: context.fullName,
    onLog: (message) => console.log(`  ${message}`),
  });

  const haystacks = report.hypotheses.map((hypothesis) => ({
    file: hypothesis.file,
    text: `${hypothesis.change} ${hypothesis.why} ${hypothesis.question} ${hypothesis.mechanism}`,
  }));

  const scored = fixture.expected.filter((expected) => !deterministic || expected.deterministic === true);
  const results = scored.map((expected) => ({
    expected,
    found: haystacks.some((entry) => entry.file === expected.file && expected.match.test(entry.text)),
  }));
  const recall = results.length === 0 ? 1 : results.filter((result) => result.found).length / results.length;

  console.log("");
  console.log(
    `PR #${fixture.pullRequestNumber} · ${report.hypotheses.length} hypothesis(es) · recall ${(recall * 100).toFixed(0)}% · ` +
      `coordinator ×${report.usage.coordinator.calls} · swarm ×${report.usage.swarm.calls} · $${report.usage.totalCostUsd.toFixed(4)}`,
  );
  for (const expected of fixture.expected) {
    const result = results.find((entry) => entry.expected === expected);
    if (result) console.log(`  ${result.found ? "found " : "MISS  "} ${expected.file} (${expected.match})`);
    else console.log(`  skip  ${expected.file} (model-only, skipped in deterministic mode)`);
  }
  if (results.some((result) => !result.found)) failed = true;
}

if (failed) {
  console.error("\n[codebot:eval] FAIL: expected findings were missed");
  process.exit(1);
}
console.log("\n[codebot:eval] PASS");
