// ── Per-token model pricing ──────────────────────────────────────────
// 1 credit = $0.001 USD of AI API usage. Credits rounded to 2 decimal places.
// Token count is approximated from character count (~4 chars/token).

export interface ModelPricing {
  inputCostPerToken: number;
  outputCostPerToken: number;
  charsPerToken: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ── The 5 models we offer (marked up: ×1.5 input, ×1.25 output, rounded to 0/5) ──
  "openai/gpt-5.6-luna": { inputCostPerToken: 0.00000050, outputCostPerToken: 0.00000150, charsPerToken: 4 },
  "openai/gpt-5.6-terra": { inputCostPerToken: 0.00000300, outputCostPerToken: 0.00001500, charsPerToken: 4 },
  "openai/gpt-5.6-sol": { inputCostPerToken: 0.00000750, outputCostPerToken: 0.00003750, charsPerToken: 4 },
  "google/gemini-3.1-pro": { inputCostPerToken: 0.00000300, outputCostPerToken: 0.00001500, charsPerToken: 4 },
  "google/gemini-3.7-flash": { inputCostPerToken: 0.00000150, outputCostPerToken: 0.00000500, charsPerToken: 4 },

  // ── v3 6-stage pipeline models ──
  // NOTE: confirm these against your Merge Gateway invoice — the gateway
  // reports real usage (tokens, sometimes cost_usd) which is always
  // preferred over these estimates. Env overrides:
  //   CORTARDO_PRICE_OPUS_IN / CORTARDO_PRICE_OPUS_OUT
  //   CORTARDO_PRICE_M3_IN / CORTARDO_PRICE_M3_OUT   (USD per 1M tokens)
  "anthropic/claude-opus-5": {
    inputCostPerToken: (Number(process.env.CORTARDO_PRICE_OPUS_IN) || 15) / 1e6,
    outputCostPerToken: (Number(process.env.CORTARDO_PRICE_OPUS_OUT) || 75) / 1e6,
    charsPerToken: 4,
  },
  "minimax/minimax-m3": {
    inputCostPerToken: (Number(process.env.CORTARDO_PRICE_M3_IN) || 0.3) / 1e6,
    outputCostPerToken: (Number(process.env.CORTARDO_PRICE_M3_OUT) || 1.2) / 1e6,
    charsPerToken: 4,
  },

  // ── MID tier ──
  "deepseek/deepseek-v4-flash": { inputCostPerToken: 0.00000020, outputCostPerToken: 0.00000060, charsPerToken: 4 },

  // ── CODER tier ──
  "deepseek/deepseek-v4-pro": { inputCostPerToken: 0.00000035, outputCostPerToken: 0.00000140, charsPerToken: 4 },

  // ── LIGHT tier ──
  "mistralai/ministral-14b-2512": { inputCostPerToken: 0.00000020, outputCostPerToken: 0.00000020, charsPerToken: 4 },

  // ── GLM 5.3 ──
  "zai/glm-5.3": { inputCostPerToken: 0.00000012, outputCostPerToken: 0.00000048, charsPerToken: 4 },
  "z.ai/glm-5-flash": { inputCostPerToken: 0.00000010, outputCostPerToken: 0.00000034, charsPerToken: 4 },

  // ── Legacy / other models (kept for existing references) ──
  "google/gemma-4-31b-it": { inputCostPerToken: 0.00000010, outputCostPerToken: 0.00000034, charsPerToken: 4 },
  "openai/gpt-oss-20b": { inputCostPerToken: 0.00000003, outputCostPerToken: 0.00000013, charsPerToken: 4 },
  "openai/gpt-5.4-nano": { inputCostPerToken: 0.00000020, outputCostPerToken: 0.00000125, charsPerToken: 4 },
  "mistralai/mistral-small-2603": { inputCostPerToken: 0.00000015, outputCostPerToken: 0.00000060, charsPerToken: 4 },
  "openai/gpt-5.4-mini": { inputCostPerToken: 0.00000075, outputCostPerToken: 0.00000450, charsPerToken: 4 },
  "anthropic/claude-sonnet-5": { inputCostPerToken: 0.00000200, outputCostPerToken: 0.00001000, charsPerToken: 4 },
  "anthropic/claude-haiku-4-5": { inputCostPerToken: 0.00000080, outputCostPerToken: 0.00000400, charsPerToken: 4 },
};

export const DEFAULT_PRICING: ModelPricing = { inputCostPerToken: 0.00000050, outputCostPerToken: 0.00000150, charsPerToken: 4 };

export const CREDIT_PER_DOLLAR = 1000;

export function getModelPricing(modelId: string): ModelPricing {
  return MODEL_PRICING[modelId] ?? DEFAULT_PRICING;
}

export function calcCost(
  modelId: string,
  inputChars: number,
  outputChars: number,
): { costDollars: number; credits: number } {
  const p = getModelPricing(modelId);
  const inputTokens = Math.ceil(inputChars / p.charsPerToken);
  const outputTokens = Math.ceil(outputChars / p.charsPerToken);
  const costDollars = inputTokens * p.inputCostPerToken + outputTokens * p.outputCostPerToken;
  const credits = Math.max(0.01, Math.round((costDollars * CREDIT_PER_DOLLAR) * 100) / 100);
  return { costDollars, credits };
}

export function toCredits(costDollars: number): number {
  return Math.max(0.01, Math.round((costDollars * CREDIT_PER_DOLLAR) * 100) / 100);
}

/**
 * Cost from REAL token counts (from API usage accounting). Preferred over
 * calcCost whenever the gateway reports actual usage.
 */
export function calcCostTokens(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): { costDollars: number; credits: number } {
  const p = getModelPricing(modelId);
  const costDollars = inputTokens * p.inputCostPerToken + outputTokens * p.outputCostPerToken;
  const credits = Math.max(0.01, Math.round((costDollars * CREDIT_PER_DOLLAR) * 100) / 100);
  return { costDollars, credits };
}

/**
 * Screenshots sent to vision models are priced as image tokens (~1100 per
 * image) — never as base64 text characters (10+ credits of phantom cost).
 */
export const IMAGE_TOKEN_ESTIMATE = 1100;
