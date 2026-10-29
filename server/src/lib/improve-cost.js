/**
 * What an Improve generation (PROMPT-003) actually cost, so the monthly
 * quota can be a dollar budget — a share of what the customer pays — and stay
 * there whichever model IMPROVE_SUGGESTION_MODEL points at.
 *
 * List prices in USD per million tokens. While CHAT_AGENTIC is on, the
 * prices synced daily from OpenRouter's catalog come first (model-prices.js,
 * CHAT-16 §A), at the price in effect; this table prices a model the sync
 * doesn't have, or every model with the flag off. Update it when a provider
 * changes its prices or a new model is configured; a model missing from both
 * is charged at FALLBACK_PRICE, deliberately expensive, so an unknown model
 * can only use the budget up faster, never overspend it. A model here priced
 * higher for a long prompt has its `long` rate, for a call whose input tokens
 * pass `over`.
 */

import { syncedPriceFor } from './model-price-cache.js';

export const MODEL_PRICES = {
  'google/gemini-3-flash-preview': { input: 0.5, output: 3 },
  'google/gemini-3-flash': { input: 0.5, output: 3 },
  'openai/gpt-5-mini': { input: 0.25, output: 2 },
  'anthropic/claude-haiku-4-5': { input: 1, output: 5 },
  // The Content Editor's with an Anthropic key (content-brief.js): Haiku reads, Sonnet writes.
  'anthropic/claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    long: { over: 100_000, input: 0.5, output: 2.5 },
  },
  'anthropic/claude-sonnet-5-5': { input: 2, output: 10 },
};

export const FALLBACK_PRICE = { input: 5, output: 25 };

/**
 * A typical generation, used to estimate "generations left" before an org
 * has any history, and the least a call holds on the budget before it runs
 * (reserveAiBudget): ~7k input and ~2k output tokens on the configured model.
 */
const TYPICAL_TOKENS = { input: 7000, output: 2000 };

/**
 * A model's price: the synced one in effect now (for a call of
 * `promptTokens`, which may cross a prompt-size price), else this table's.
 * OpenRouter ids carry the provider id after an `openrouter/` prefix
 * (`openrouter/google/gemini-3-flash-preview`); they're priced as that model.
 */
export function priceFor(modelId, { promptTokens = 0 } = {}) {
  const synced = syncedPriceFor(modelId, { promptTokens });
  if (synced) return synced;
  const id = String(modelId ?? '').replace(/^openrouter\//, '');
  const price = MODEL_PRICES[id] ?? FALLBACK_PRICE;
  return price.long && promptTokens > price.long.over ? price.long : price;
}

/** USD cost of one call from the AI SDK's `usage`. */
export function generationCostUsd(modelId, usage) {
  const input = Number(usage?.inputTokens) || 0;
  const price = priceFor(modelId, { promptTokens: input });
  const output = Number(usage?.outputTokens) || 0;
  return (input * price.input + output * price.output) / 1_000_000;
}

export function typicalCostUsd(modelId) {
  return generationCostUsd(modelId, {
    inputTokens: TYPICAL_TOKENS.input,
    outputTokens: TYPICAL_TOKENS.output,
  });
}

/**
 * The org's typical generation cost: the median of its recent ones, so one
 * unusually long answer doesn't swing the estimate. Null with no history.
 */
export function medianCost(costs) {
  const sorted = costs.filter((c) => c > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The counter users see: about how many generations the remaining budget
 * buys, at the org's typical cost (or the model's before it has any).
 * Dollars stay internal.
 */
export function estimateGenerationsLeft(remainingUsd, avgCostUsd) {
  if (remainingUsd <= 0) return 0;
  if (!(avgCostUsd > 0)) return 0;
  return Math.floor(remainingUsd / avgCostUsd);
}
