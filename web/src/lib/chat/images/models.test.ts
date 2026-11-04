import { describe, expect, it } from 'vitest';
import { IMAGE_MODELS, defaultImageModel, isImageModel } from './models';

/** The image models Chat offers, and the default: the cheapest by the price data (W4-07). */

describe('defaultImageModel', () => {
  it('picks the model whose image takes the smallest share of the monthly limit', () => {
    expect(
      defaultImageModel([
        { model: 'google/gemini-3.1-flash-lite-image', percent: 0.77 },
        { model: 'google/gemini-3.1-flash-image', percent: 1.55 },
        { model: 'google/gemini-3-pro-image', percent: 3.1 },
        { model: 'openai/gpt-5-image-mini', percent: 0.21 },
      ]).id,
    ).toBe('openai/gpt-5-image-mini');
  });

  it('falls back to the list’s first with no share known', () => {
    expect(defaultImageModel([])).toBe(IMAGE_MODELS[0]);
    expect(defaultImageModel([{ model: 'google/gemini-3-pro-image', percent: null }])).toBe(
      IMAGE_MODELS[0],
    );
  });

  it('knows its own models only', () => {
    expect(isImageModel('google/gemini-3-pro-image')).toBe(true);
    expect(isImageModel('google/gemini-3.8-flash')).toBe(false);
  });
});
