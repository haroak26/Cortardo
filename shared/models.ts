/**
 * CortardoBot 3.1 — canonical model catalog.
 *
 * Single source of truth for model ids, roles, defaults and pricing. The
 * engine (`cortardobot`), the server runner and the app all read from here so a
 * run can never silently use a different model than the one selected.
 */

export type ModelRole = "luna" | "terra" | "codegen" | "astra";

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

/**
 * Defaults locked in for 3.3 — the GPT-class models selected for the product.
 * Luna investigates, Terra judges, Astra (gpt-6-astra) writes the fixes, and the
 * astra role reviews independently on Sol so the writer is never the reviewer.
 */
export const DEFAULT_MODELS: Record<ModelRole, string> = {
  luna: "openai/gpt-5.6-luna",
  terra: "openai/gpt-5.6-terra",
  codegen: "openai/gpt-6-astra",
  astra: "openai/gpt-5.6-sol",
};

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "openai/gpt-5.6-luna",
    role: "luna",
    label: "GPT 5.6 Luna",
    provider: "openai",
    description: "Fast investigator for swarm and probe analysis.",
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 1.5,
    supportsReasoning: true,
    isDefault: true,
  },
  {
    id: "openai/gpt-5.6-terra",
    role: "terra",
    label: "GPT 5.6 Terra",
    provider: "openai",
    description: "Judge and autonomous repair engineer.",
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    supportsReasoning: true,
    isDefault: true,
  },
  {
    id: "openai/gpt-6-astra",
    role: "codegen",
    label: "GPT 6 Astra",
    provider: "openai",
    description: "Autonomous repair engineer — writes and verifies fixes.",
    inputCostPerMillion: 5,
    outputCostPerMillion: 25,
    supportsReasoning: true,
    isDefault: true,
  },
  {
    id: "openai/gpt-5.6-terra",
    role: "codegen",
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
    role: "astra",
    label: "GPT 5.6 Sol",
    provider: "openai",
    description: "Independent flagship final reviewer.",
    inputCostPerMillion: 7.5,
    outputCostPerMillion: 37.5,
    supportsReasoning: true,
    isDefault: true,
  },
  {
    id: "openai/gpt-5.4-mini",
    role: "luna",
    label: "GPT 5.4 Mini",
    provider: "openai",
    description: "Low-cost investigator for very small diffs.",
    inputCostPerMillion: 0.75,
    outputCostPerMillion: 4.5,
    supportsReasoning: false,
    isDefault: false,
  },
];

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export const DEFAULT_REASONING: Record<ModelRole, ReasoningEffort> = {
  luna: "medium",
  terra: "high",
  codegen: "high",
  astra: "high",
};

export const MODEL_ENV_KEYS: Record<ModelRole, { primary: string; legacy: string }> = {
  luna: { primary: "CORTADO_MODEL_LUNA", legacy: "CORTARDO_MODEL_LUNA" },
  terra: { primary: "CORTADO_MODEL_TERRA", legacy: "CORTARDO_MODEL_TERRA" },
  codegen: { primary: "CORTADO_MODEL_CODEGEN", legacy: "CORTARDO_MODEL_CODEGEN" },
  astra: { primary: "CORTADO_MODEL_ASTRA", legacy: "CORTARDO_MODEL_ASTRA" },
};

export const REASONING_ENV_KEYS: Record<ModelRole, string> = {
  luna: "CORTADO_REASONING_LUNA",
  terra: "CORTADO_REASONING_TERRA",
  codegen: "CORTADO_REASONING_CODEGEN",
  astra: "CORTADO_REASONING_ASTRA",
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
  luna: string;
  terra: string;
  codegen: string;
  astra: string;
}

export interface ResolveModelsInput {
  overrides?: Partial<Record<ModelRole, string>>;
  env?: Record<string, string | undefined>;
}

/**
 * Resolve the models a run will use. Precedence:
 * explicit override > CORTADO_MODEL_* > legacy CORTARDO_MODEL_* > GPT default.
 */
export function resolveModelIds(input: ResolveModelsInput = {}): ResolvedModels {
  const env = input.env ?? process.env;
  const pick = (role: ModelRole): string => {
    const override = input.overrides?.[role];
    if (override) return override;
    const keys = MODEL_ENV_KEYS[role];
    return env[keys.primary]?.trim() || env[keys.legacy]?.trim() || DEFAULT_MODELS[role];
  };
  return { luna: pick("luna"), terra: pick("terra"), codegen: pick("codegen"), astra: pick("astra") };
}

export function resolveReasoning(input: ResolveModelsInput = {}): Record<ModelRole, ReasoningEffort> {
  const env = input.env ?? process.env;
  const pick = (role: ModelRole): ReasoningEffort => {
    return parseReasoningEffort(env[REASONING_ENV_KEYS[role]]) ?? DEFAULT_REASONING[role];
  };
  return { luna: pick("luna"), terra: pick("terra"), codegen: pick("codegen"), astra: pick("astra") };
}

export interface ModelSelection {
  luna: string;
  terra: string;
  codegen: string;
  astra: string;
  reasoning: Record<ModelRole, ReasoningEffort>;
}

export function resolveModelSelection(input: ResolveModelsInput = {}): ModelSelection {
  const models = resolveModelIds(input);
  return { ...models, reasoning: resolveReasoning(input) };
}
