import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /cloro/callback once the brand's plan has ended (2026-10-27): the
 * answer is dropped on a fresh read only, and stored as usual when the plan
 * can't be read, so a paying brand's paid answer is never lost to a failed
 * read. Answered 200 at once either way.
 */

const PENDING = {
  task_id: 'task-1',
  scraper_id: 'chatgpt-web',
  prompt_id: 'prompt-1',
  brand_id: 'brand-1',
  region: 'US',
};

// What happened, in order: the tables read, the pending rows deleted, the
// answers handled.
const events = [];

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      events.push(['read', table]);
      const chain = {
        select: () => chain,
        eq: () => chain,
        delete: () => ({
          eq: async (column, value) => {
            events.push(['delete', table, value]);
            return { error: null };
          },
        }),
        maybeSingle: async () => ({ data: table === 'cloro_pending_tasks' ? PENDING : null }),
        single: async () => ({ data: { id: 'brand-1', name: 'Acme' } }),
        then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/cloro-scraper.js', () => ({
  parseScraperResponse: () => ({ text: 'Acme is good.', citations: [], model: 'gpt' }),
}));
const handleScraperResult = vi.fn();
vi.mock('../lib/cloro-result-handler.js', () => ({
  handleScraperResult: (...a) => handleScraperResult(...a),
}));
vi.mock('../lib/cloro-webhook-verify.js', () => ({ verifyCloroWebhook: () => ({ ok: true }) }));
const isBrandActive = vi.fn();
const isBrandActiveCached = vi.fn();
vi.mock('../lib/active-subscriptions.js', () => ({
  isBrandActive: (...a) => isBrandActive(...a),
  isBrandActiveCached: (...a) => isBrandActiveCached(...a),
}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let server;
let url;

beforeAll(async () => {
  vi.stubEnv('CLORO_WEBHOOK_SECRET', '');
  const { default: router } = await import('./cloro-callback.js');
  const app = express();
  app.use('/cloro/callback', express.raw({ type: 'application/json' }));
  app.use((req, _res, next) => {
    req.log = log;
    next();
  });
  app.use('/cloro/callback', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/cloro/callback`;
});

afterAll(() => {
  vi.unstubAllEnvs();
  return new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  events.length = 0;
  handleScraperResult.mockReset().mockImplementation(async () => {
    events.push(['handled']);
    return { inserted: true };
  });
  // On a plan unless a test says otherwise.
  isBrandActiveCached.mockReset().mockResolvedValue(true);
  isBrandActive.mockReset().mockResolvedValue(true);
  for (const fn of Object.values(log)) fn.mockClear();
});

const deliver = () =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: { id: 'task-1', status: 'COMPLETED' }, response: { ok: 1 } }),
  });

/** The callback answers first and works after: wait for the pending row to go. */
const settled = () =>
  vi.waitFor(() => expect(events.some(([kind]) => kind === 'delete')).toBe(true));

const deleted = () => events.filter(([kind]) => kind === 'delete');

describe('POST /cloro/callback once the plan has ended', () => {
  it('drops the answer on a fresh read, removing its pending row, and reads no more', async () => {
    isBrandActiveCached.mockResolvedValue(false);
    isBrandActive.mockResolvedValue(false);

    expect((await deliver()).status).toBe(200);
    await settled();

    expect(isBrandActive).toHaveBeenCalledWith('brand-1');
    expect(handleScraperResult).not.toHaveBeenCalled();
    expect(deleted()).toEqual([['delete', 'cloro_pending_tasks', 'task-1']]);
    // Not the brand, its domains or competitors: nothing to store them with.
    expect(events.map(([, table]) => table)).not.toContain('competitors');
  });

  it('stores it when a kept "inactive" is out of date: a plan was bought since', async () => {
    isBrandActiveCached.mockResolvedValue(false);
    isBrandActive.mockResolvedValue(true);

    await deliver();
    await settled();

    expect(handleScraperResult).toHaveBeenCalledTimes(1);
  });

  it('stores it on a kept "active", without a fresh read', async () => {
    await deliver();
    await settled();

    expect(handleScraperResult).toHaveBeenCalledTimes(1);
    expect(isBrandActive).not.toHaveBeenCalled();
  });

  it.each([
    ['the kept answer', () => isBrandActiveCached.mockRejectedValue(new Error('read: timeout'))],
    [
      'the fresh read',
      () => {
        isBrandActiveCached.mockResolvedValue(false);
        isBrandActive.mockRejectedValue(new Error('read: timeout'));
      },
    ],
  ])(
    'stores it as usual when %s fails: its pending row goes only once it is stored',
    async (_, failing) => {
      failing();

      await deliver();
      await settled();

      expect(handleScraperResult).toHaveBeenCalledTimes(1);
      const kinds = events.map(([kind]) => kind).filter((kind) => kind !== 'read');
      expect(kinds).toEqual(['handled', 'delete']);
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ brandId: 'brand-1' }),
        'cloro callback: plan check failed; stored as usual',
      );
    },
  );
});
