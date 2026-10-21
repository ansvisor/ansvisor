/**
 * What an Improve generation (PROMPT-003) actually cost, so the monthly
 * quota can be a dollar budget — a share of what the customer pays — and stay
 * there whichever model IMPROVE_SUGGESTION_MODEL points at.
 *
 * List prices in USD per million tokens. Update this table when a provider
 * changes its prices or a new model is configured; a model missing here is
 * charged at FALLBACK_PRICE, deliberately expensive, so an unknown model can
 * only use the budget up faster, never overspend it.
 */

export const MODEL_PRICES = {
  'google/gemini-3-flash-preview': { input: 0.5, output: 3 },
  'google/gemini-3-flash': { input: 0.5, output: 3 },
  'openai/gpt-5-mini': { input: 0.25, output: 2 },
  'anthropic/claude-haiku-4-5': { input: 1, output: 5 },
};

export const FALLBACK_PRICE = { input: 5, output: 25 };

/** Share of an Enterprise contract's monthly value its AI usage budget may spend (plan-guard.js). */
export const IMPROVE_BUDGET_SHARE = 0.01;

/**
 * A typical generation, used to estimate "generations left" before an org
 * has any history: ~7k input and ~2k output tokens on the configured model.
 */
const TYPICAL_TOKENS = { input: 7000, output: 2000 };

/**
 * OpenRouter ids carry the provider id after an `openrouter/` prefix
 * (`openrouter/google/gemini-3-flash-preview`); they're priced as that model.
 */
export function priceFor(modelId) {
  const id = String(modelId ?? '').replace(/^openrouter\//, '');
  return MODEL_PRICES[id] ?? FALLBACK_PRICE;
}

/** USD cost of one call from the AI SDK's `usage`. */
export function generationCostUsd(modelId, usage) {
  const price = priceFor(modelId);
  const input = Number(usage?.inputTokens) || 0;
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
