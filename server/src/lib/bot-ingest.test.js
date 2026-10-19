import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AI-bot requests from a brand's edge (AT-010, spec §6): each verified (user
 * agent + published ranges), then written within the month's cap; the
 * connection secret is stored only as its hash.
 */

const rpc = vi.fn();
let connectionRow = null;
const selects = [];
vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: (...args) => rpc(...args),
    from: () => {
      const chain = {
        select: () => chain,
        eq: (col, val) => {
          selects.push([col, val]);
          return chain;
        },
        maybeSingle: async () => ({ data: connectionRow, error: null }),
      };
      return chain;
    },
  },
}));
const getBotEventCap = vi.fn();
const getBotRawCap = vi.fn();
vi.mock('./plan-guard.js', () => ({
  getBotEventCap: (...a) => getBotEventCap(...a),
  getBotRawCap: (...a) => getBotRawCap(...a),
}));
const warn = vi.fn();
vi.mock('./logger.js', () => ({ logger: { warn: (...a) => warn(...a) } }));

const { clearRangeCache } = await import('./ai-bots.js');
const {
  MAX_BATCH,
  WRITE_CHUNK,
  connectionForSecret,
  countRawRecords,
  hashSecret,
  ingestBotRequests,
  newConnectionSecret,
  publicIngestEndpoint,
} = await import('./bot-ingest.js');

const NOW = Date.parse('2026-10-19T10:00:00.000Z');
const fetchImpl = vi.fn(async (url) => ({
  ok: true,
  json: async () => ({
    prefixes: [{ ipv4Prefix: url.includes('openai') ? '20.171.206.0/24' : '160.79.104.0/23' }],
  }),
}));
const connection = { id: 'c1', brandId: 'b1', kind: 'cloudflare_worker', organizationId: 'o1' };
const gpt = (over = {}) => ({
  userAgent: 'Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot',
  ip: '20.171.206.9',
  url: 'https://acme.example/menu?x=1',
  status: 200,
  at: '2026-10-19T09:58:00.000Z',
  country: 'us',
  ...over,
});

beforeEach(() => {
  clearRangeCache();
  rpc
    .mockReset()
    .mockResolvedValue({ data: { stored: 2, used: 2, crossed80: false }, error: null });
  getBotEventCap.mockReset().mockResolvedValue(2_000_000);
  getBotRawCap.mockReset().mockResolvedValue(20_000_000);
  warn.mockReset();
  selects.length = 0;
});

describe('ingestBotRequests', () => {
  it('verifies each request and writes the bots within the cap', async () => {
    const result = await ingestBotRequests(
      connection,
      [
        gpt(),
        gpt({
          userAgent: 'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
          ip: '160.79.104.10',
          url: '/gifts',
        }),
        gpt({ ip: '8.8.8.8' }),
        gpt({ userAgent: 'Mozilla/5.0 Chrome/129' }),
        gpt({ at: '2026-10-01T00:00:00Z' }),
        { userAgent: 'GPTBot' },
      ],
      { fetchImpl, now: NOW },
    );
    expect(result).toEqual({
      received: 6,
      verified: 2,
      stored: 2,
      skipped: { invalid: 2, unknown_agent: 1, unverified_ip: 1, no_ranges: 0 },
    });
    expect(getBotEventCap).toHaveBeenCalledWith('o1');
    expect(rpc).toHaveBeenCalledWith('ai_bot_ingest', {
      p_connection_id: 'c1',
      p_cap: 2_000_000,
      p_events: [
        {
          bot: 'gptbot',
          bot_type: 'training',
          page: 'https://acme.example/menu?x=1',
          status: 200,
          country: 'US',
          at: '2026-10-19T09:58:00.000Z',
        },
        {
          bot: 'claudebot',
          bot_type: 'training',
          page: '/gifts',
          status: 200,
          country: 'US',
          at: '2026-10-19T09:58:00.000Z',
        },
      ],
    });
  });

  it('writes nothing when no request verifies, and keeps a batch to its limit', async () => {
    const none = await ingestBotRequests(connection, [gpt({ ip: '1.1.1.1' })], {
      fetchImpl,
      now: NOW,
    });
    expect(none.stored).toBe(0);
    expect(rpc).not.toHaveBeenCalled();

    const many = await ingestBotRequests(
      connection,
      Array.from({ length: MAX_BATCH + 50 }, () => gpt({ ip: '9.9.9.9' })),
      { fetchImpl, now: NOW },
    );
    expect(many.received).toBe(MAX_BATCH);
  });

  it('reads a whole log file and writes its verified events in chunks', async () => {
    rpc.mockResolvedValue({ data: { stored: 1, used: 1, crossed80: false }, error: null });
    const result = await ingestBotRequests(
      connection,
      Array.from({ length: WRITE_CHUNK + 20 }, () => gpt()),
      { fetchImpl, now: NOW, limit: Infinity },
    );
    expect(result.verified).toBe(WRITE_CHUNK + 20);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_events).toHaveLength(WRITE_CHUNK);
    expect(rpc.mock.calls[1][1].p_events).toHaveLength(20);
    expect(result.stored).toBe(2);
  });

  it('writes nothing on a plan without the report', async () => {
    getBotEventCap.mockResolvedValue(0);
    const result = await ingestBotRequests(connection, [gpt()], { fetchImpl, now: NOW });
    expect(result).toMatchObject({ verified: 1, stored: 0, locked: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('raises the internal alert when a batch crosses 80% of the cap', async () => {
    rpc.mockResolvedValue({ data: { stored: 1, used: 1_600_000, crossed80: true }, error: null });
    await ingestBotRequests(connection, [gpt()], { fetchImpl, now: NOW });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'o1', used: 1_600_000, cap: 2_000_000 }),
      '[ai-bots] 80% of the monthly bot event cap reached',
    );
  });

  it('throws when the write fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(ingestBotRequests(connection, [gpt()], { fetchImpl, now: NOW })).rejects.toThrow(
      'boom',
    );
  });
});

