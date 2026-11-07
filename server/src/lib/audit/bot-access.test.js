import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BOT_ACCESS,
  LIVE_BOT_KEYS,
  botUserAgent,
  liveResult,
  probeBotAccess,
} from './bot-access.js';
import { fetchPage, publicOnlyLookup, USER_AGENT } from '../safe-fetch.js';

/**
 * The live AI-bot access test (SA-008): the page asked for as AnsvisorBot,
 * then once as each AI bot, one after another, within a time budget. A 4xx to
 * a bot while AnsvisorBot was let in is a CDN or firewall block.
 */

describe('liveResult', () => {
  it('reads a 4xx as a block, but not a timeout or a request to slow down', () => {
    expect(liveResult({ http: 200, answer: 'ok' })).toBe('ok');
    for (const http of [401, 403, 404, 406, 451]) {
      expect(liveResult({ http, answer: 'refused' }), http).toBe('blocked');
    }
    expect(liveResult({ http: 408, answer: 'refused' })).toBe('error');
    expect(liveResult({ http: 429, answer: 'refused' })).toBe('error');
    expect(liveResult({ http: 503, answer: 'refused' })).toBe('error');
    expect(liveResult({ http: null, answer: 'no_answer' })).toBe('no_answer');
  });
});

describe('probeBotAccess', () => {
  let server;
  let port;
  let requests;
  /** The status the site answers each user agent with; AnsvisorBot's under 'control'. */
  let answers;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const ua = req.headers['user-agent'] ?? '';
      requests.push({ path: req.url, ua });
      const bot = LIVE_BOT_KEYS.find((k) => ua.toLowerCase().includes(`${k}/`));
      const status = answers[bot ?? 'control'] ?? 200;
      if (status === 'hang') return; // never answers
      res.writeHead(status, { 'content-type': 'text/html' });
      res.end('<h1>Pricing</h1>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = String(server.address().port);
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => {
    requests = [];
    answers = {};
  });

  // site.test is the local server, read through the real safe-fetch.
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options.all;
    if (hostname !== 'site.test') return publicOnlyLookup(hostname, options, callback);
    return all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4);
  };
  const fetchImpl = (url, opts) => fetchPage(url, { ...opts, lookup, ports: ['', port] });
  const probe = (deps = {}) =>
    probeBotAccess(`http://site.test:${port}/pricing`, { fetchImpl, ...deps });

  it('asks as AnsvisorBot, then once as each bot in the spec’s order, one at a time', async () => {
    const result = await probe();
    expect(requests.map((r) => r.path)).toEqual(Array(6).fill('/pricing'));
    expect(requests[0].ua).toBe(USER_AGENT);
    expect(requests.slice(1).map((r) => r.ua)).toEqual(
      ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot'].map(botUserAgent),
    );
    expect(result).toEqual({
      tested: true,
      control: 200,
      bots: [
        { key: 'gptbot', name: 'GPTBot', http: 200, live: 'ok' },
        { key: 'oai-searchbot', name: 'OAI-SearchBot', http: 200, live: 'ok' },
        { key: 'chatgpt-user', name: 'ChatGPT-User', http: 200, live: 'ok' },
        { key: 'perplexitybot', name: 'PerplexityBot', http: 200, live: 'ok' },
        { key: 'claudebot', name: 'ClaudeBot', http: 200, live: 'ok' },
      ],
    });
  });

  it('names a bot the site refuses while it lets AnsvisorBot in', async () => {
    answers = { perplexitybot: 403, gptbot: 429 };
    const { bots } = await probe();
    expect(bots.find((b) => b.key === 'perplexitybot')).toMatchObject({
      http: 403,
      live: 'blocked',
    });
    expect(bots.find((b) => b.key === 'gptbot')).toMatchObject({ http: 429, live: 'error' });
  });

  it('asks no bot when AnsvisorBot itself is refused, and concludes nothing', async () => {
    answers = { control: 403 };
    const result = await probe();
    expect(requests).toHaveLength(1);
    expect(result.tested).toBe(false);
    expect(result.control).toBe(403);
    expect(result.bots.every((b) => b.live === 'inconclusive' && b.http === null)).toBe(true);
  });

  it('stops at its time budget: a bot not reached is not tested', async () => {
    // The clock moves a whole budget once the control has answered.
    let t = 0;
    const now = () => t;
    const result = await probeBotAccess(`http://site.test:${port}/pricing`, {
      fetchImpl: async (url, opts) => {
        const res = await fetchImpl(url, opts);
        t += BOT_ACCESS.budgetMs;
        return res;
      },
      now,
    });
    expect(requests).toHaveLength(1);
    expect(result.bots.every((b) => b.live === 'not_tested')).toBe(true);
  });

  it('gives a bot that never answers no_answer, within one request’s time limit', async () => {
    answers = { claudebot: 'hang' };
    const started = Date.now();
    const { bots } = await probe({
      fetchImpl: (url, opts) =>
        fetchImpl(url, { ...opts, timeoutMs: Math.min(opts.timeoutMs, 300) }),
    });
    expect(bots.find((b) => b.key === 'claudebot')).toMatchObject({
      http: null,
      live: 'no_answer',
    });
    expect(Date.now() - started).toBeLessThan(BOT_ACCESS.timeoutMs);
  });

  it('tests nothing on an address safe-fetch won’t read', async () => {
    await expect(probeBotAccess('http://127.0.0.1/admin')).resolves.toBeNull();
    await expect(probeBotAccess('http://localhost:8080/')).resolves.toBeNull();
  });
});
