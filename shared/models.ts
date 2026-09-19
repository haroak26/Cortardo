/**
 * Canonical model catalog for the CodeBot review pipeline.
 *
 * Three plain roles only: `investigator` finds and reproduces defects,
 * `engineer` writes fixes, `reviewer` verifies independently. CodeBot reads
 * pricing and capability metadata from here so a run can never silently use a
 * different model than the one selected.
 */

export type ModelRole = "investigator" | "engineer" | "reviewer";

export type ModelProvider = "openai" | "anthropic" | "google" | "zai" | "other";

export interface ModelCatalogEntry {
  /** OpenRouter model id sent on the wire. */
  id: string;
  role: ModelRole;
  label: string;
  provider: ModelProvider;
  /** Shown in the app model picker. */
  description: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  /** Cached prompt reads; OpenRouter providers usually bill them at ~10%. */
  cachedInputCostPerMillion?: number;
  supportsReasoning: boolean;
  /** True when this is the role default. */
  isDefault: boolean;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "openai/gpt-5-nano",
    role: "investigator",
    label: "GPT 5 Nano",
    provider: "openai",
    description: "Fast investigator: reads the code, reproduces defects with scripts.",
    inputCostPerMillion: 0.05,
    outputCostPerMillion: 0.4,
    cachedInputCostPerMillion: 0.005,
    supportsReasoning: true,
    isDefault: true,
  },
  {
    id: "openai/gpt-5.4-mini",
    role: "investigator",
    label: "GPT 5.4 Mini",
    provider: "openai",
    description: "Low-cost investigator for very small diffs.",
    inputCostPerMillion: 0.75,
    outputCostPerMillion: 4.5,
    cachedInputCostPerMillion: 0.075,
    supportsReasoning: false,
    isDefault: false,
  },
  {
    id: "openai/gpt-5.6-sol",
    role: "engineer",
    label: "GPT 5.6 Sol",
    provider: "openai",
    description: "Autonomous repair engineer — writes fixes against the failing repro.",
    inputCostPerMillion: 2,
    outputCostPerMillion: 10,
    cachedInputCostPerMillion: 0.2,
    supportsReasoning: true,
    isDefault: true,
  },
  {
    id: "z-ai/glm-5.3",
    role: "engineer",
    label: "GLM 5.3",
    provider: "zai",
    description: "Cheaper alternative repair engineer.",
    inputCostPerMillion: 0.91,
    outputCostPerMillion: 2.86,
    cachedInputCostPerMillion: 0.169,
    supportsReasoning: true,
    isDefault: false,
  },
  {
    id: "openai/gpt-5.6-sol",
    role: "reviewer",
    label: "GPT 5.6 Sol",
    provider: "openai",
    description: "Independent verifier of fixes and final PR report.",
    inputCostPerMillion: 2,
    outputCostPerMillion: 10,
    cachedInputCostPerMillion: 0.2,
    supportsReasoning: true,
    isDefault: true,
  },
];

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export function catalogEntry(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id);
}

const REASONING_VALUES: ReasoningEffort[] = ["minimal", "low", "medium", "high"];

export function parseReasoningEffort(value: string | undefined | null): ReasoningEffort | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase() as ReasoningEffort;
  return REASONING_VALUES.includes(normalized) ? normalized : undefined;
}
