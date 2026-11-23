import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { serpProviderOrder, webResearch } from './web-research.js';
import { logger } from './logger.js';

// Stubbed before every test: unstubAllGlobals in afterEach would otherwise
// hand later tests the real fetch, and they would call Tavily for real.
beforeEach(() => {
  vi.stubGlobal('fetch', (...args) => state.fetch(...args));
});

/** What suggestion research does when its search options fail. */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  state.tools = { type: 'function', name: 'web_search' };
  vi.clearAllMocks();
});

const TAVILY_RESULTS = {
  results: [
    { title: 'A', url: 'https://a', content: 'a' },
    { title: 'B', url: 'https://b', content: 'b' },
  ],
};
const CLORO_RESULTS = {
  result: {
    organicResults: [
      { title: 'A', link: 'https://a', snippet: 'a' },
      { title: 'B', link: 'https://b', snippet: 'b' },
    ],
  },
};
const SCRAPEDO_RESULTS = {
  organic_results: [
    { title: 'A', link: 'https://a', snippet: 'a' },
    { title: 'B', link: 'https://b', snippet: 'b' },
  ],
};
const FIRECRAWL_RESULTS = {
  success: true,
  data: {
    web: [
      { title: 'A', url: 'https://a', description: 'a' },
      { title: 'B', url: 'https://b', description: 'b' },
    ],
  },
};

