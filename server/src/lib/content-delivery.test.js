import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to CMS (#1331): pages go to the brand's webhook as content packages,
 * reserved against the workspace's 200 a day, each one a delivery row.
 */

const db = {
  drafts: [],
  configs: [],
  queued: [],
  updates: [],
  rpc: [],
};

function from(table) {
  const q = { table, filters: [], update: null };
  const result = () => {
    if (q.update) {
      db.updates.push({ table, update: q.update, filters: q.filters });
      return { data: null, error: null };
    }
    if (table === 'content_drafts') {
      const ids = q.filters.find(([op]) => op === 'in')?.[2];
      return { data: db.drafts.filter((d) => !ids || ids.includes(d.id)), error: null };
    }
    if (table === 'webhook_configs') return { data: db.configs, error: null };
    if (table === 'brands')
      return { data: { name: 'Acme Coffee', industry: 'Coffee' }, error: null };
    if (table === 'brand_domains') return { data: [{ domain: 'acme.example' }], error: null };
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    eq: (col, value) => (q.filters.push(['eq', col, value]), chain),
    neq: (col, value) => (q.filters.push(['neq', col, value]), chain),
    is: (col, value) => (q.filters.push(['is', col, value]), chain),
    in: (col, value) => (q.filters.push(['in', col, value]), chain),
    limit: () => chain,
    single: async () => result(),
    maybeSingle: async () => {
      const { data } = result();
      const id = q.filters.find(([op, col]) => op === 'eq' && col === 'id')?.[2];
      return { data: (data ?? []).find((d) => d.id === id) ?? null, error: null };
    },
    update: (row) => ((q.update = row), chain),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (t) => from(t),
    rpc: async (fn, args) => {
      db.rpc.push({ fn, args });
      return { data: db.queued, error: null };
    },
  },
}));
const postJson = vi.fn();
vi.mock('./safe-post.js', () => ({ postJson: (...args) => postJson(...args) }));

const { DAILY_DELIVERIES, DeliveryError, cleanPublishHtml, sendContentPages, signBody } =
  await import('./content-delivery.js');

const page = (over = {}) => ({
  draftId: 'c0ffee00-0000-4000-8000-000000000001',
  title: 'Best AEO tools (2026)',
  slug: 'best-aeo-tools',
  metaTitle: 'Best AEO tools',
  metaDescription: 'The tools that help AI answers cite you.',
  html: '<h2>Why</h2><p>Because.</p>',
  author: 'Ada Lovelace',
  featuredImage: null,
  ...over,
});
const row = (draftId, over = {}) => ({
  id: `d-${draftId.slice(-1)}`,
  draft_id: draftId,
  batch_id: null,
  status: 'queued',
  ...over,
});

beforeEach(() => {
  db.drafts = [{ id: page().draftId }];
  db.configs = [
    {
      id: 'w1',
      webhook_url: 'https://hooks.acme.example/cms',
      webhook_secret: 's3cret',
      events: ['content_draft.sent'],
    },
  ];
  db.queued = [row(page().draftId)];
  db.updates = [];
  db.rpc = [];
  postJson.mockReset().mockResolvedValue({ status: 200, answer: '{"ok":true}' });
});

const send = (pages = [page()]) =>
  sendContentPages({ orgId: 'o1', brandId: 'b1', userId: 'u1', pages });

describe('cleanPublishHtml', () => {
  it('keeps the page and its JSON-LD, without scripts, frames, handlers or script links', () => {
    const html = cleanPublishHtml(
      '<p onclick="steal()">Hi <a href="javascript:alert(1)">x</a> <a href="https://a.example">ok</a></p>' +
        '<script>alert(1)</script><script type="application/ld+json">{"@type":"Article"}</script>' +
        '<iframe src="https://evil.example"></iframe><img src="data:image/png;base64,AAA" alt="dot">' +
        '<img src="data:text/html,x">',
    );
    expect(html).toBe(
      '<p>Hi <a>x</a> <a href="https://a.example">ok</a></p>' +
        '<script type="application/ld+json">{"@type":"Article"}</script>' +
        '<img src="data:image/png;base64,AAA" alt="dot"><img>',
    );
  });
});

