/**
 * Canonical model catalog for CortardoBot 3.5.
 *
 * Three plain roles only: `investigator` finds and reproduces defects,
 * `engineer` writes fixes, `reviewer` verifies independently. The engine, the
 * server runner and the app all read from here so a run can never silently use
 * a different model than the one selected.
 */

export type ModelRole = "investigator" | "engineer" | "reviewer";

export type ModelProvider = "openai" | "anthropic" | "google" | "zai" | "other";

export interface ModelCatalogEntry {
  /** Gateway model id sent on the wire. */
  id: string;
  role: ModelRole;
  label: string;
  provider: ModelProvider;
  /** Shown in the app model picker. */
  description: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  supportsReasoning: boolean;
  /** True when this is the role default. */
  isDefault: boolean;
}

export const DEFAULT_MODELS: Record<ModelRole, string> = {
  investigator: "openai/gpt-5.6-luna",
  engineer: "openai/gpt-6-astra",
  reviewer: "openai/gpt-5.6-sol",
};

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "openai/gpt-5.6-luna",
    role: "investigator",
    label: "GPT 5.6 Luna",
    provider: "openai",
    description: "Fast investigator: reads the code, reproduces defects with scripts.",
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 1.5,
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
    supportsReasoning: false,
    isDefault: false,
  },
  {
    id: "openai/gpt-6-astra",
    role: "engineer",
    label: "GPT 6 Astra",
    provider: "openai",
    description: "Autonomous repair engineer — writes fixes against the failing repro.",
    inputCostPerMillion: 5,
    outputCostPerMillion: 25,
    supportsReasoning: true,
    isDefault: true,
  },
  {
    id: "openai/gpt-5.6-terra",
    role: "engineer",
    label: "GPT 5.6 Terra",
    provider: "openai",
    description: "Cheaper alternative repair engineer.",
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    supportsReasoning: true,
    isDefault: false,
  },
  {
    id: "openai/gpt-5.6-sol",
    role: "reviewer",
    label: "GPT 5.6 Sol",
    provider: "openai",
    description: "Independent verifier of fixes and final PR report.",
    inputCostPerMillion: 7.5,
    outputCostPerMillion: 37.5,
    supportsReasoning: true,
    isDefault: true,
  },
];

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export const DEFAULT_REASONING: Record<ModelRole, ReasoningEffort> = {
  investigator: "medium",
  engineer: "high",
  reviewer: "high",
};

export const MODEL_ENV_KEYS: Record<ModelRole, { primary: string; legacy: string[] }> = {
  investigator: { primary: "CORTADO_MODEL_INVESTIGATOR", legacy: ["CORTADO_MODEL_LUNA", "CORTARDO_MODEL_LUNA"] },
  engineer: { primary: "CORTADO_MODEL_ENGINEER", legacy: ["CORTADO_MODEL_CODEGEN", "CORTARDO_MODEL_CODEGEN"] },
  reviewer: { primary: "CORTADO_MODEL_REVIEWER", legacy: ["CORTADO_MODEL_ASTRA", "CORTARDO_MODEL_ASTRA"] },
};

export const REASONING_ENV_KEYS: Record<ModelRole, { primary: string; legacy: string[] }> = {
  investigator: { primary: "CORTADO_REASONING_INVESTIGATOR", legacy: ["CORTADO_REASONING_LUNA"] },
  engineer: { primary: "CORTADO_REASONING_ENGINEER", legacy: ["CORTADO_REASONING_CODEGEN"] },
  reviewer: { primary: "CORTADO_REASONING_REVIEWER", legacy: ["CORTADO_REASONING_ASTRA"] },
};

export function modelsForRole(role: ModelRole): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((entry) => entry.role === role);
}

export function isKnownModel(id: string): boolean {
  return MODEL_CATALOG.some((entry) => entry.id === id);
}

export function catalogEntry(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id);
}

const REASONING_VALUES: ReasoningEffort[] = ["minimal", "low", "medium", "high"];

export function parseReasoningEffort(value: string | undefined | null): ReasoningEffort | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase() as ReasoningEffort;
  return REASONING_VALUES.includes(normalized) ? normalized : undefined;
}

export interface ResolvedModels {
  investigator: string;
  engineer: string;
  reviewer: string;
}

export interface ResolveModelsInput {
  overrides?: Partial<Record<ModelRole, string>>;
  env?: Record<string, string | undefined>;
}

function pickEnv(env: Record<string, string | undefined>, keys: { primary: string; legacy: string[] }): string | undefined {
  const primary = env[keys.primary]?.trim();
  if (primary) return primary;
  for (const legacy of keys.legacy) {
    const value = env[legacy]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolve the models a run will use. Precedence:
 * explicit override > CORTADO_MODEL_* > legacy names > role default.
 */
export function resolveModelIds(input: ResolveModelsInput = {}): ResolvedModels {
  const env = input.env ?? process.env;
  const pick = (role: ModelRole): string => input.overrides?.[role] || pickEnv(env, MODEL_ENV_KEYS[role]) || DEFAULT_MODELS[role];
  return { investigator: pick("investigator"), engineer: pick("engineer"), reviewer: pick("reviewer") };
}

export function resolveReasoning(input: ResolveModelsInput = {}): Record<ModelRole, ReasoningEffort> {
  const env = input.env ?? process.env;
  const pick = (role: ModelRole): ReasoningEffort => {
    const legacy = REASONING_ENV_KEYS[role].legacy.map((key) => env[key]).find((value) => value !== undefined);
    return parseReasoningEffort(env[REASONING_ENV_KEYS[role].primary]) ?? parseReasoningEffort(legacy) ?? DEFAULT_REASONING[role];
  };
  return { investigator: pick("investigator"), engineer: pick("engineer"), reviewer: pick("reviewer") };
}

export interface ModelSelection {
  investigator: string;
  engineer: string;
  reviewer: string;
  reasoning: Record<ModelRole, ReasoningEffort>;
}

export function resolveModelSelection(input: ResolveModelsInput = {}): ModelSelection {
  const models = resolveModelIds(input);
  return { ...models, reasoning: resolveReasoning(input) };
}
