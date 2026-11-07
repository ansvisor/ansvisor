import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import express from 'express';

/**
 * POST /api/bots/upload/:brandId (#2170, 00492): an access log a person
 * uploads for one brand, read once as a log sender's file, through the
 * brand's own upload connection, made at its first upload. Admins and
 * managers, on plans with the bot report.
 */

let role;
let cap;
let connections;
// Another upload made the brand's connection a moment before this one's insert.
let clash;
// What ingestLogFile answers, past the default.
let ingestAnswer;
const ingested = [];
const readHashes = new Set();
const assertBrandAccess = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (name) => {
      const filters = {};
      let insert = null;
      const answer = () => {
        if (name === 'profiles') return { data: { role }, error: null };
        if (name === 'brand_domains') {
          return { data: [{ domain: 'www.acme.example' }], error: null };
        }
        if (insert && clash) {
          connections.push({ id: 'c-other', ...insert, created_by: 'u2' });
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        if (insert) {
          const row = { id: `c${connections.length + 1}`, ...insert };
          connections.push(row);
          return { data: row, error: null };
        }
        const rows = connections.filter((c) =>
          Object.entries(filters).every(([col, value]) => c[col] === value),
        );
        return { data: rows[0] ?? null, error: null };
      };
      const chain = {
        select: () => chain,
        insert: (row) => ((insert = row), chain),
        eq: (col, value) => ((filters[col] = value), chain),
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () => answer(),
        maybeSingle: async () => answer(),
        then: (resolve) => resolve(answer()),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => assertBrandAccess(...args),
}));
vi.mock('../lib/plan-guard.js', () => ({
  PlanLimitError: class PlanLimitError extends Error {
    constructor(message, statusCode = 403) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  getBotEventCap: async () => cap,
  getBotCaps: async () => ({ cap, rawCap: 20_000_000 }),
}));
vi.mock('../lib/bot-ingest.js', async (importOriginal) => ({
  ...(await importOriginal()),
  logFileRead: async (_connection, hash) => readHashes.has(hash),
  ingestLogFile: async (connection, hash, parsed) => {
    readHashes.add(hash);
    ingested.push({ connection, hash, parsed });
    return ingestAnswer ?? { received: parsed.requests.length, verified: 1, stored: 1 };
  },
}));

const { default: router } = await import('./bots.js');
const { MAX_LOG_LINES } = await import('../lib/bot-log-formats.js');

const combined = readFileSync(
  new URL('../lib/__fixtures__/bot-logs/combined-log.txt', import.meta.url),
);

let server;
let base;
beforeEach(async () => {
  role = 'manager';
  cap = 2_000_000;
  connections = [];
  clash = false;
  ingestAnswer = null;
  ingested.length = 0;
  readHashes.clear();
  assertBrandAccess.mockReset().mockResolvedValue({ brand: { id: 'b1', organization_id: 'o1' } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/bots', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/bots/upload/b1`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const upload = (body) =>
  fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });

describe('uploading an access log', () => {
  it('reads it for the brand through its upload connection, made at the first upload', async () => {
    const res = await upload(combined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 3, verified: 1, stored: 1, records: 4 });
    expect(connections).toEqual([
      expect.objectContaining({ brand_id: 'b1', kind: 'log_upload', created_by: 'u1' }),
    ]);
    // Its secret is never shown, nor kept in the clear.
    expect(connections[0].secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ingested[0].connection).toEqual({
      id: 'c1',
      brandId: 'b1',
      kind: 'log_upload',
      organizationId: 'o1',
      domains: ['www.acme.example'],
    });

    // Another file: the same connection.
    await upload(Buffer.from(`${combined.toString()}\n`));
    expect(connections).toHaveLength(1);
    expect(ingested).toHaveLength(2);
  });

  it('reads a file uploaded again once', async () => {
    await upload(combined);
    const again = await upload(combined);
    expect(await again.json()).toEqual({ received: 0, verified: 0, stored: 0, duplicate: true });
    expect(ingested).toHaveLength(1);
  });

  it('refuses an analyst, a plan without the bot report, and an empty file', async () => {
    role = 'analyst';
    let res = await upload(combined);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      'Only admins and managers can manage AI bot connections.',
    );
    role = 'admin';
    cap = 0;
    res = await upload(combined);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('plan_limit');
    cap = 2_000_000;
    res = await upload(Buffer.alloc(0));
    expect(res.status).toBe(400);
    expect(ingested).toEqual([]);
    expect(connections).toEqual([]);
  });
});

describe('what an upload refuses or reads', () => {
  it('refuses a file that is no access log, and counts nothing', async () => {
    const res = await upload(Buffer.from('%PDF-1.7\nnot a log\n'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unreadable_file' });
    expect(ingested).toEqual([]);
  });

  it('refuses a file past the lines it reads with 413', async () => {
    const line = combined.toString().split('\n')[0];
    const res = await upload(Buffer.from(`${line}\n`.repeat(MAX_LOG_LINES + 1)));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('too_large');
    expect(ingested).toEqual([]);
  });

  it("says when the month's log records are used up: counted, not read", async () => {
    ingestAnswer = { received: 4, verified: 0, stored: 0, rawCapped: true };
    const res = await upload(combined);
    expect(await res.json()).toEqual({
      received: 4,
      verified: 0,
      stored: 0,
      rawCapped: true,
      records: 4,
    });
  });

  it('uses the connection another upload made a moment before', async () => {
    clash = true;
    const res = await upload(combined);
    expect(res.status).toBe(200);
    expect(connections).toHaveLength(1);
    expect(ingested[0].connection.id).toBe('c-other');
  });

  it('counts uploads in a bucket of their own', async () => {
    const res = await upload(combined);
    expect(res.headers.get('ratelimit-limit')).toBe('20');
  });
});
