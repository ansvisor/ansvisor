import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  generateText: vi.fn(),
  fetch: vi.fn(),
  tools: { type: 'function', name: 'web_search' },
}));

vi.mock('ai', () => ({ generateText: (...args) => state.generateText(...args) }));
vi.mock('./ai-provider.js', () => ({
  resolveModel: vi.fn(() => 'resolved-model'),
  webSearchTools: vi.fn(() => state.tools),
}));
vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { webResearch } from './web-research.js';

vi.stubGlobal('fetch', (...args) => state.fetch(...args));

/** What suggestion research does when its search options fail. */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  state.tools = { type: 'function', name: 'web_search' };
  vi.clearAllMocks();
});

describe('webResearch', () => {
  it('carries the search with Tavily when a key is set', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    state.generateText
      .mockResolvedValueOnce({ text: 'how banks measure aeo' })
      .mockResolvedValueOnce({ text: 'the synthesis' });
    state.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: 'A', url: 'https://a', content: 'a' },
          { title: 'B', url: 'https://b', content: 'b' },
        ],
      }),
    });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'the synthesis', searched: true, sources: 2 });
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][0]).toBe('https://api.tavily.com/search');
    expect(JSON.parse(state.fetch.mock.calls[0][1].body).query).toBe('how banks measure aeo');
  });

  it('falls back to the provider search tool when Tavily fails', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    state.generateText
      .mockResolvedValueOnce({ text: 'a query' })
      .mockResolvedValueOnce({ text: 'grounded answer', sources: [{}, {}] });
    state.fetch.mockRejectedValue(new Error('tavily down'));

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'grounded answer', searched: true, sources: 2 });
  });

  it('survives a quota wall on the provider search and still returns research', async () => {
    state.generateText
      .mockRejectedValueOnce(new Error('429 quota exceeded'))
      .mockResolvedValueOnce({ text: 'from the model alone' });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'from the model alone', searched: false, sources: 0 });
  });

  it('researches from the model alone when nothing offers search', async () => {
    state.tools = null;
    state.generateText.mockResolvedValueOnce({ text: 'plain answer' });

    const result = await webResearch('openai/gpt-5-mini', 'research this');

    expect(result).toEqual({ text: 'plain answer', searched: false, sources: 0 });
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
