import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Send to CMS's callback (#1331): the workspace's automation tells where a
 * sent page went live, with its webhook's secret.
 */

const { state } = vi.hoisted(() => ({
  state: { deliveries: [], configs: [], drafts: [] },
}));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (name) => {
      const rows =
        name === 'content_draft_deliveries'
          ? state.deliveries
          : name === 'content_drafts'
            ? state.drafts
            : state.configs;
      const q = { filters: [], update: null, order: null };
      const matched = () => {
        const found = rows.filter((row) => q.filters.every((f) => f(row)));
        if (q.order) found.sort((a, b) => (a[q.order] < b[q.order] ? 1 : -1));
        return found;
      };
      const run = (single) => {
        const found = matched();
        if (q.update) for (const row of found) Object.assign(row, q.update);
        return { data: single ? (found[0] ?? null) : found, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (column, value) => (q.filters.push((row) => row[column] === value), chain),
        update: (row) => ((q.update = row), chain),
        order: (column) => ((q.order = column), chain),
        limit: () => chain,
        maybeSingle: async () => run(true),
        then: (resolve, reject) => Promise.resolve(run(false)).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('../middleware/rate-limiter.js', () => ({
  webhookCallbackLimiter: (_req, _res, next) => next(),
  webhookCallbackAuthFailureLimiter: (_req, _res, next) => next(),
}));

const { default: router } = await import('./webhook-content-draft-callback.js');

const DELIVERY = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';
let server;
let baseUrl;

beforeEach(async () => {
  state.deliveries = [
    {
      id: DELIVERY,
      brand_id: 'b1',
      draft_id: 'd1',
      status: 'sent',
      created_at: '2026-10-24T10:00:00Z',
    },
  ];
  state.drafts = [{ id: 'd1', status: 'ready', published_url: null }];
  state.configs = [
    {
      brand_id: 'b1',
      is_active: true,
      webhook_secret: 's3cret',
      events: ['content_draft.sent'],
    },
  ];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/webhooks/content-drafts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/webhooks/content-drafts`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const call = (body, { id = DELIVERY, secret = 's3cret' } = {}) =>
  fetch(`${baseUrl}/${id}/published`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Webhook-Secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });

describe('POST /webhooks/content-drafts/:deliveryId/published', () => {
  it('marks the delivery and its page published at the address', async () => {
    const res = await call({ url: 'https://acme.example/blog/best-aeo-tools' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'published' });
    expect(state.deliveries[0]).toMatchObject({
      status: 'published',
      published_url: 'https://acme.example/blog/best-aeo-tools',
      published_at: expect.any(String),
    });
    expect(state.drafts[0]).toMatchObject({
      status: 'published',
      published_url: 'https://acme.example/blog/best-aeo-tools',
    });
  });

  it('answers the same for a wrong secret, an unknown or malformed delivery, and a webhook not taking the event', async () => {
    const denied = { error: 'Invalid webhook credentials' };
    for (const res of [
      await call({ url: 'https://a.example/x' }, { secret: 'wrong' }),
      await call({ url: 'https://a.example/x' }, { secret: null }),
      await call({ url: 'https://a.example/x' }, { id: '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a30' }),
      await call({ url: 'https://a.example/x' }, { id: 'not-an-id' }),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(denied);
    }
    state.configs[0].events = ['opportunity.sent'];
    const res = await call({ url: 'https://a.example/x' });
    expect(res.status).toBe(401);
    expect(state.deliveries[0].status).toBe('sent');
  });

  it('takes only an http(s) address, as the browser reads it', async () => {
    expect((await call({ url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call({ url: 'https://acme.example/a\nb' })).status).toBe(200);
    expect(state.deliveries[0].published_url).toBe('https://acme.example/ab');
  });

  it('counts a callback that lands before the send’s answer, or after it gave up', async () => {
    for (const status of ['queued', 'failed']) {
      state.deliveries[0].status = status;
      const res = await call({ url: 'https://acme.example/live' });
      expect(res.status).toBe(200);
      expect(state.deliveries[0].status).toBe('published');
    }
  });

  it('moves the page’s address only for its latest delivery', async () => {
    state.deliveries.push({
      id: 'newer',
      brand_id: 'b1',
      draft_id: 'd1',
      status: 'sent',
      created_at: '2026-10-24T11:00:00Z',
    });
    const res = await call({ url: 'https://acme.example/old' });
    expect(res.status).toBe(200);
    expect(state.deliveries[0].published_url).toBe('https://acme.example/old');
    expect(state.drafts[0]).toMatchObject({ status: 'ready', published_url: null });
  });
});
