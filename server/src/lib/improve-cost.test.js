import { describe, expect, it } from 'vitest';
import {
  FALLBACK_PRICE,
  MODEL_PRICES,
  estimateGenerationsLeft,
  generationCostUsd,
  medianCost,
  priceFor,
  typicalCostUsd,
} from './improve-cost.js';

describe('generationCostUsd', () => {
  it('prices input and output tokens per million at the model rate', () => {
    // Gemini 3 Flash: $0.50 in / $3 out per 1M.
    expect(
      generationCostUsd('google/gemini-3-flash-preview', { inputTokens: 7000, outputTokens: 2000 }),
    ).toBeCloseTo(0.0095, 6);
    // GPT-5 mini: $0.25 / $2.
    expect(
      generationCostUsd('openai/gpt-5-mini', { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(0.25);
  });

  it('charges an unknown model at the expensive fallback, never at zero', () => {
    expect(priceFor('someone/new-model')).toBe(FALLBACK_PRICE);
    expect(priceFor('openrouter/someone/new-model')).toBe(FALLBACK_PRICE);
    expect(generationCostUsd('someone/new-model', { inputTokens: 1000, outputTokens: 1000 })).toBe(
      0.03,
    );
  });

  it('prices an OpenRouter id as the model it routes to', () => {
    expect(priceFor('openrouter/google/gemini-3-flash-preview')).toBe(
      MODEL_PRICES['google/gemini-3-flash-preview'],
    );
  });

  it('treats missing usage as zero tokens', () => {
    expect(generationCostUsd('openai/gpt-5-mini', undefined)).toBe(0);
  });
});

describe('the same 1% budget buys more on a cheaper model', () => {
  it('Growth ($2.49) on Flash vs GPT-5 mini vs Haiku', () => {
    const left = (model) => estimateGenerationsLeft(2.49, typicalCostUsd(model));
    expect(left('google/gemini-3-flash-preview')).toBe(262);
    expect(left('openai/gpt-5-mini')).toBe(433);
    expect(left('anthropic/claude-haiku-4-5')).toBe(146);
  });
});

describe('estimateGenerationsLeft', () => {
  it('is zero once the budget is spent or the cost is unknown', () => {
    expect(estimateGenerationsLeft(0, 0.01)).toBe(0);
    expect(estimateGenerationsLeft(1, 0)).toBe(0);
  });

  it('rounds down', () => {
    expect(estimateGenerationsLeft(0.1, 0.03)).toBe(3);
  });
});

describe('medianCost', () => {
  it('ignores one outlier', () => {
    expect(medianCost([0.0095, 0.0095, 1.6, 0.0095])).toBe(0.0095);
  });

  it('averages the two middle values of an even list, and is null when empty', () => {
    expect(medianCost([0.01, 0.03])).toBe(0.02);
    expect(medianCost([])).toBeNull();
  });
});
