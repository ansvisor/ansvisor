import { describe, expect, it } from 'vitest';
import { IMAGE_MODELS, defaultImageModel, imageModelNamed, isImageModel } from './models';

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

/** The image model a run names (CHAT-15 item 18, W4-08b): the composer's "Image · {model}". */
describe('imageModelNamed', () => {
  it('reads the model from the answered question, then from the images’ card and step', () => {
    expect(imageModelNamed([{ kind: 'ask', detail: 'Nano Banana 2 Lite' }])).toBe(
      'Nano Banana 2 Lite',
    );
    expect(
      imageModelNamed([
        { kind: 'ask', detail: 'Nano Banana 2 Lite' },
        {
          kind: 'write',
          detail: '4 images · Nano Banana Pro · about 3.1% of your monthly AI limit',
        },
      ]),
    ).toBe('Nano Banana Pro');
    // "Nano Banana 2" is not "Nano Banana 2 Lite", nor the other way round.
    expect(
      imageModelNamed([{ kind: 'write', detail: '4 images · Nano Banana 2 · on your own key' }]),
    ).toBe('Nano Banana 2');
    expect(imageModelNamed([{ kind: 'ask', detail: 'Skipped · used GPT-5 Image Mini' }])).toBe(
      'GPT-5 Image Mini',
    );
  });

  it('is null for a run that names no image model, or names one only in a read', () => {
    expect(imageModelNamed([])).toBeNull();
    expect(imageModelNamed([{ kind: 'ask', detail: 'Last 30 days' }])).toBeNull();
    expect(imageModelNamed([{ kind: 'read', detail: 'Nano Banana 2 Lite' }])).toBeNull();
    expect(imageModelNamed([{ kind: 'write', detail: undefined }])).toBeNull();
  });
});
