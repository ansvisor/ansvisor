import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('./logger.js', () => ({ logger: log, default: log }));

const {
  ANAKIN_ENGINES,
  answerPayload,
  buildTaskBody,
  parseScraperResponse,
  pollScraperResult,
  rateLimiter,
  submitPromptTask,
} = await import('./anakin-scraper.js');

/**
 * Anakin's Wire API as an answer provider. The sample jobs follow Anakin's
 * docs (anakin.io/docs/geo-aeo): a finished job's answer sits at
 * `data.data`, beside `data.meta`.
 */
const job = (payload, extra = {}) => ({
  status: 'completed',
  credits_used: 2,
  execution_ms: 21000,
  data: { status: 'ok', data: payload, meta: { action_id: 'chatgpt', envelope_version: 1 } },
  ...extra,
});

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock;
beforeEach(() => {
  vi.stubEnv('ANAKIN_API_KEY', 'test-key');
  vi.stubEnv('ANAKIN_SUBMIT_PER_MIN', '1000');
  vi.stubEnv('ANAKIN_POLL_PER_MIN', '1000');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('buildTaskBody', () => {
  it("asks ChatGPT with web search, the location's country and its US state", () => {
    expect(buildTaskBody('best crm', 'chatgpt-web', 'US-CA')).toEqual({
      action_id: 'chatgpt',
      params: { prompt: 'best crm', country: 'us', state: 'CA', web_search: true },
    });
  });

  it('asks in the US when the prompt has no location (Anakin defaults some to India)', () => {
    expect(buildTaskBody('q', 'google-aio', null).params.country).toBe('us');
    expect(buildTaskBody('q', 'chatgpt-web', 'DE').params).toEqual({
      prompt: 'q',
      country: 'de',
      web_search: true,
    });
  });

  it("gives AI Overviews the prompt as `query` and a state as Google's place name", () => {
    expect(buildTaskBody('q', 'google-aio', 'US-TX')).toEqual({
      action_id: 'google_ai_overview',
      params: { query: 'q', country: 'us', location: 'Texas,United States' },
    });
  });

  it('gives AI Mode a state or city as its place name, and a country alone none', () => {
    // A city task (locations.js CITY_SCRAPERS) reaches AI Mode: without
    // `location` it was answered country-wide and stored in the city's column.
    expect(buildTaskBody('q', 'google-aimode', 'US-TX')).toEqual({
      action_id: 'ai_mode',
      params: { prompt: 'q', country: 'us', location: 'Texas,United States' },
    });
    expect(buildTaskBody('q', 'google-aimode', 'TR~ISTANBUL').params).toEqual({
      prompt: 'q',
      country: 'tr',
      location: 'Istanbul,Istanbul,Turkiye',
    });
    expect(buildTaskBody('q', 'google-aimode', 'US').params).toEqual({
      prompt: 'q',
      country: 'us',
    });
  });

  it('runs the signed-in platforms on the account pool, outside params', () => {
    for (const id of ['perplexity-web', 'grok-web', 'claude-web', 'deepseek-web', 'copilot-app']) {
      const body = buildTaskBody('q', id, 'US');
      expect(body.use_account_pool).toBe(true);
      expect(body.params.use_account_pool).toBeUndefined();
    }
    for (const id of ['chatgpt-web', 'meta-ai-web', 'gemini-web', 'google-aimode', 'copilot-web']) {
      expect(buildTaskBody('q', id, 'US').use_account_pool).toBeUndefined();
    }
    expect(buildTaskBody('q', 'perplexity-web', 'US')).toEqual({
      action_id: 'pplx_prompt',
      params: { query: 'q', country: 'us' },
      use_account_pool: true,
    });
  });

  it('maps every platform to its action: Bing AI Mode stays copilot-web, ads on ChatGPT Ads', () => {
    const actions = Object.fromEntries(
      Object.keys(ANAKIN_ENGINES).map((id) => [id, buildTaskBody('q', id, 'US').action_id]),
    );
    expect(actions).toEqual({
      'chatgpt-web': 'chatgpt',
      'chatgpt-shopping': 'chatgpt',
      'google-aio': 'google_ai_overview',
      'google-aimode': 'ai_mode',
      'copilot-web': 'bing_copilot_search',
      'gemini-web': 'gemini_prompt',
      'perplexity-web': 'pplx_prompt',
      'grok-web': 'grok_prompt',
      'claude-web': 'ca_send_message',
      'deepseek-web': 'deepseek_prompt',
      'meta-ai-web': 'meta_prompt',
      'copilot-app': 'copilot_substrate_prompt',
      'naver-web': 'naver_prompt',
      'wenxin-web': 'wenxin_prompt',
      'chatgpt-ads': 'chatgpt',
    });
    expect(buildTaskBody('q', 'chatgpt-ads', 'US').params.ads).toBe(true);
    expect(buildTaskBody('q', 'chatgpt-web', 'US').params.ads).toBeUndefined();
  });

  it('sends Wenxin no country, and a webhook URL when given', () => {
    expect(buildTaskBody('q', 'wenxin-web', 'CN').params).toEqual({ prompt: 'q' });
    expect(buildTaskBody('q', 'gemini-web', 'US', { webhookUrl: 'https://x/cb' }).webhook_url).toBe(
      'https://x/cb',
    );
  });

  it('refuses a platform it has no action for', () => {
    expect(() => buildTaskBody('q', 'nope-web', 'US')).toThrow('Unknown scraper: nope-web');
  });
});

describe('submitPromptTask', () => {
  it('posts the task with the key and returns the job id', async () => {
    fetchMock.mockResolvedValueOnce(reply(202, { status: 'processing', job_id: 'job-1' }));
    expect(
      await submitPromptTask({
        promptText: 'q',
        scraperId: 'grok-web',
        region: 'US',
        legacy: true,
      }),
    ).toEqual({ taskId: 'job-1', scraperId: 'grok-web', legacy: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anakin.io/v1/wire/task');
    expect(init.headers['X-API-Key']).toBe('test-key');
    expect(JSON.parse(init.body)).toEqual({
      action_id: 'grok_prompt',
      params: { prompt: 'q', country: 'us' },
      use_account_pool: true,
    });
  });

  it('waits and tries again on a rate limit, which made no job', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(reply(429, { error: 'rate_limit_exceeded' }))
      .mockResolvedValueOnce(reply(202, { job_id: 'job-2' }));
    const done = submitPromptTask({ promptText: 'q', scraperId: 'chatgpt-web', region: 'US' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await done).taskId).toBe('job-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a refusal with its status and code (no credits)', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(402, {
        status: 'error',
        error: { code: 'INSUFFICIENT_CREDITS', message: 'You need 2 credits.', balance: 0 },
      }),
    );
    await expect(
      submitPromptTask({ promptText: 'q', scraperId: 'chatgpt-web', region: 'US' }),
    ).rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS' });
  });

  it('needs ANAKIN_API_KEY', async () => {
    vi.stubEnv('ANAKIN_API_KEY', '');
    await expect(
      submitPromptTask({ promptText: 'q', scraperId: 'chatgpt-web', region: 'US' }),
    ).rejects.toThrow('ANAKIN_API_KEY must be configured');
  });
});

describe('pollScraperResult', () => {
  it('polls until the job is done, then parses its answer', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(reply(200, { status: 'processing', retry_after_ms: 2000 }))
      .mockResolvedValueOnce(
        reply(200, job({ answer_text_markdown: 'Acme leads.', citations: [] })),
      );
    const done = pollScraperResult('job-1', 'chatgpt-web', { pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await done).text).toBe('Acme leads.');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anakin.io/v1/wire/jobs/job-1');
  });

  it('marks a failed job as failed at Anakin', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, { status: 'failed', error: { code: 'EXECUTION_FAILED', message: 'boom' } }),
    );
    await expect(pollScraperResult('job-9', 'grok-web')).rejects.toMatchObject({
      taskFailed: true,
      message: 'Anakin task job-9 failed: boom',
    });
  });

  it('gives up after the wait', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(reply(200, { status: 'processing' }));
    const done = pollScraperResult('job-1', 'gemini-web', { maxWaitMs: 25_000 });
    const failed = expect(done).rejects.toThrow('timed out after 25s');
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
  });
});