describe('connection secrets', () => {
  it('makes a fresh secret each time and finds a connection by its hash only', async () => {
    const a = newConnectionSecret();
    expect(a).toMatch(/^abot_[A-Za-z0-9_-]{43}$/);
    expect(newConnectionSecret()).not.toBe(a);

    connectionRow = {
      id: 'c1',
      brand_id: 'b1',
      kind: 'cloudflare_worker',
      revoked_at: null,
      brands: { organization_id: 'o1' },
    };
    expect(await connectionForSecret(a)).toEqual(connection);
    expect(selects).toContainEqual(['secret_hash', hashSecret(a)]);

    connectionRow = { ...connectionRow, revoked_at: '2026-10-18T00:00:00Z' };
    expect(await connectionForSecret(a)).toBeNull();
    expect(await connectionForSecret('not-a-secret')).toBeNull();
  });
});

describe('countRawRecords', () => {
  it("counts a log sender's records against the plan's raw cap", async () => {
    rpc.mockResolvedValue({ data: { allowed: true, raw: 1200, cap: 20_000_000 }, error: null });
    expect(await countRawRecords(connection, 1200)).toEqual({
      allowed: true,
      raw: 1200,
      cap: 20_000_000,
    });
    expect(rpc).toHaveBeenCalledWith('ai_bot_count_raw', {
      p_connection_id: 'c1',
      p_count: 1200,
      p_cap: 20_000_000,
    });

    rpc.mockResolvedValue({
      data: { allowed: false, raw: 20_000_100, cap: 20_000_000 },
      error: null,
    });
    expect((await countRawRecords(connection, 100)).allowed).toBe(false);
  });

  it('reads nothing on a plan without the report', async () => {
    getBotRawCap.mockResolvedValue(0);
    expect(await countRawRecords(connection, 10)).toEqual({ allowed: false, locked: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('publicIngestEndpoint', () => {
  it("builds the endpoint from the API's public address, whatever its path", () => {
    expect(publicIngestEndpoint({ PUBLIC_SERVER_URL: 'https://api.ansvisor.com/' })).toBe(
      'https://api.ansvisor.com/bots/ingest',
    );
    expect(publicIngestEndpoint({ PUBLIC_SERVER_URL: 'https://api.example.com/v1' })).toBe(
      'https://api.example.com/bots/ingest',
    );
  });

  it('refuses no address, a plain-http one, and localhost in production', () => {
    expect(publicIngestEndpoint({})).toBeNull();
    expect(publicIngestEndpoint({ PUBLIC_SERVER_URL: 'not a url' })).toBeNull();
    expect(publicIngestEndpoint({ PUBLIC_SERVER_URL: 'http://api.example.com' })).toBeNull();
    expect(
      publicIngestEndpoint({ PUBLIC_SERVER_URL: 'http://localhost:80', NODE_ENV: 'production' }),
    ).toBeNull();
  });

  it('allows http on localhost while developing', () => {
    expect(
      publicIngestEndpoint({ PUBLIC_SERVER_URL: 'http://localhost:8082', NODE_ENV: 'development' }),
    ).toBe('http://localhost:8082/bots/ingest');
  });
});
