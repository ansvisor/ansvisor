import { afterEach, describe, expect, it } from 'vitest';
import { setSyncedPrices } from './model-price-cache.js';
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

  it("prices the Content Editor's Claude models: Haiku 5.5 reads, Sonnet 5.5 writes", () => {
    // Haiku 5.5: $0.10 / $0.50 per 1M; Sonnet 5.5: $2 / $10.
    expect(
      generationCostUsd('anthropic/claude-haiku-5-5', { inputTokens: 7000, outputTokens: 2000 }),
    ).toBeCloseTo(0.0017, 6);
    expect(
      generationCostUsd('anthropic/claude-sonnet-5-5', { inputTokens: 7000, outputTokens: 2000 }),
    ).toBeCloseTo(0.034, 6);
    expect(priceFor('anthropic/claude-sonnet-5-5')).not.toBe(FALLBACK_PRICE);
  });

  it("charges Haiku 5.5's long rate, $0.50 / $2.50, on a prompt past 100k tokens only", () => {
    expect(
      generationCostUsd('anthropic/claude-haiku-5-5', {
        inputTokens: 100_000,
        outputTokens: 1_000,
      }),
    ).toBeCloseTo(0.0105, 6);
    expect(
      generationCostUsd('anthropic/claude-haiku-5-5', {
        inputTokens: 100_001,
        outputTokens: 1_000,
      }),
    ).toBeCloseTo(0.0525005, 7);
    // A model with one rate has none.
    expect(
      generationCostUsd('anthropic/claude-sonnet-5-5', { inputTokens: 200_000, outputTokens: 0 }),
    ).toBe(0.4);
  });
});

describe('priceFor with synced prices (CHAT-16 §A)', () => {
  afterEach(() => setSyncedPrices([]));

  const HAIKU = {
    model_id: 'anthropic/claude-haiku-5.5',
    input_per_m: 0.1,
    output_per_m: 0.5,
    overrides: [{ min_prompt_tokens: 100000, prompt: '0.0000005', completion: '0.0000025' }],
  };

  it('reads the synced price first, under its hyphened or OpenRouter id too', () => {
    setSyncedPrices([HAIKU]);
    for (const id of [
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-haiku-5-5',
      'openrouter/anthropic/claude-haiku-5.5',
    ]) {
      expect(priceFor(id)).toEqual({ input: 0.1, output: 0.5 });
    }
  });

  it("falls back to the server's own table for a model that isn't synced", () => {
    setSyncedPrices([HAIKU]);
    expect(priceFor('google/gemini-3-flash-preview')).toBe(
      MODEL_PRICES['google/gemini-3-flash-preview'],
    );
    expect(priceFor('someone/new-model')).toBe(FALLBACK_PRICE);
  });

  it('prices a call at the prompt-size override once its input is that large', () => {
    setSyncedPrices([HAIKU]);
    expect(
      generationCostUsd('anthropic/claude-haiku-5.5', { inputTokens: 10_000, outputTokens: 1000 }),
    ).toBeCloseTo(0.0015, 8);
    expect(
      generationCostUsd('anthropic/claude-haiku-5.5', { inputTokens: 100_000, outputTokens: 1000 }),
    ).toBeCloseTo(0.0525, 8);
  });
});

describe('the same 1% budget buys more on a cheaper model', () => {
  it('Growth ($2.49) on Flash vs GPT-5 mini vs Haiku', () => {
    const left = (model) => estimateGenerationsLeft(2.49, typicalCostUsd(model));
    expect(left('google/gemini-3-flash-preview')).toBe(262);
    expect(left('openai/gpt-5-mini')).toBe(433);
    expect(left('anthropic/claude-haiku-4-5')).toBe(146);
    expect(left('anthropic/claude-haiku-5-5')).toBe(1464);
    expect(left('anthropic/claude-sonnet-5-5')).toBe(73);
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