describe('cleanPublishHtml, against links that hide their scheme', () => {
  it.each([
    ['<a href="java&#9;script:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="jav&#x0A;ascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="&#1;javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="vbscript:x">x</a>', '<a>x</a>'],
    [
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate></a></svg>',
      '<svg><a></a></svg>',
    ],
    ['<a href="mailto:hi@acme.example">x</a>', '<a href="mailto:hi@acme.example">x</a>'],
    ['<a href="/pricing#plans">x</a>', '<a href="/pricing#plans">x</a>'],
    ['<a href="data:image/png;base64,AAA">x</a>', '<a>x</a>'],
  ])('%s', (html, clean) => {
    expect(cleanPublishHtml(html)).toBe(clean);
  });
});

describe('signBody', () => {
  it('signs the body with the webhook’s secret, as sha256=<hex>', () => {
    const expected = crypto.createHmac('sha256', 's3cret').update('{"a":1}').digest('hex');
    expect(signBody('s3cret', '{"a":1}')).toBe(`sha256=${expected}`);
  });
});

describe('sendContentPages', () => {
  it('sends one page as a package, signed, and keeps its slug and meta on the draft', async () => {
    const sent = await send();
    expect(db.rpc).toEqual([
      {
        fn: 'reserve_content_deliveries',
        args: {
          p_organization_id: 'o1',
          p_brand_id: 'b1',
          p_sent_by: 'u1',
          p_batch_id: null,
          p_items: [{ draft_id: page().draftId, title: page().title, slug: 'best-aeo-tools' }],
          p_limit: DAILY_DELIVERIES,
        },
      },
    ]);
    const [address, body, { headers }] = postJson.mock.calls[0];
    expect(address).toBe('https://hooks.acme.example/cms');
    expect(headers['X-Webhook-Secret']).toBe('s3cret');
    expect(headers['X-Ansvisor-Signature']).toBe(signBody('s3cret', body));
    expect(JSON.parse(body)).toMatchObject({
      event: 'content_draft.sent',
      schemaVersion: 1,
      delivery: { id: 'd-1', batchId: null },
      page: {
        draftId: page().draftId,
        title: 'Best AEO tools (2026)',
        slug: 'best-aeo-tools',
        metaTitle: 'Best AEO tools',
        html: '<h2>Why</h2><p>Because.</p>',
        author: 'Ada Lovelace',
      },
      brand: { name: 'Acme Coffee', domain: 'acme.example', industry: 'Coffee' },
      callback_url: expect.stringMatching(/\/webhooks\/content-drafts\/d-1\/published$/),
      callback_method: 'POST',
    });
    expect(db.updates).toEqual([
      {
        table: 'content_drafts',
        update: {
          slug: 'best-aeo-tools',
          meta_title: 'Best AEO tools',
          meta_description: 'The tools that help AI answers cite you.',
        },
        filters: [['eq', 'id', page().draftId]],
      },
      {
        table: 'content_draft_deliveries',
        update: expect.objectContaining({ status: 'sent', http_status: 200, error: null }),
        // A callback that landed first keeps it published.
        filters: [
          ['eq', 'id', 'd-1'],
          ['neq', 'status', 'published'],
        ],
      },
    ]);
    expect(sent).toMatchObject({
      batchId: null,
      skipped: 0,
      deliveries: [{ id: 'd-1', status: 'sent' }],
    });
  });

  it('offers no callback to a webhook without a secret, and keeps the answer of the one that took it', async () => {
    db.configs = [
      {
        id: 'w1',
        webhook_url: 'https://a.example',
        webhook_secret: null,
        events: ['content_draft.sent'],
      },
      {
        id: 'w2',
        webhook_url: 'https://b.example',
        webhook_secret: 's',
        events: ['content_draft.sent'],
      },
    ];
    postJson
      .mockResolvedValueOnce({ status: 200, answer: 'taken' })
      .mockResolvedValueOnce({ status: 500, answer: 'boom' });
    const sent = await send();
    const [unsigned, signed] = postJson.mock.calls;
    expect(JSON.parse(unsigned[1])).toMatchObject({ callback_url: null, callback_method: null });
    expect(unsigned[2].headers).toEqual({});
    expect(JSON.parse(signed[1]).callback_url).toMatch(/\/published$/);
    expect(sent.deliveries[0]).toMatchObject({
      status: 'sent',
      http_status: 200,
      response_excerpt: 'taken',
    });
  });

  it('writes a delivery failed when the webhook answers an error or can’t be reached', async () => {
    postJson.mockResolvedValue({ status: 500, answer: 'boom' });
    let sent = await send();
    expect(sent.deliveries[0]).toMatchObject({
      status: 'failed',
      http_status: 500,
      error: 'The webhook answered 500',
      response_excerpt: 'boom',
    });

    postJson.mockRejectedValue(new Error('ECONNRESET'));
    sent = await send();
    expect(sent.deliveries[0]).toMatchObject({
      status: 'failed',
      error: 'The webhook could not be reached',
    });
  });

  it('sends more pages in the background, one after another, under one batch', async () => {
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [{ id: page().draftId }, { id: second.draftId }];
    // The reserved rows may come back in any order: they go in the pages' order.
    db.queued = [row(second.draftId, { batch_id: 'x' }), row(page().draftId, { batch_id: 'x' })];
    let release;
    postJson.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const sent = await send([page(), second, page()]);
    expect(db.rpc[0].args.p_batch_id).toEqual(expect.any(String));
    // Named twice, it goes once.
    expect(db.rpc[0].args.p_items.map((i) => i.draft_id)).toEqual([page().draftId, second.draftId]);
    expect(sent).toMatchObject({
      skipped: 0,
      deliveries: [{ status: 'queued' }, { status: 'queued' }],
    });

    // The first is still sending: the second waits for it.
    await new Promise((r) => setTimeout(r, 0));
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postJson.mock.calls[0][1]).page.draftId).toBe(page().draftId);
    release({ status: 200, answer: '' });
    await vi.waitFor(() => expect(postJson).toHaveBeenCalledTimes(2));
    expect(JSON.parse(postJson.mock.calls[1][1]).page.draftId).toBe(second.draftId);
  });

  it('closes a page deleted before its turn in a batch, and sends the rest', async () => {
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [{ id: page().draftId }, { id: second.draftId }];
    db.queued = [row(page().draftId), row(second.draftId)];
    let release;
    postJson.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await send([page(), second]);
    await vi.waitFor(() => expect(postJson).toHaveBeenCalledTimes(1));
    // The second is deleted while the first is sending: it doesn't go.
    db.drafts = [{ id: page().draftId }];
    release({ status: 200, answer: '' });
    await vi.waitFor(() =>
      expect(db.updates).toContainEqual({
        table: 'content_draft_deliveries',
        update: expect.objectContaining({
          status: 'failed',
          error: 'The page was deleted or archived before it was sent',
        }),
        filters: [
          ['eq', 'id', 'd-2'],
          ['eq', 'status', 'queued'],
        ],
      }),
    );
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('counts the pages past the day’s cap as skipped, and refuses once nothing is left', async () => {
    const second = page({ draftId: 'c0ffee00-0000-4000-8000-000000000002', slug: 'second' });
    db.drafts = [{ id: page().draftId }, { id: second.draftId }];
    db.queued = [row(page().draftId)];
    expect((await send([page(), second])).skipped).toBe(1);

    db.queued = [];
    await expect(send()).rejects.toMatchObject({ code: 'daily_limit', status: 429 });
  });

  it('refuses a page of another brand, and a brand with no webhook taking the event', async () => {
    db.drafts = [];
    await expect(send()).rejects.toBeInstanceOf(DeliveryError);
    await expect(send()).rejects.toMatchObject({ code: 'not_found', status: 404 });

    db.drafts = [{ id: page().draftId }];
    db.configs = [];
    await expect(send()).rejects.toMatchObject({ code: 'no_webhook', status: 409 });

    db.configs = [{ id: 'w1', webhook_url: 'https://x.example', events: ['opportunity.sent'] }];
    await expect(send()).rejects.toMatchObject({ code: 'webhook_not_subscribed', status: 409 });
    expect(db.rpc).toEqual([]);
    expect(postJson).not.toHaveBeenCalled();
  });
});
