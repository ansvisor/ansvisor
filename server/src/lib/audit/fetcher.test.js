import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchText,
  fetchViaFirecrawl,
  fetchViaScrapeDo,
  proxyFetcherConfigured,
} from './fetcher.js';

/** Which proxy fetches Site Audit pages, and what Firecrawl's answers turn into. */

const FIRECRAWL_SCRAPE = 'https://api.firecrawl.dev/v2/scrape';
const fetchMock = vi.fn();

/** A Firecrawl scrape response: the target's status and HTML inside a 200. */
const firecrawl = (rawHtml, statusCode = 200, contentType = 'text/html; charset=utf-8') => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: { rawHtml, metadata: { statusCode, contentType } } }),
});
/** Firecrawl itself answering with an error. */
const firecrawlError = (status, error = 'failed') => ({
  ok: false,
  status,
  json: async () => ({ success: false, error }),
});
const scrapeDo = (html, status = 200) => ({
  ok: status < 400,
  status,
  text: async () => html,
  headers: { get: () => 'text/html' },
});

// Each test sets the keys it needs, whatever the machine running it holds.
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('AUDIT_FETCHER', '');
  vi.stubEnv('FIRECRAWL_API_KEY', '');
  vi.stubEnv('SCRAPEDO_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('fetchViaFirecrawl', () => {
  it('returns the raw HTML in the Scrape.do shape', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockResolvedValueOnce(firecrawl('<html><title>Acme</title></html>'));

    expect(await fetchViaFirecrawl('https://acme.com/')).toEqual({
      ok: true,
      status: 200,
      html: '<html><title>Acme</title></html>',
      contentType: 'text/html; charset=utf-8',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(FIRECRAWL_SCRAPE);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer fc_test');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toMatchObject({
      url: 'https://acme.com/',
      formats: ['rawHtml'],
      maxAge: 0,
    });
  });

  it("reports the target's status and does not retry a 4xx", async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockResolvedValue(firecrawl('<html>Not found</html>', 404));

    const res = await fetchViaFirecrawl('https://acme.com/gone');

    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry when Firecrawl refuses the request', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockResolvedValue(firecrawlError(402, 'Insufficient credits'));

    const res = await fetchViaFirecrawl('https://acme.com/');

    expect(res).toEqual({
      ok: false,
      status: 0,
      html: '',
      contentType: null,
      error: 'Insufficient credits',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not take a failed scrape for the page's answer", async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, error: 'DNS resolution failed' }),
    });

    expect(await fetchViaFirecrawl('https://acme.invalid/')).toEqual({
      ok: false,
      status: 0,
      html: '',
      contentType: null,
      error: 'DNS resolution failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a response that is not a scrape result', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    expect(await fetchViaFirecrawl('https://acme.com/')).toMatchObject({
      ok: false,
      status: 0,
      error: 'Firecrawl HTTP 200',
    });
  });

  it("retries the target's own 5xx", async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock
      .mockResolvedValueOnce(firecrawl('<html>busy</html>', 503))
      .mockResolvedValueOnce(firecrawl('<html>ok</html>'));

    expect(await fetchViaFirecrawl('https://acme.com/')).toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx, and only as often as asked', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock
      .mockResolvedValueOnce(firecrawlError(502))
      .mockResolvedValueOnce(firecrawl('<html>ok</html>'));
    expect((await fetchViaFirecrawl('https://acme.com/')).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(firecrawlError(500));
    expect(await fetchViaFirecrawl('https://acme.com/', { retries: 0 })).toMatchObject({
      ok: false,
      status: 0,
      error: 'failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns away a page nested too deep to parse', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockResolvedValueOnce(firecrawl('<div>'.repeat(600)));

    expect(await fetchViaFirecrawl('https://acme.com/')).toMatchObject({
      ok: false,
      html: '',
      error: 'too_deep',
    });
  });

  it('reports a network failure without throwing', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    expect(await fetchViaFirecrawl('https://acme.com/', { retries: 0 })).toEqual({
      ok: false,
      status: 0,
      html: '',
      contentType: null,
      error: 'socket hang up',
    });
  });
});

describe('AUDIT_FETCHER', () => {
  it('keeps Scrape.do by default, even with a Firecrawl key set', async () => {
    vi.stubEnv('SCRAPEDO_API_KEY', 'sd_test');
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockResolvedValueOnce(scrapeDo('<html>via scrape.do</html>'));

    const res = await fetchViaScrapeDo('https://acme.com/');

    expect(res.html).toBe('<html>via scrape.do</html>');
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.scrape.do');
  });

  it('fetches through Firecrawl when AUDIT_FETCHER=firecrawl and its key is set', async () => {
    vi.stubEnv('AUDIT_FETCHER', 'firecrawl');
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock.mockResolvedValueOnce(firecrawl('<html>via firecrawl</html>'));

    const res = await fetchViaScrapeDo('https://acme.com/', { render: false, retries: 0 });

    expect(res).toMatchObject({ ok: true, html: '<html>via firecrawl</html>' });
    expect(fetchMock.mock.calls[0][0]).toBe(FIRECRAWL_SCRAPE);
  });

  it('stays on Scrape.do when AUDIT_FETCHER=firecrawl but the Firecrawl key is unset', async () => {
    vi.stubEnv('AUDIT_FETCHER', 'firecrawl');
    vi.stubEnv('SCRAPEDO_API_KEY', 'sd_test');
    fetchMock.mockResolvedValueOnce(scrapeDo('<html>via scrape.do</html>'));

    await fetchViaScrapeDo('https://acme.com/');

    expect(String(fetchMock.mock.calls[0][0])).toContain('api.scrape.do');
  });

  it('says whether a proxy fetcher is configured', () => {
    expect(proxyFetcherConfigured()).toBe(false);
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    expect(proxyFetcherConfigured()).toBe(false);
    vi.stubEnv('AUDIT_FETCHER', 'firecrawl');
    expect(proxyFetcherConfigured()).toBe(true);
    vi.stubEnv('AUDIT_FETCHER', '');
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    vi.stubEnv('SCRAPEDO_API_KEY', 'sd_test');
    expect(proxyFetcherConfigured()).toBe(true);
  });

  it('retries a blocked robots.txt through Firecrawl', async () => {
    vi.stubEnv('AUDIT_FETCHER', 'firecrawl');
    vi.stubEnv('FIRECRAWL_API_KEY', 'fc_test');
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => '' })
      .mockResolvedValueOnce(firecrawl('User-agent: *\nAllow: /', 200, 'text/plain'));

    expect(await fetchText('https://acme.com/robots.txt')).toBe('User-agent: *\nAllow: /');
    expect(fetchMock.mock.calls[1][0]).toBe(FIRECRAWL_SCRAPE);
  });
});
