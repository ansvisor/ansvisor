import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * buildAuditContext runs the live AI-bot access test (SA-008) beside the
 * robots.txt and llms.txt reads, and a test that fails leaves the audit to
 * robots.txt alone.
 */

// What the test answers: a result, or an error it fails with.
let probeAnswer;
const probeCalls = [];
vi.mock('./bot-access.js', () => ({
  probeBotAccess: async (url) => {
    probeCalls.push(url);
    if (probeAnswer instanceof Error) throw probeAnswer;
    return probeAnswer;
  },
}));
let html = '<h1>Pricing</h1>';
vi.mock('./fetcher.js', () => ({
  fetchViaScrapeDo: async () => ({ ok: true, status: 200, html }),
  fetchText: async (url) => (url.endsWith('/robots.txt') ? 'User-agent: GPTBot\nAllow: /' : null),
}));

// The canonical tag's target, read with the free reader (AC plan P-11).
const readPage = vi.hoisted(() => vi.fn());
vi.mock('../safe-fetch.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchPage: (...args) => readPage(...args),
}));

const { buildAuditContext } = await import('./context.js');
const { aiBotAccess, canonical } = await import('./signals/trust.js');

const tested = {
  tested: true,
  control: 200,
  bots: [{ key: 'perplexitybot', name: 'PerplexityBot', http: 403, live: 'blocked' }],
};

beforeEach(() => {
  probeCalls.length = 0;
  probeAnswer = null;
  html = '<h1>Pricing</h1>';
  readPage.mockReset();
});

describe('buildAuditContext', () => {
  it('asks the page itself as the AI bots and hands the answers to the bot check', async () => {
    probeAnswer = tested;
    const ctx = await buildAuditContext('acme.com/pricing');
    expect(probeCalls).toEqual(['https://acme.com/pricing']);
    expect(ctx.botAccess).toBe(tested);
    // Refused only in the live test: a warning, the real crawler may get in.
    expect(aiBotAccess.evaluate(ctx)).toMatchObject({
      status: 'warn',
      evidence: { wafBlockedBots: ['perplexitybot'] },
    });
  });

  it('reads where the canonical tag points, and keeps it as the check’s evidence, its score as before', async () => {
    html = '<link rel="canonical" href="/plans"><h1>Pricing</h1>';
    // The page ends where it was asked for; its tag's target asks not to be indexed.
    readPage.mockImplementation(async (url) =>
      url === 'https://acme.com/pricing'
        ? { url, status: 200, html: '<h1>Pricing</h1>' }
        : {
            url: 'https://acme.com/plans',
            status: 200,
            html: '<meta name="robots" content="noindex">',
          },
    );
    const ctx = await buildAuditContext('https://acme.com/pricing');
    expect(readPage).toHaveBeenCalledWith('https://acme.com/plans', expect.any(Object));
    expect(ctx.canonicalTarget).toEqual({ state: 'noindex', target: 'https://acme.com/plans' });
    expect(canonical.evaluate(ctx)).toEqual({
      status: 'pass',
      score: 1,
      evidence: {
        canonical: '/plans',
        target: { state: 'noindex', target: 'https://acme.com/plans' },
      },
    });

    // Its own address: nothing read.
    readPage.mockClear();
    html = '<link rel="canonical" href="https://acme.com/pricing/">';
    expect((await buildAuditContext('https://acme.com/pricing')).canonicalTarget).toMatchObject({
      state: 'self',
    });
    expect(readPage).not.toHaveBeenCalled();
  });

  it('leaves the check to robots.txt when the test fails', async () => {
    probeAnswer = new Error('boom');
    const ctx = await buildAuditContext('https://acme.com/pricing');
    expect(ctx.botAccess).toBeNull();
    expect(aiBotAccess.evaluate(ctx)).toMatchObject({ status: 'pass' });
    expect(aiBotAccess.evaluate(ctx).evidence).not.toHaveProperty('liveTest');
  });
});
