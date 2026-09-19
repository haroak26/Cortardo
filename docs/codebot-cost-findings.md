# CodeBot provider cost/cache findings

Probe: `bot/scripts/probe-gateway.ts` · run 2026-09-18 against `https://openrouter.ai/api/v1`.
Prefix ≈ 3,119 tokens sent twice per model; raw `usage` recorded per call.

## 1. Billing

- **OpenRouter returns `usage.cost` when the request asks for it.** The client now always
  sends `usage: { include: true }` (`bot/src/model.ts`) and prefers `usage.cost` on every
  successful call; the catalog-based fallback only matters if a response ever omits it.
- The catalog now mirrors OpenRouter list pricing (GLM 5.3 $0.91/$2.86, GPT 5 Nano
  $0.05/$0.40, GPT 5.6 Sol $2/$10 per million, cached reads ~10%), so the local admission
  estimate tracks the real bill instead of the old gateway markup.
- OpenRouter returns `402 Insufficient credits` when a key is exhausted. The key chain is
  `CODEBOT_API_KEY` → `OPENROUTER_API_KEY` → `CORTADO_AI_API_KEY`; set `CODEBOT_API_KEY`
  explicitly to swap an exhausted key for a run.

## 2. Prompt caching

| Model | Variant | 2nd call cached tokens | Cost of the second call |
| --- | --- | ---: | --- |
| `z-ai/glm-5.3` | implicit (no marker) | 3,648 / 3,677 | ~$0.00101 |
| `z-ai/glm-5.3` | `prompt_cache_key` | 3,648 / 3,677 | ~$0.00106 |
| `z-ai/glm-5.3` | `cache_control: ephemeral` | 3,648 / 3,677 | ~$0.00101 |
| `openai/gpt-5-nano` | implicit | 3,584 / 3,676 | ~$0.000023 |
| `openai/gpt-5-nano` | `prompt_cache_key` | 3,584 / 3,676 | ~$0.000023 |
| `openai/gpt-5-nano` | `cache_control: ephemeral` | 3,584 / 3,676 | ~$0.000023 |
| `openai/gpt-5.6-sol` | implicit | 0 / 3,676 | full price |
| `openai/gpt-5.6-sol` | `prompt_cache_key` | 0 / 3,676 | full price |
| `openai/gpt-5.6-sol` | `cache_control: ephemeral` | 3,673 / 3,676 | ~$0.00080 |

- **Z.AI and OpenAI Nano cache implicitly.** A second identical prefix pays ~10% even
  without a marker, so CodeBot's repeated system+diff prefixes are already discounted.
- **GPT 5.6 Sol needs the explicit `cache_control` block.** `prompt_cache_key` alone did
  not produce cached reads for Sol; the Anthropic-style block did. CodeBot still sends
  `prompt_cache_key` (OpenRouter ignores it harmlessly) but does not yet rewrite messages
  with `cache_control`, so codegen input is billed at full rate — the main open cost lever.

## 3. Capability fallbacks

- All three models accept `reasoning_effort` and `response_format: json_object` through
  OpenRouter: GLM 5.3 lists `low|high|max` upstream and maps `medium` to the default.
- `prompt_cache_key` is accepted (and ignored) by OpenRouter; the per-request fallback
  still drops it if a provider ever rejects the field.
- `usage: { include: true }` is accepted by all three; the client disables it per request
  if an error ever names the `usage` parameter.

## 4. Consequence for the $0.25 budget

OpenRouter list pricing is materially cheaper than the old gateway markup (Sol $2/$10 vs
$7.5/$37.5, GLM $0.91/$2.86 vs $3/$15). Combined with authoritative `usage.cost` and
implicit caching on GLM/Nano, the recorded budget tracks the real bill closely; the
remaining lever is `cache_control` on the Sol codegen prefix.
