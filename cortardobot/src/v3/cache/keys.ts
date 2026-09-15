import { sha256, stableStringify } from "../util";
import { CACHE_SCHEMA_VERSION, ENGINE_VERSION, PROMPT_VERSION, TOOL_VERSION } from "../version";

export type CacheKind = "context_pack" | "swarm_context" | "swarm" | "judge" | "proof" | "repair" | "final_review" | "memo";

export interface CacheKeyParts {
  repo?: string;
  headSha?: string;
  fileHashes?: Record<string, string>;
  model?: string;
  models?: Record<string, string>;
  promptVersion?: string;
  toolVersion?: string;
  engineVersion?: string;
  payload?: unknown;
}

/**
 * Every key embeds the engine/prompt/tool versions plus caller parts, so a
 * deploy or a model change invalidates cached results automatically.
 */
export function cacheKey(kind: CacheKind, parts: CacheKeyParts): string {
  return sha256(
    [
      CACHE_SCHEMA_VERSION,
      kind,
      parts.engineVersion ?? ENGINE_VERSION,
      parts.promptVersion ?? PROMPT_VERSION,
      parts.toolVersion ?? TOOL_VERSION,
      stableStringify({
        repo: parts.repo ?? "",
        headSha: parts.headSha ?? "",
        fileHashes: parts.fileHashes ?? {},
        model: parts.model ?? "",
        models: parts.models ?? {},
        payload: parts.payload ?? null,
      }),
    ].join("|"),
  );
}