describe('parseScraperResponse', () => {
  it('reads ChatGPT: markdown, cited sources in order, its searches', () => {
    const answer = parseScraperResponse(
      job({
        answer_text: 'Acme leads.',
        answer_text_markdown: '**Acme** leads.',
        model: 'gpt-5',
        citations: [
          { ref: 2, url: 'https://b.example', title: 'B', position: 2, cited: true },
          { ref: 1, url: 'https://a.example', title: 'A', position: 1, cited: true },
          { ref: 3, url: 'https://read.example', title: 'Read only', position: 3, cited: false },
        ],
        web_search_queries: ['best crm 2026', 'crm pricing;crm reviews'],
      }),
      'chatgpt-web',
    );
    expect(answer).toEqual({
      text: '**Acme** leads.',
      citations: [
        { url: 'https://a.example', title: 'A', startIndex: 0, endIndex: 50 },
        { url: 'https://b.example', title: 'B', startIndex: 100, endIndex: 150 },
      ],
      model: 'gpt-5',
      shopping_cards: [],
      search_queries: [
        { query: 'best crm 2026', source_platform: 'chatgpt-web' },
        { query: 'crm pricing', source_platform: 'chatgpt-web' },
        { query: 'crm reviews', source_platform: 'chatgpt-web' },
      ],
    });
  });

  it("keeps ChatGPT Shopping's product cards raw on the answer", () => {
    const shopping = [{ title: 'Kettle', price: '$40', url: 'https://acme.example/k' }];
    expect(
      parseScraperResponse(job({ answer_text: 'x', shopping }), 'chatgpt-shopping').shopping_cards,
    ).toEqual(shopping);
    expect(
      parseScraperResponse(job({ answer_text: 'x', shopping }), 'gemini-web').shopping_cards,
    ).toEqual([]);
  });

  it("reads AI Overviews' overview and sources, and no overview as no answer", () => {
    const answer = parseScraperResponse(
      job({
        overview_text: 'Acme leads.',
        overview_markdown: 'Acme **leads**.',
        sources: [{ url: 'https://a.example', title: 'A', domain: 'a.example' }],
      }),
      'google-aio',
    );
    expect(answer).toMatchObject({
      text: 'Acme **leads**.',
      citations: [{ url: 'https://a.example', title: 'A' }],
      model: 'google-aio',
    });
    expect(() => parseScraperResponse(job({ overview_text: null }), 'google-aio')).toThrow(
      'Google did not return an AI Overview for this query',
    );
  });

  it("reads Perplexity's plain answer and Bing AI Mode as copilot-web", () => {
    expect(
      parseScraperResponse(
        job({
          query: 'q',
          answer_text: 'Acme [1].',
          citations: [{ title: 'A', url: 'https://a.example', position: 1, snippet: '' }],
        }),
        'perplexity-web',
      ),
    ).toMatchObject({ text: 'Acme [1].', citations: [{ url: 'https://a.example' }] });
    expect(parseScraperResponse(job({ answer_text: 'x' }), 'copilot-web').model).toBe(
      'copilot-web',
    );
  });

  it('takes references when a platform gives no citations, and a lone search', () => {
    const answer = parseScraperResponse(
      job({
        answer_text: 'x',
        citations: [],
        references: [{ url: 'https://r.example', title: 'R', domain: 'r.example' }],
        web_search_query: 'best crm',
      }),
      'gemini-web',
    );
    expect(answer.citations).toEqual([
      { url: 'https://r.example', title: 'R', startIndex: 0, endIndex: 50 },
    ]);
    expect(answer.search_queries).toEqual([{ query: 'best crm', source_platform: 'gemini-web' }]);
  });

  it("reads Claude's answer from `text`, a level deeper than the other platforms", () => {
    const claude = {
      status: 'completed',
      credits_used: 10,
      data: {
        status: 'ok',
        data: {
          text: 'Acme leads.',
          model: 'claude-sonnet',
          citations: [{ title: 'A', url: 'https://a.example', start_index: 0, end_index: 4 }],
        },
        meta: { action_id: 'ca_send_message' },
      },
    };
    expect(parseScraperResponse(claude, 'claude-web')).toMatchObject({
      text: 'Acme leads.',
      citations: [{ url: 'https://a.example', title: 'A' }],
      model: 'claude-sonnet',
    });
  });

  it("reads the Copilot app's titled search results and its searches", () => {
    const answer = parseScraperResponse(
      job({
        answer_text: 'Acme leads.',
        sources: ['https://a.example'],
        search_results: [{ url: 'https://a.example', title: 'A', snippet: 's', type: 'web' }],
        search_queries: ['best crm'],
      }),
      'copilot-app',
    );
    expect(answer.citations).toEqual([
      { url: 'https://a.example', title: 'A', startIndex: 0, endIndex: 50 },
    ]);
    expect(answer.search_queries).toEqual([{ query: 'best crm', source_platform: 'copilot-app' }]);
  });

  it('treats Naver without an AI Briefing as no answer', () => {
    expect(() =>
      parseScraperResponse(job({ aib_available: false, answer_text: '' }), 'naver-web'),
    ).toThrow('Naver did not return an AI Briefing');
  });

  it('finds the answer at data.data, at data, or in a webhook result', () => {
    const payload = { answer_text: 'here' };
    expect(answerPayload(job(payload))).toBe(payload);
    expect(answerPayload({ status: 'completed', data: payload })).toBe(payload);
    expect(answerPayload({ result: job(payload) })).toBe(payload);
  });
});

describe('rateLimiter', () => {
  it('lets `limit` calls a minute through and holds the next until a slot frees', async () => {
    let now = 0;
    const waits = [];
    const turn = rateLimiter(() => 2, {
      now: () => now,
      wait: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });
    await turn();
    now = 10_000;
    await turn();
    await turn();
    expect(waits).toEqual([50_000]);
    expect(now).toBe(60_000);
  });
});
