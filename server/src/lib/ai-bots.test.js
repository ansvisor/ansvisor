import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_BOTS,
  RANGES_TTL_MS,
  clearRangeCache,
  inPrefixes,
  matchBot,
  parseIp,
  parsePrefix,
  rangesFor,
  readRangeFile,
  verifyBotRequest,
} from './ai-bots.js';

/** AI bots (AT-010, spec §3.7): a user agent on the list and an IP in its operator's ranges. */

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

beforeEach(() => {
  clearRangeCache();
});

describe('matchBot', () => {
  it('reads each bot from its own token, never from a longer name', () => {
    const ua = (token) =>
      `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ${token}/1.2; +https://example.com/bot`;
    for (const bot of AI_BOTS) expect(matchBot(ua(bot.userAgent))?.key).toBe(bot.key);
    expect(matchBot('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')?.key).toBe(
      'claudebot',
    );
    expect(matchBot('gptbot/1.0')?.key).toBe('gptbot');
    expect(matchBot('Mozilla/5.0 (compatible; NotGPTBotX/1.0)')).toBeNull();
    expect(matchBot('Mozilla/5.0 Chrome/129')).toBeNull();
    expect(matchBot(undefined)).toBeNull();
  });

  it('has a type and a published range list for every bot', () => {
    for (const bot of AI_BOTS) {
      expect(['training', 'search', 'user']).toContain(bot.type);
      expect(bot.ranges).toMatch(/^https:\/\//);
    }
    expect(new Set(AI_BOTS.map((b) => b.key)).size).toBe(AI_BOTS.length);
  });
});

describe('addresses and prefixes', () => {
  it('reads IPv4, IPv6 and IPv4-mapped addresses, and refuses the rest', () => {
    expect(parseIp('20.171.206.7')).toEqual({ family: 4, value: 346803719n });
    expect(parseIp('2001:db8::1')?.family).toBe(6);
    expect(parseIp('::ffff:20.171.206.7')).toEqual(parseIp('20.171.206.7'));
    for (const bad of ['256.1.1.1', '1.2.3', 'abc', '1::2::3', '', null]) {
      expect(parseIp(bad)).toBeNull();
    }
  });

  it('tells an address inside a prefix from one outside', () => {
    const prefixes = readRangeFile({
      prefixes: [{ ipv4Prefix: '20.171.206.0/24' }, { ipv6Prefix: '2001:db8:10::/48' }, {}],
    });
    expect(prefixes).toHaveLength(2);
    expect(inPrefixes('20.171.206.255', prefixes)).toBe(true);
    expect(inPrefixes('20.171.207.1', prefixes)).toBe(false);
    expect(inPrefixes('2001:db8:10:ffff::1', prefixes)).toBe(true);
    expect(inPrefixes('2001:db8:11::1', prefixes)).toBe(false);
    expect(inPrefixes('not-an-ip', prefixes)).toBe(false);
    expect(parsePrefix('20.171.206.0/33')).toBeNull();
  });
});

describe('rangesFor', () => {
  it('reads a list once a day and keeps the last one when a refresh fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ prefixes: [{ ipv4Prefix: '1.2.3.0/24' }] }));
    const first = await rangesFor('https://x/a.json', { fetchImpl, now: 0 });
    await rangesFor('https://x/a.json', { fetchImpl, now: RANGES_TTL_MS - 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    fetchImpl.mockResolvedValue(json({}, false));
    const stale = await rangesFor('https://x/a.json', { fetchImpl, now: RANGES_TTL_MS + 1 });
    expect(stale).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('is null when a list was never read', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await rangesFor('https://x/b.json', { fetchImpl, now: 0 })).toBeNull();
  });
});

describe('verifyBotRequest', () => {
  const fetchImpl = vi.fn(async () => json({ prefixes: [{ ipv4Prefix: '20.171.206.0/24' }] }));

  it('counts a bot only from its operator ranges', async () => {
    const ua = 'Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot';
    expect(
      (await verifyBotRequest({ userAgent: ua, ip: '20.171.206.9' }, { fetchImpl })).bot.key,
    ).toBe('gptbot');
    expect(await verifyBotRequest({ userAgent: ua, ip: '8.8.8.8' }, { fetchImpl })).toEqual({
      reason: 'unverified_ip',
    });
    expect(
      await verifyBotRequest(
        { userAgent: 'Mozilla/5.0 Chrome/129', ip: '20.171.206.9' },
        { fetchImpl },
      ),
    ).toEqual({ reason: 'unknown_agent' });
  });
});
