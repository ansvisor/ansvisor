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
vi.mock('./fetcher.js', () => ({
  fetchViaScrapeDo: async () => ({ ok: true, status: 200, html: '<h1>Pricing</h1>' }),
  fetchText: async (url) => (url.endsWith('/robots.txt') ? 'User-agent: GPTBot\nAllow: /' : null),
}));

const { buildAuditContext } = await import('./context.js');
const { aiBotAccess } = await import('./signals/trust.js');

const tested = {
  tested: true,
  control: 200,
  bots: [{ key: 'perplexitybot', name: 'PerplexityBot', http: 403, live: 'blocked' }],
};

beforeEach(() => {
  probeCalls.length = 0;
  probeAnswer = null;
});

describe('buildAuditContext', () => {
  it('asks the page itself as the AI bots and hands the answers to the bot check', async () => {
    probeAnswer = tested;
    const ctx = await buildAuditContext('acme.com/pricing');
    expect(probeCalls).toEqual(['https://acme.com/pricing']);
    expect(ctx.botAccess).toBe(tested);
    expect(aiBotAccess.evaluate(ctx)).toMatchObject({
      status: 'fail',
      evidence: { wafBlockedBots: ['perplexitybot'] },
    });
  });

  it('leaves the check to robots.txt when the test fails', async () => {
    probeAnswer = new Error('boom');
    const ctx = await buildAuditContext('https://acme.com/pricing');
    expect(ctx.botAccess).toBeNull();
    expect(aiBotAccess.evaluate(ctx)).toMatchObject({ status: 'pass' });
    expect(aiBotAccess.evaluate(ctx).evidence).not.toHaveProperty('liveTest');
  });
});
