import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const { mockFrom, state } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  state: { opportunities: [], configs: [] },
}));

vi.mock('../config/supabase.js', () => ({
  default: { from: mockFrom },
}));
vi.mock('../middleware/rate-limiter.js', () => ({
  publicLimiter: (_req, _res, next) => next(),
}));

const { default: router } = await import('./webhook-content-callback.js');

function table(name) {
  const q = { op: 'select', filters: [], payload: null, returning: false };
  const rows = () =>
    (name === 'content_opportunities' ? state.opportunities : state.configs).filter((row) =>
      q.filters.every((matches) => matches(row)),
    );
  const run = (single) => {
    const matched = rows();
    if (q.op === 'update') {
      for (const row of matched) Object.assign(row, q.payload);
    }
    const data = single ? (matched[0] ?? null) : matched;
    return { data: q.returning || q.op === 'select' ? data : null, error: null };
  };
  const chain = {
    select: () => ((q.returning = q.op !== 'select'), chain),
    eq: (column, value) => (q.filters.push((row) => row[column] === value), chain),
    limit: () => chain,
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    maybeSingle: async () => run(true),
    then: (resolve, reject) => Promise.resolve(run(false)).then(resolve, reject),
  };
  return chain;
}

let server;
let baseUrl;

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/webhooks/content', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = 'http://127.0.0.1:' + server.address().port + '/webhooks/content/opp-1/status';
}

beforeEach(async () => {
  state.opportunities = [
    {
      id: 'opp-1',
      brand_id: 'brand-1',
      status: 'sent',
      source_data: { kept: true },
      updated_at: '2026-10-20T00:00:00.000Z',
    },
  ];
  state.configs = [{ brand_id: 'brand-1', is_active: true, webhook_secret: 'shared-secret' }];
  mockFrom.mockReset();
  mockFrom.mockImplementation((name) => table(name));
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function send({ secret, status = 'in_progress' } = {}) {
  return fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === undefined ? {} : { 'X-Webhook-Secret': secret }),
    },
    body: JSON.stringify({ status }),
  });
}

describe('POST /webhooks/content/:id/status', () => {
  it('rejects a missing secret', async () => {
    const response = await send();
    expect(response.status).toBe(401);
    expect(state.opportunities[0].status).toBe('sent');
  });

  it('rejects a wrong secret', async () => {
    const response = await send({ secret: 'wrong-secret' });
    expect(response.status).toBe(401);
    expect(state.opportunities[0].status).toBe('sent');
  });

  it('updates the opportunity when the webhook secret matches', async () => {
    const response = await send({ secret: 'shared-secret', status: 'done' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, status: 'done' });
    expect(state.opportunities[0].status).toBe('done');
  });

  it('rejects a status outside the existing status whitelist', async () => {
    const response = await send({ secret: 'shared-secret', status: 'delete' });
    expect(response.status).toBe(400);
    expect(state.opportunities[0].status).toBe('sent');
  });
});
