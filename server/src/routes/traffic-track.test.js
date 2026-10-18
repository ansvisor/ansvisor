import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /track/:trackingCode (AT-003): each pageview is stored with the visit
 * it belongs to, and a failed visit lookup still stores the pageview.
 */

const inserted = [];
const findVisitOf = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { id: 'b1' }, error: null }) }),
      }),
      insert: async (row) => {
        inserted.push({ table, row });
        return { error: null };
      },
    }),
  },
}));
vi.mock('../middleware/rate-limiter.js', () => ({ trafficLimiter: (req, res, next) => next() }));
vi.mock('../lib/logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { default: logger, logger };
});
vi.mock('../lib/traffic-visits.js', () => ({ findVisitOf: (...args) => findVisitOf(...args) }));

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./traffic.js');
  const app = express();
  app.use(router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/track/abcdef123`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  inserted.length = 0;
  findVisitOf.mockReset();
});

const beacon = (body = {}) =>
  fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Forwarded-For': '203.0.113.7' },
    body: JSON.stringify({
      u: 'https://acme.example/menu',
      r: 'https://gemini.google.com/',
      s: 'gemini.google.com',
      a: 'Mozilla/5.0',
      ...body,
    }),
  });

describe('POST /track/:trackingCode', () => {
  it('stores a repeat pageview under the visit it continues', async () => {
    findVisitOf.mockResolvedValue('p1');
    const res = await beacon();
    expect(res.status).toBe(204);
    expect(findVisitOf).toHaveBeenCalledWith({
      brandId: 'b1',
      sourcePlatform: 'gemini.google.com',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
    expect(inserted[0].table).toBe('ai_traffic_logs');
    expect(inserted[0].row).toMatchObject({
      url: 'https://acme.example/menu',
      ip_address: '203.0.113.7',
      user_agent: 'Mozilla/5.0',
      visit_of: 'p1',
    });
  });

  it('stores a first pageview as a new visit', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon();
    expect(inserted[0].row.visit_of).toBeNull();
  });

  it('still stores the pageview, as a new visit, when the lookup fails', async () => {
    findVisitOf.mockRejectedValue(new Error('timeout'));
    const res = await beacon();
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].row.visit_of).toBeNull();
  });

  it('stores nothing for a beacon without a platform', async () => {
    const res = await beacon({ s: '' });
    expect(res.status).toBe(204);
    expect(findVisitOf).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });
});
