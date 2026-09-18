/**
 * Gateway fact probe for cost work (phase 0). Sends a stable long prefix
 * twice per model to learn whether the gateway reports billed cost and
 * serves prompt tokens from cache, then repeats with prompt_cache_key and
 * an Anthropic-style cache_control block.
 *
 * Run: node --import tsx betabot/scripts/probe-gateway.ts
 * Output: a markdown report on stdout. Costs a few cents at most.
 */
import { resolveBetabotModelConfig } from "../src/model.ts";

const config = resolveBetabotModelConfig();
if (!config.apiKey) {
  console.error("[probe] no gateway key configured (BETABOT_API_KEY / CORTADO_AI_API_KEY / MERGE_GATEWAY_API_KEY)");
  process.exit(1);
}

const MODELS = [
  { role: "coordinator", id: "openai/gpt-5.6-terra", deep: true },
  { role: "swarm", id: "openai/gpt-5.6-luna", deep: true },
  { role: "codegen", id: "openai/gpt-5.6-sol", deep: true },
];

const PREFIX = [
  "You are reviewing a pull request. The following is the exact diff under review.",
  "=== BEGIN DIFF ===",
  ...Array.from({ length: 120 }, (_, index) => {
    const file = ["src/db.ts", "src/orders.ts", "src/api/pool.ts", "client/src/pages/Billing.tsx"][index % 4];
    const line = index + 1;
    const kind = index % 3 === 0 ? "-" : "+";
    return `${kind} ${file}:${line}: ${kind === "+" ? "const timeoutMs = 30_000; await pool.query(sql, params); if (!res.ok) throw new Error(String(res.status));" : "const timeoutMs = 5_000;"}`;
  }),
  "=== END DIFF ===",
].join("\n");

interface ProbeResult {
  model: string;
  variant: string;
  status: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost?: number;
  costFieldPresent: boolean;
  error?: string;
  durationMs: number;
}

async function call(model: string, system: string, user: string, extra: Record<string, unknown>): Promise<ProbeResult> {
  const started = Date.now();
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 16,
      ...extra,
    }),
  });
  const raw = await response.text();
  let parsed: {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
    error?: { message?: string };
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { model, variant: "parse", status: response.status, costFieldPresent: false, error: raw.slice(0, 200), durationMs: Date.now() - started };
  }
  return {
    model,
    variant: "",
    status: response.status,
    promptTokens: parsed.usage?.prompt_tokens,
    completionTokens: parsed.usage?.completion_tokens,
    cachedTokens: parsed.usage?.prompt_tokens_details?.cached_tokens,
    cost: parsed.usage?.cost,
    costFieldPresent: parsed.usage?.cost !== undefined,
    error: parsed.error?.message?.slice(0, 200),
    durationMs: Date.now() - started,
  };
}

interface VariantRun {
  variant: string;
  first: ProbeResult;
  second: ProbeResult;
}

async function probeModel(model: string, deep: boolean): Promise<VariantRun[]> {
  const runs: VariantRun[] = [];
  const variants: Array<{ variant: string; extra: Record<string, unknown>; content: (user: string) => unknown }> = [
    { variant: "implicit", extra: {}, content: (user) => user },
    ...(deep
      ? [
          {
            variant: "prompt_cache_key",
            extra: { prompt_cache_key: `betabot-probe-${model}` },
            content: (user: string) => user,
          },
          {
            variant: "cache_control",
            extra: {},
            content: (user: string) => [{ type: "text", text: user, cache_control: { type: "ephemeral" } }],
          },
        ]
      : []),
  ];

  for (const variant of variants) {
    const first = await call(model, "You are a careful code reviewer. Answer in one word.", variant.content(`${PREFIX}\n\nQuestion: say ALPHA.`) as string, variant.extra);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const second = await call(model, "You are a careful code reviewer. Answer in one word.", variant.content(`${PREFIX}\n\nQuestion: say BETA.`) as string, variant.extra);
    first.variant = variant.variant;
    second.variant = variant.variant;
    runs.push({ variant: variant.variant, first, second });
  }
  return runs;
}

const report: string[] = [
  "# Gateway cost/cache probe",
  "",
  `Base URL: \`${config.baseUrl}\` · prefix ≈ ${Math.round(PREFIX.length / 4)} tokens · date ${new Date().toISOString()}`,
  "",
  "| Model | Variant | Call | HTTP | prompt | cached | cost field | cost | note |",
  "| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |",
];

for (const model of MODELS) {
  process.stderr.write(`[probe] ${model.role} ${model.id}\n`);
  let runs: VariantRun[] = [];
  try {
    runs = await probeModel(model.id, model.deep);
  } catch (error) {
    report.push(`| ${model.id} | all | — | — | — | — | — | — | probe failed: ${error instanceof Error ? error.message : String(error)} |`);
    continue;
  }
  for (const run of runs) {
    for (const [index, result] of [run.first, run.second].entries()) {
      report.push(
        `| \`${model.id}\` | ${run.variant} | ${index + 1} | ${result.status} | ${result.promptTokens ?? "—"} | ` +
          `${result.cachedTokens ?? "—"} | ${result.costFieldPresent ? "yes" : "no"} | ${result.cost ?? "—"} | ${result.error ?? ""} |`,
      );
    }
  }
}

console.log(report.join("\n"));
