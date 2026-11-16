import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Caller-level wiring: sentiment.js and the real decider.js together, with
// only fetch mocked. Proves the Google provider path is reachable end to end,
// not just inside decide() unit tests.

const generateObject = vi.fn();
const resolveModel = vi.fn();

vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
vi.mock('./ai-provider.js', () => ({ resolveModel: (...args) => resolveModel(...args) }));
vi.mock('./logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { analyzeSentimentAI } = await import('./sentiment.js');
const { decide, isDeciderConfigured } = await import('./decider.js');
const { classifyQueryIntents } = await import('./intent-extraction.js');

const ENV_KEYS = [
  'SENTIMENT_MODEL',
  'OPENROUTER_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'DECIDER_PROVIDER',
  'FANOUT_INTENTS_DECIDER',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const fetchMock = vi.fn();

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const CHOICE = {
  answers: {
    sentiment: {
      type: 'choice',
      choice: 'positive',
      probabilities: { positive: 0.9, neutral: 0.08, negative: 0.02 },
      confidence: 0.95,
    },
  },
};

describe('sentiment through the real decider provider switch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    generateObject.mockReset();
    resolveModel.mockReset();
    delete process.env.SENTIMENT_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.DECIDER_PROVIDER;
    delete process.env.FANOUT_INTENTS_DECIDER;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  it('uses Google decisions with only a Google key and DECIDER_PROVIDER=google', async () => {
    process.env.DECIDER_PROVIDER = 'google';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-key';
    fetchMock.mockResolvedValue(reply(200, CHOICE));

    const result = await analyzeSentimentAI('Acme is the top pick.', 'Acme');

    expect(result).toEqual({ sentiment: 'positive', confidence: 0.9, reason: '' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/decisions');
    expect(init.headers['x-goog-api-key']).toBe('google-key');
    expect(JSON.parse(init.body).model).toBe('gemini-decision-1');
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it('keeps OpenRouter as the default provider when DECIDER_PROVIDER is unset', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    fetchMock.mockResolvedValue(reply(200, CHOICE));

    const result = await analyzeSentimentAI('Acme is the top pick.', 'Acme');

    expect(result.sentiment).toBe('positive');
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it('falls back to the chat model when the Google decision call fails', async () => {
    process.env.DECIDER_PROVIDER = 'google';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-key';
    fetchMock.mockResolvedValue(reply(400, { error: 'bad request' }));
    resolveModel.mockReturnValue('chat-model');
    generateObject.mockResolvedValue({
      object: { sentiment: 'neutral', confidence: 0.5, reason: 'Mentioned in passing' },
    });

    const result = await analyzeSentimentAI('Acme is mentioned once.', 'Acme');

    expect(result.sentiment).toBe('neutral');
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('uses the chat model when no decision provider key is configured', async () => {
    resolveModel.mockReturnValue('chat-model');
    generateObject.mockResolvedValue({
      object: { sentiment: 'negative', confidence: 0.7, reason: 'Warned against' },
    });

    const result = await analyzeSentimentAI('Avoid Acme.', 'Acme');

    expect(result.sentiment).toBe('negative');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fan-out intents through the real decider provider switch', () => {
  // The same wiring prompts.js uses: real decide + real isDeciderConfigured.
  const deps = {
    chatModel: () => resolveModel(),
    decideFn: decide,
    deciderConfigured: isDeciderConfigured,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    generateObject.mockReset();
    resolveModel.mockReset();
    delete process.env.SENTIMENT_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.DECIDER_PROVIDER;
    delete process.env.FANOUT_INTENTS_DECIDER;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  it('batches intents through Google decisions with only a Google key', async () => {
    process.env.FANOUT_INTENTS_DECIDER = '1';
    process.env.DECIDER_PROVIDER = 'google';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-key';
    fetchMock.mockResolvedValue(
      reply(200, {
        answers: {
          q0: { type: 'choice', choice: 'best-top', probabilities: {}, confidence: 0.9 },
        },
      }),
    );

    const intents = await classifyQueryIntents(['best ai tools'], deps);

    expect(intents).toEqual({ 'best ai tools': 'best-top' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/decisions');
    expect(init.headers['x-goog-api-key']).toBe('google-key');
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it('keeps OpenRouter as the fan-out default when DECIDER_PROVIDER is unset', async () => {
    process.env.FANOUT_INTENTS_DECIDER = '1';
    process.env.OPENROUTER_API_KEY = 'or-key';
    fetchMock.mockResolvedValue(
      reply(200, {
        answers: {
          q0: { type: 'choice', choice: 'what-is', probabilities: {}, confidence: 0.9 },
        },
      }),
    );

    const intents = await classifyQueryIntents(['what is aeo'], deps);

    expect(intents).toEqual({ 'what is aeo': 'what-is' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions');
  });

  it('falls back to the chat model when FANOUT_INTENTS_DECIDER is set but no provider key exists', async () => {
    process.env.FANOUT_INTENTS_DECIDER = '1';
    resolveModel.mockReturnValue('chat-model');
    generateObject.mockResolvedValue({ object: { intent: 'other' } });

    const intents = await classifyQueryIntents(['acme'], deps);

    expect(intents).toEqual({ acme: 'other' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
});