describe('webResearch', () => {
  it('carries the search with Tavily when a key is set', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    state.generateText
      .mockResolvedValueOnce({ text: 'how banks measure aeo' })
      .mockResolvedValueOnce({ text: 'the synthesis' });
    state.fetch.mockResolvedValue({ ok: true, json: async () => TAVILY_RESULTS });

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
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls through to Cloro when Tavily comes up empty', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('CLORO_API_KEY', 'cloro_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'tavily,cloro');
    state.generateText.mockImplementation(({ prompt }) =>
      Promise.resolve(
        prompt.includes('Use these web research results')
          ? { text: 'the cloro synthesis' }
          : { text: 'a query' },
      ),
    );
    state.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => CLORO_RESULTS });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'the cloro synthesis', searched: true, sources: 2 });
    expect(state.fetch).toHaveBeenCalledTimes(2);
    expect(state.fetch.mock.calls[1][0]).toBe('https://api.cloro.dev/v1/monitor/google');
  });

  it('falls through to Scrape.do when Tavily and Cloro both fail', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('CLORO_API_KEY', 'cloro_test');
    vi.stubEnv('SCRAPEDO_API_KEY', 'sd_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'tavily,cloro,scrapedo');
    state.generateText.mockImplementation(({ prompt }) =>
      Promise.resolve(
        prompt.includes('Use these web research results')
          ? { text: 'the scrape.do synthesis' }
          : { text: 'a query' },
      ),
    );
    state.fetch
      .mockRejectedValueOnce(new Error('tavily down'))
      .mockRejectedValueOnce(new Error('cloro down'))
      .mockResolvedValueOnce({ ok: true, json: async () => SCRAPEDO_RESULTS });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'the scrape.do synthesis', searched: true, sources: 2 });
    expect(state.fetch).toHaveBeenCalledTimes(3);
    expect(String(state.fetch.mock.calls[2][0])).toContain('api.scrape.do/plugin/google/search');
  });

  it('falls through to Firecrawl when Tavily fails', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'tavily,firecrawl');
    state.generateText.mockImplementation(({ prompt }) =>
      Promise.resolve(
        prompt.includes('Use these web research results')
          ? { text: 'the firecrawl synthesis' }
          : { text: 'a query' },
      ),
    );
    state.fetch
      .mockRejectedValueOnce(new Error('tavily down'))
      .mockResolvedValueOnce({ ok: true, json: async () => FIRECRAWL_RESULTS });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'the firecrawl synthesis', searched: true, sources: 2 });
    expect(state.fetch).toHaveBeenCalledTimes(2);
    expect(state.fetch.mock.calls[1][0]).toBe('https://api.firecrawl.dev/v2/search');
    const init = state.fetch.mock.calls[1][1];
    expect(init.headers.Authorization).toBe('Bearer fc_test');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toMatchObject({ query: 'a query', limit: 8 });
    const synthesis = state.generateText.mock.calls[1][0].prompt;
    expect(synthesis).toContain('[A](https://a)\na');
  });

  it('falls back past Firecrawl when it returns no results', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'firecrawl');
    state.generateText
      .mockResolvedValueOnce({ text: 'a query' })
      .mockResolvedValueOnce({ text: 'grounded answer', sources: [{}] });
    state.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { web: [] } }),
    });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'grounded answer', searched: true, sources: 1 });
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it('skips Firecrawl when its API key is unset', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'firecrawl,tavily');
    state.generateText
      .mockResolvedValueOnce({ text: 'a query' })
      .mockResolvedValueOnce({ text: 'the synthesis' });
    state.fetch.mockResolvedValue({ ok: true, json: async () => TAVILY_RESULTS });

    await webResearch('google/gemini-3-flash', 'research this');

    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][0]).toBe('https://api.tavily.com/search');
  });

  it('skips providers whose API key is unset', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    state.generateText
      .mockResolvedValueOnce({ text: 'a query' })
      .mockResolvedValueOnce({ text: 'the synthesis' });
    state.fetch.mockResolvedValue({ ok: true, json: async () => TAVILY_RESULTS });

    await webResearch('google/gemini-3-flash', 'research this');

    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][0]).toBe('https://api.tavily.com/search');
  });

  it('orders the chain from WEB_RESEARCH_PROVIDERS', () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('CLORO_API_KEY', 'cloro_test');
    vi.stubEnv('SCRAPEDO_API_KEY', 'sd_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'cloro, tavily, bogus, scrapedo');

    expect(serpProviderOrder().map((p) => p.name)).toEqual(['cloro', 'tavily', 'scrapedo']);
  });

  it('places Firecrawl where WEB_RESEARCH_PROVIDERS names it', () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('SCRAPEDO_API_KEY', 'sd_test');
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'Firecrawl, tavily, scrapedo');

    expect(serpProviderOrder().map((p) => p.name)).toEqual(['firecrawl', 'tavily', 'scrapedo']);
  });

  it('drops a provider named in WEB_RESEARCH_PROVIDERS with its key unset', () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('SCRAPEDO_API_KEY', 'sd_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'tavily,cloro,scrapedo');

    expect(serpProviderOrder().map((p) => p.name)).toEqual(['tavily', 'scrapedo']);
  });

  it('defaults to Tavily alone even when every key is set', () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('CLORO_API_KEY', 'cloro_test');
    vi.stubEnv('SCRAPEDO_API_KEY', 'sd_test');
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    vi.stubEnv('CONTEXT_DEV_API_KEY', 'ctxt_test');

    expect(serpProviderOrder().map((p) => p.name)).toEqual(['tavily']);
  });

  it('distills the query once for the whole chain', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('CLORO_API_KEY', 'cloro_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'tavily,cloro');
    state.generateText
      .mockResolvedValueOnce({ text: 'one shared query' })
      .mockResolvedValueOnce({ text: 'the cloro synthesis' });
    state.fetch
      .mockRejectedValueOnce(new Error('tavily down'))
      .mockResolvedValueOnce({ ok: true, json: async () => CLORO_RESULTS });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'the cloro synthesis', searched: true, sources: 2 });
    expect(state.generateText).toHaveBeenCalledTimes(2);
    expect(JSON.parse(state.fetch.mock.calls[1][1].body).query).toBe('one shared query');
  });

  it('skips the chain and falls back when query distillation fails', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    state.generateText
      .mockRejectedValueOnce(new Error('429 quota exceeded'))
      .mockResolvedValueOnce({ text: 'grounded answer', sources: [{}, {}] });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'grounded answer', searched: true, sources: 2 });
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('gives the Tavily search a timeout', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    state.generateText
      .mockResolvedValueOnce({ text: 'a query' })
      .mockResolvedValueOnce({ text: 'the synthesis' });
    state.fetch.mockResolvedValue({ ok: true, json: async () => TAVILY_RESULTS });

    await webResearch('google/gemini-3-flash', 'research this');

    expect(state.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a grounded-call failure that is not a quota wall', async () => {
    state.generateText.mockRejectedValueOnce(
      Object.assign(new Error('API key not valid'), { statusCode: 400 }),
    );

    await expect(webResearch('google/gemini-3-flash', 'research this')).rejects.toThrow(
      'API key not valid',
    );
    expect(state.generateText).toHaveBeenCalledTimes(1);
  });

  it('treats a retried-out 429 as a quota wall', async () => {
    state.generateText
      .mockRejectedValueOnce(
        Object.assign(new Error('Failed after 3 attempts'), {
          lastError: { statusCode: 429, message: 'Too Many Requests' },
        }),
      )
      .mockResolvedValueOnce({ text: 'from the model alone' });

    const result = await webResearch('google/gemini-3-flash', 'research this');

    expect(result).toEqual({ text: 'from the model alone', searched: false, sources: 0 });
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

describe('Context research', () => {
  const page = {
    title: 'A',
    url: 'https://example.com/a',
    highlights: { code: 'SUCCESS', highlights: ['first passage', 'second passage'] },
  };

  beforeEach(() => {
    state.generateText.mockReset();
    state.fetch.mockReset();
    vi.stubEnv('CONTEXT_DEV_API_KEY', 'ctxt_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'context');
    state.tools = null;
    state.generateText
      .mockResolvedValueOnce({ text: 'a query' })
      .mockResolvedValueOnce({ text: 'the synthesis' });
  });

  it('synthesizes successful Highlights with citations and a bounded request', async () => {
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [page] }) });

    expect(await webResearch('openrouter/test', 'research this')).toEqual({
      text: 'the synthesis',
      searched: true,
      sources: 1,
    });
    const [url, init] = state.fetch.mock.calls[0];
    expect(url).toBe('https://api.context.dev/v1/web/search');
    expect(init.headers.Authorization).toBe('Bearer ctxt_test');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      query: 'a query',
      numResults: 8,
      highlightsOptions: { enabled: true },
    });
    expect(state.generateText.mock.calls[1][0].prompt).toContain(
      '[A](https://example.com/a)\nfirst passage\nsecond passage',
    );
  });

  it('keeps explicit order and skips an unset key', () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly_test');
    vi.stubEnv('WEB_RESEARCH_PROVIDERS', 'tavily, Context');
    expect(serpProviderOrder().map((p) => p.name)).toEqual(['tavily', 'context']);
    vi.stubEnv('CONTEXT_DEV_API_KEY', '');
    expect(serpProviderOrder().map((p) => p.name)).toEqual(['tavily']);
  });

  it('counts only usable Highlights from valid source URLs', async () => {
    state.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          page,
          { ...page, highlights: { code: 'TIMEOUT', highlights: ['unverified'] } },
          { ...page, highlights: { code: 'SUCCESS', highlights: [' ', null, 4] } },
          ...['javascript:alert(1)', 'not a url', 'https://user:secret@example.com'].map((url) => ({
            ...page,
            url,
          })),
          null,
        ],
      }),
    });
    const result = await webResearch('openrouter/test', 'research this');
    expect(result.sources).toBe(1);
    expect(state.generateText.mock.calls[1][0].prompt).not.toContain('unverified');
  });

  it.each([
    null,
    { results: {} },
    { results: [] },
    { partial: true, results: [page] },
    { results: [{ ...page, highlights: { code: 'ERROR', highlights: ['failed'] } }] },
  ])('does not call unavailable evidence searched: %j', async (body) => {
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => body });
    expect(await webResearch('openrouter/test', 'research this')).toEqual({
      text: 'the synthesis',
      searched: false,
      sources: 0,
    });
  });

  it.each([401, 402, 429, 500])(
    'falls through on HTTP %i without reading its payload',
    async (status) => {
      const json = vi.fn(async () => ({ error: 'ctxt_test' }));
      state.fetch.mockResolvedValueOnce({ ok: false, status, json });
      const result = await webResearch('openrouter/test', 'research this');
      expect(result.searched).toBe(false);
      expect(json).not.toHaveBeenCalled();
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('ctxt_test');
    },
  );

  it.each(['network', 'timeout', 'redirect', 'bad-json'])(
    'keeps %s diagnostics secret-free',
    async (kind) => {
      const error = new Error(`${kind}: ctxt_test and ctxt_\\u0074est`);
      error.cause = { headers: { Authorization: 'Bearer ctxt_test' } };
      if (kind === 'bad-json') {
        state.fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw error;
          },
        });
      } else {
        state.fetch.mockRejectedValueOnce(error);
      }
      expect((await webResearch('openrouter/test', 'research this')).searched).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('context research failed; falling back');
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('ctxt_');
    },
  );
});
