import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    expect(
      sentimentSchema.safeParse({ sentiment: 'positive', confidence: 1.5, reason: 'x' }).success,
    ).toBe(false);
  });
});
