import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

const generateObject = vi.fn();
const resolveModel = vi.fn();

vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
vi.mock('./ai-provider.js', () => ({ resolveModel: (...args) => resolveModel(...args) }));
vi.mock('./logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { analyzeSentimentAI, sentimentSchema } = await import('./sentiment.js');

describe('analyzeSentimentAI', () => {
  const ORIGINAL_MODEL = process.env.SENTIMENT_MODEL;

  beforeEach(() => {
    generateObject.mockReset();
    resolveModel.mockReset();
    resolveModel.mockReturnValue({ id: 'stub-model' });
    delete process.env.SENTIMENT_MODEL;
  });

  afterEach(() => {
    if (ORIGINAL_MODEL === undefined) delete process.env.SENTIMENT_MODEL;
    else process.env.SENTIMENT_MODEL = ORIGINAL_MODEL;
  });

  it('keeps the historical OpenAI default when SENTIMENT_MODEL is unset', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'positive', confidence: 0.9, reason: 'Recommended first' },
    });

    await analyzeSentimentAI('Acme Coffee is the top pick.', 'Acme Coffee');

    expect(resolveModel).toHaveBeenCalledWith('openai/gpt-5-mini');
  });

  it('routes to any configured provider — no OpenAI key required', async () => {
    process.env.SENTIMENT_MODEL = 'anthropic/claude-haiku-4-5';
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: 0.4, reason: 'Listed among others' },
    });

    const result = await analyzeSentimentAI('Several roasters exist.', 'Acme Coffee');

    expect(resolveModel).toHaveBeenCalledWith('anthropic/claude-haiku-4-5');
    expect(result.sentiment).toBe('neutral');
  });

  it('accepts nested OpenRouter model ids verbatim', async () => {
    process.env.SENTIMENT_MODEL = 'openrouter/anthropic/claude-haiku-4.5';
    generateObject.mockResolvedValue({
      object: { sentiment: 'negative', confidence: 0.7, reason: 'Called overpriced' },
    });

    await analyzeSentimentAI('Acme Coffee is overpriced.', 'Acme Coffee');

    expect(resolveModel).toHaveBeenCalledWith('openrouter/anthropic/claude-haiku-4.5');
  });

  it('truncates long responses to 3000 chars, as the previous implementation did', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: 0.5, reason: 'ok' },
    });

    await analyzeSentimentAI('x'.repeat(5000), 'Acme Coffee');

    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain('x'.repeat(3000));
    expect(prompt).not.toContain('x'.repeat(3001));
  });

  it('degrades to neutral instead of throwing when the model call fails', async () => {
    generateObject.mockRejectedValue(new Error('rate limited'));

    const result = await analyzeSentimentAI('Acme Coffee is great.', 'Acme Coffee');

    expect(result).toEqual({ sentiment: 'neutral', confidence: 0, reason: 'Analysis failed' });
  });

  it('degrades to neutral when the provider is not configured at all', async () => {
    resolveModel.mockImplementation(() => {
      throw new Error('Provider "openrouter" is not configured.');
    });

    const result = await analyzeSentimentAI('Acme Coffee is great.', 'Acme Coffee');

    expect(result.sentiment).toBe('neutral');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('constrains the schema to the three sentiment values', () => {
    expect(
      sentimentSchema.safeParse({ sentiment: 'mixed', confidence: 0.5, reason: 'x' }).success,
    ).toBe(false);
  });

  it('keeps confidence free of min/max so Anthropic accepts the schema', () => {
    // Anthropic rejects `minimum`/`maximum` on numbers in strict structured
    // output, and OpenRouter surfaces that 400 from every backing provider.
    // Verified against the live endpoint, not just in principle.
    const json = z.toJSONSchema(sentimentSchema);

    expect(json.properties.confidence.minimum).toBeUndefined();
    expect(json.properties.confidence.maximum).toBeUndefined();
  });

  it('clamps out-of-range confidence in code instead', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'positive', confidence: 1.5, reason: 'over-confident model' },
    });
    expect((await analyzeSentimentAI('great', 'Acme')).confidence).toBe(1);

    generateObject.mockResolvedValue({
      object: { sentiment: 'negative', confidence: -0.2, reason: 'negative number' },
    });
    expect((await analyzeSentimentAI('bad', 'Acme')).confidence).toBe(0);
  });

  it('falls back to 0.5 when the model omits a usable confidence', async () => {
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: Number.NaN, reason: 'unparseable' },
    });

    expect((await analyzeSentimentAI('meh', 'Acme')).confidence).toBe(0.5);
  });
});
