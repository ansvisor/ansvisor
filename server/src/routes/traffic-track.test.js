import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { AI_SOURCES_VERSION } from '../lib/ai-sources.js';

/**
 * POST /track/:trackingCode (AT-003): each pageview is stored with the visit
 * it belongs to, and a failed visit lookup still stores the pageview; with
 * the landing page's status, for Broken AI links (AT-012).
 */

const inserted = [];
const findVisitOf = vi.fn();
let insertError = null;

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { id: 'b1' }, error: null }) }),
      }),
      insert: async (row) => {
        inserted.push({ table, row });
        return { error: insertError };
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
  insertError = null;
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

  it("stores an older snippet's host under the AI source list's key (AT-004)", async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ s: 'chat.openai.com' });
    expect(findVisitOf).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePlatform: 'chatgpt.com' }),
    );
    expect(inserted[0].row.source_platform).toBe('chatgpt.com');
    // No list version from a snippet that predates it.
    expect(inserted[0].row.source_list_version).toBeNull();
  });

  it('stores the list version the snippet counted the visit with', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ v: AI_SOURCES_VERSION });
    expect(inserted[0].row.source_list_version).toBe(AI_SOURCES_VERSION);
  });

  it('ignores a version the list has never had', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ v: AI_SOURCES_VERSION + 1 });
    await beacon({ v: '2' });
    expect(inserted.map((i) => i.row.source_list_version)).toEqual([null, null]);
  });

  it('keeps a platform the list does not know as it was sent', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ s: 'some-new-assistant.example' });
    expect(inserted[0].row.source_platform).toBe('some-new-assistant.example');
  });

  it("stores the landing page's status, or whether its title said not found (AT-012)", async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ st: 404, nf: 0 });
    // Safari: no status, and the title said "not found".
    await beacon({ st: 0, nf: 1 });
    // A status wins over the title.
    await beacon({ st: 200, nf: 1 });
    // An older snippet sends neither.
    await beacon();
    expect(inserted.map((i) => [i.row.http_status, i.row.not_found_title])).toEqual([
      [404, false],
      [null, true],
      [200, false],
      [null, false],
    ]);
  });

  it('ignores a status no response could have', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ st: 99 });
    await beacon({ st: 600 });
    await beacon({ st: '404' });
    await beacon({ st: 404.5, nf: 'yes' });
    expect(inserted.map((i) => [i.row.http_status, i.row.not_found_title])).toEqual([
      [null, false],
      [null, false],
      [null, false],
      [null, false],
    ]);
  });

  it('logs a write the database refuses', async () => {
    const { default: logger } = await import('../lib/logger.js');
    findVisitOf.mockResolvedValue(null);
    insertError = { message: 'column "source_list_version" does not exist' };
    const res = await beacon();
    expect(res.status).toBe(204);
    expect(logger.error).toHaveBeenCalledWith({ err: insertError }, 'traffic track insert failed');
  });
});
