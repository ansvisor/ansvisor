import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/content-drafts/send (Send to CMS, #1331): admins and managers
 * send pages of their brand; the reasons a send can't go keep their codes.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let role;
const assertBrandAccess = vi.fn();
const sendContentPages = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { role }, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('../lib/content-delivery.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendContentPages: (...args) => sendContentPages(...args),
}));

const { default: router } = await import('./content-drafts.js');
const { DeliveryError } = await import('../lib/content-delivery.js');

let server;
let baseUrl;

beforeEach(async () => {
  role = 'manager';
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  sendContentPages
    .mockReset()
    .mockResolvedValue({ batchId: null, skipped: 0, deliveries: [{ id: 'd1', status: 'sent' }] });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/content-drafts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content-drafts`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const page = {
  draftId: DRAFT,
  title: 'Best AEO tools',
  slug: 'best-aeo-tools',
  html: '<p>Hi</p>',
};
const send = (body) =>
  fetch(`${baseUrl}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-drafts/send', () => {
  it('sends the brand’s pages for a manager, with the defaults filled in', async () => {
    const res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      batchId: null,
      skipped: 0,
      deliveries: [{ id: 'd1', status: 'sent' }],
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(sendContentPages).toHaveBeenCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      userId: 'u1',
      pages: [{ ...page, metaTitle: '', metaDescription: '', author: null, featuredImage: null }],
    });
  });

  it('leaves it to admins and managers', async () => {
    role = 'analyst';
    const res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
    expect(sendContentPages).not.toHaveBeenCalled();
  });

  it.each([
    [{ brandId: BRAND, pages: [] }],
    [{ brandId: BRAND, pages: Array.from({ length: 26 }, () => page) }],
    [{ brandId: BRAND, pages: [{ ...page, slug: 'a/b' }] }],
    [
      {
        brandId: BRAND,
        pages: [{ ...page, featuredImage: { src: 'http://x.example/a.png', alt: '' } }],
      },
    ],
    [{ brandId: 'nope', pages: [page] }],
  ])('turns away a send it can’t take', async (body) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expect(sendContentPages).not.toHaveBeenCalled();
  });

  it('answers why a send can’t go, with its code', async () => {
    sendContentPages.mockRejectedValue(
      new DeliveryError('webhook_not_subscribed', 'Not subscribed', 409),
    );
    let res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Not subscribed', code: 'webhook_not_subscribed' });

    sendContentPages.mockRejectedValue(new DeliveryError('daily_limit', 'Try later', 429));
    res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(429);

    sendContentPages.mockRejectedValue(new Error('db down'));
    res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'failed' });
  });
});
