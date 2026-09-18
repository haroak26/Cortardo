# CodeBot gateway cost/cache findings

Probe: `bot/scripts/probe-gateway.ts` · run 2026-09-17 against `https://api-gateway.merge.dev/v1/ai-sdk`.
Prefix ≈ 3,119 tokens sent twice per model; raw `usage` recorded per call.

## 1. Billing

- **The gateway returns `usage.cost` on every successful call.** CodeBot already prefers it
  (`model.ts:402`); the catalog-based fallback only matters if that ever stops.
- Observed billed cost is **below** the local catalog estimate (e.g. luna ~$0.00074 for 3,676
  input tokens vs $0.00184 catalog). Treat `usage.cost` as authoritative and the catalog as a
  conservative admission estimate.
- A 402 (`API key spend limit exceeded` / `Credit balance depleted`) is returned when a key is
  exhausted. The key-resolution chain can pick an exhausted key before a live one
  (`CODEBOT_MERGE_API_KEY` depleted while `OPENCODE_MERGE_KEY` works). Set
  `CODEBOT_API_KEY` explicitly for runs, or the resolver tries keys in order.

## 2. Prompt caching

| Variant | Cached tokens reported | Cost of the second call |
| --- | --- | --- |
| implicit (no marker) | never | full price |
| `prompt_cache_key` | 3,673 / 3,676 | **~10% of full** |
| `cache_control: ephemeral` | 3,673 / 3,676 | **~10% of full** |

- **Implicit caching alone does not happen.** Without a marker, two identical-prefix calls both
  billed at full rate and reported no cached tokens.
- **Both explicit mechanisms work.** `prompt_cache_key` is a plain body parameter (no message
  format change), so CodeBot will send `prompt_cache_key: codebot:<role>:<repo>:<pr>:<head>`.
- Cache hits appear by content prefix: a marker call can hit a prefix cached by an earlier call
  (even one with a different key), so shared system+diff prefixes pay only once per run.
- Cached input bills at roughly **10%** of the input rate. The local fallback cost now prices
  `cached_tokens` at `cachedInputCostPerMillion` (10% of input) instead of full rate.

## 3. Capability fallbacks

- The legacy `openai/gpt-6-astra` (codegen before the sol swap) rejected `max_tokens` and asked
  for `max_completion_tokens`; the existing per-request fallback (`bot/src/model.ts`) already
  walks `max_tokens → max_completion_tokens → none`, so the swap to `openai/gpt-5.6-sol` needed no
  changes there.
- `prompt_cache_key` is not guaranteed on every model; the client disables it per request if the
  gateway rejects the field, the same way it handles `temperature`.

## 4. Consequence for the $0.25 budget

Caching converts the dominant cost — repeated prompt prefixes (coordinator diff sent to plan and
synthesis, six swarm agents re-sending their first turn, every codegen turn re-sending the shared
context) — into cached reads at ~10% of input price. Combined with honest cached-token pricing,
the recorded budget drops toward the real bill and stops tripping early.
