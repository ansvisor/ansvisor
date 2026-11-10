import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to CMS → HubSpot blog posts (#2140; 00522): the account's blogs, a
 * page as a draft post, a send that updates the page's post, and the posts
 * read back when they go live. Against a fake HubSpot answering in the
 * shape HubSpot's API reference documents (lib/hubspot/__fixtures__), to be
 * replaced with recorded answers at the live test.
 */

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../hubspot/__fixtures__/${name}.json`, import.meta.url), 'utf8'),
  );

const db = vi.hoisted(() => ({ last: null, updates: [], published: [], connection: null }));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const q = { table, update: null, filters: [] };
      const chain = {
        select: () => chain,
        eq: (c, v) => (q.filters.push([c, v]), chain),
        neq: () => chain,
        not: () => chain,
        gte: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        update: (row) => ((q.update = row), chain),
        maybeSingle: async () =>
          table === 'brands'
            ? { data: { organizations: db.org }, error: null }
            : { data: db.last, error: null },
        then: (resolve) => {
          if (q.update) {
            db.updates.push({ table, row: q.update, filters: q.filters });
            return resolve({ error: null });
          }
          return resolve({ data: db.sends ?? [], error: null });
        },
      };
      return chain;
    },
  },
}));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('../composio.js', () => ({ proxyRequest: vi.fn(), isHubspotConfigured: () => true }));
const conn = vi.hoisted(() => ({ markSignInRefused: vi.fn(), hubspotConnection: vi.fn() }));
vi.mock('../hubspot/connection.js', () => ({ HUBSPOT: 'hubspot', ...conn }));
vi.mock('../content-published.js', () => ({
  markDeliveryPublished: async (send, url) => db.published.push({ id: send.id, url }),
}));

const { HubspotError } = await import('../hubspot/client.js');
const { headHtml, listBlogs, liveUrl, postOf, toHubspotBody } = await import('./hubspot-blog.js');
const { brandPlanHasHubspot, sendToHubspot } = await import('./hubspot-delivery.js');
const { checkHubspotPublished } = await import('./hubspot-status.js');

/** A fake HubSpot: routes by `METHOD path`; an answer may be an error or a function of the body. */
function fakeHubspot(routes) {
  const calls = [];
  const request = vi.fn(async ({ method = 'GET', path, body }) => {
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    if (route === undefined) throw new Error(`unexpected ${method} ${path}`);
    const answer = typeof route === 'function' ? route(body) : route;
    if (answer instanceof Error) throw answer;
    return { status: 200, headers: {}, data: answer };
  });
  return { request, calls };
}

const page = {
  draftId: 'd1',
  title: 'How AI assistants pick a CRM in 2026',
  slug: 'ai-assistants-pick-crm',
  metaTitle: 'How AI assistants pick a CRM',
  metaDescription: 'What ChatGPT and Perplexity look at.',
  featuredImage: { src: 'https://cdn.acme.test/crm.png', alt: 'A CRM' },
};
const HTML =
  '<h2>Why</h2><p>Answers <img src="https://cdn.acme.test/a.png" alt="a"></p><script type="application/ld+json">{"@type":"Article"}</script>';
const JSON_LD = [{ '@context': 'https://schema.org', '@type': 'Article', headline: '</script>' }];
const CONNECTION = { accountId: 'acc-1', composioAccountId: 'ca_1', blogId: '1234567890' };

beforeEach(() => {
  db.last = null;
  db.updates = [];
  db.published = [];
  db.sends = [];
  db.org = { plan: 'growth', plan_overrides: null };
  conn.markSignInRefused.mockReset();
  conn.hubspotConnection.mockReset();
  vi.stubEnv('IS_CLOUD', 'true');
});

describe('the blog post a page makes', () => {
  it('has the page’s title, slug, meta and featured image, its JSON-LD in the head', () => {
    const post = postOf({ page, html: HTML, jsonLd: JSON_LD, blogId: '1234567890' });
    expect(post).toMatchObject({
      name: page.title,
      contentGroupId: '1234567890',
      slug: 'ai-assistants-pick-crm',
      htmlTitle: 'How AI assistants pick a CRM',
      metaDescription: 'What ChatGPT and Perplexity look at.',
      useFeaturedImage: true,
      featuredImage: 'https://cdn.acme.test/crm.png',
      featuredImageAltText: 'A CRM',
    });
    // The body keeps its images, and loses its script: the JSON-LD goes to the head.
    expect(post.postBody).toContain('<img src="https://cdn.acme.test/a.png"');
    expect(post.postBody).not.toContain('<script');
    expect(post.headHtml).toBe(
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"\\u003c/script>"}</script>',
    );
    // No featured image, none asked for.
    const plain = postOf({ page: { ...page, featuredImage: null }, html: '<p>x</p>', blogId: '1' });
    expect(plain.useFeaturedImage).toBe(false);
    expect(plain).not.toHaveProperty('featuredImage');
    expect(toHubspotBody('<p>a</p><script>x</script>')).toBe('<p>a</p>');
    expect(headHtml([])).toBe('');
  });
});

describe('listBlogs', () => {
  it('lists the account’s blogs by name', async () => {
    const { request, calls } = fakeHubspot({
      'GET /cms/v3/blog-settings/settings': fixture('blog-settings'),
    });
    expect(await listBlogs(request)).toEqual([
      { id: '1234567890', name: 'Acme blog', url: 'https://www.acme.test/blog' },
      { id: '2233445566', name: 'Acme news', url: 'https://www.acme.test/news' },
    ]);
    expect(calls[0].path).toBe('/cms/v3/blog-settings/settings');
  });
});

describe('liveUrl', () => {
  it('is the address of a published post, not of a draft or a post scheduled later', () => {
    expect(liveUrl(fixture('blog-post-published'))).toBe(
      'https://www.acme.test/blog/ai-assistants-pick-crm',
    );
    expect(liveUrl(fixture('blog-post-draft'))).toBeNull();
    expect(
      liveUrl({
        currentState: 'PUBLISHED_OR_SCHEDULED',
        url: 'https://x.test/a',
        publishDate: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).toBeNull();
    expect(liveUrl({ currentState: 'PUBLISHED', url: 'javascript:alert(1)' })).toBeNull();
  });
});

describe('sendToHubspot', () => {
  const send = (request) =>
    sendToHubspot({
      delivery: { id: 'del-2' },
      page,
      html: HTML,
      jsonLd: JSON_LD,
      connection: CONNECTION,
      request,
    });

  it('makes a draft post on the brand’s blog', async () => {
    const { request, calls } = fakeHubspot({
      'POST /cms/v3/blogs/posts': fixture('blog-post-draft'),
    });
    expect(await send(request)).toEqual({
      taken: true,
      externalId: '99887766554',
      collectionId: '1234567890',
      updated: false,
      live: false,
      changed: {},
    });
    expect(calls[0].body).toMatchObject({ contentGroupId: '1234567890', name: page.title });
  });

  it('updates the draft of the post the page’s last send made, a new one when it’s gone', async () => {
    db.last = { id: 'del-1', external_id: '99887766554' };
    const { request, calls } = fakeHubspot({
      'PATCH /cms/v3/blogs/posts/99887766554/draft': fixture('blog-post-draft'),
    });
    expect(await send(request)).toMatchObject({
      taken: true,
      updated: true,
      externalId: '99887766554',
    });
    expect(calls.map((c) => c.method)).toEqual(['PATCH']);

    const gone = fakeHubspot({
      'PATCH /cms/v3/blogs/posts/99887766554/draft': new HubspotError('not_found', '404'),
      'POST /cms/v3/blogs/posts': { ...fixture('blog-post-draft'), id: '11122233344' },
    });
    expect(await send(gone.request)).toMatchObject({
      taken: true,
      updated: false,
      externalId: '11122233344',
    });
  });

  it('says why HubSpot refused, and stops a batch for the sign-in or the content scope', async () => {
    const scopes = fakeHubspot({
      'POST /cms/v3/blogs/posts': new HubspotError('scopes', '403', { status: 403 }),
    });
    expect(await send(scopes.request)).toEqual({
      taken: false,
      failure:
        "HubSpot didn't give Ansvisor access to blog posts (the content scope). Connect HubSpot again in Settings › Integrations.",
      refused: true,
    });

    const auth = fakeHubspot({ 'POST /cms/v3/blogs/posts': new HubspotError('auth', '401') });
    expect(await send(auth.request)).toMatchObject({ taken: false, refused: true });
    expect(conn.markSignInRefused).toHaveBeenCalledWith('acc-1');

    const slug = fakeHubspot({ 'POST /cms/v3/blogs/posts': new HubspotError('conflict', '409') });
    expect(await send(slug.request)).toEqual({
      taken: false,
      failure: 'HubSpot already has a post with this slug. Change the slug and send again.',
    });

    const down = fakeHubspot({ 'POST /cms/v3/blogs/posts': new Error('socket hang up') });
    expect(await send(down.request)).toEqual({
      taken: false,
      failure: 'HubSpot could not be reached',
    });
  });
});

describe('brandPlanHasHubspot', () => {
  it('is the plan’s crm_integrations: Growth and above', async () => {
    expect(await brandPlanHasHubspot('b1')).toBe(true);
    db.org = { plan: 'starter', plan_overrides: null };
    expect(await brandPlanHasHubspot('b1')).toBe(false);
  });
});

describe('checkHubspotPublished', () => {
  const connected = {
    accountId: 'acc-1',
    composioAccountId: 'ca_1',
    connected: true,
    settings: { blog: { id: '1234567890', name: 'Acme blog' } },
  };

  it('marks a post published at its address, and closes one deleted in HubSpot', async () => {
    conn.hubspotConnection.mockResolvedValue(connected);
    db.sends = [
      { id: 's1', draft_id: 'd1', external_id: '99887766554' },
      { id: 's2', draft_id: 'd2', external_id: '55555555555' },
      { id: 's3', draft_id: 'd3', external_id: '66666666666' },
    ];
    const { request } = fakeHubspot({
      'GET /cms/v3/blogs/posts/99887766554': fixture('blog-post-published'),
      'GET /cms/v3/blogs/posts/55555555555': new HubspotError('not_found', '404'),
      'GET /cms/v3/blogs/posts/66666666666': fixture('blog-post-draft'),
    });
    expect(await checkHubspotPublished('b1', { request })).toEqual({
      checked: 3,
      published: [{ draftId: 'd1', url: 'https://www.acme.test/blog/ai-assistants-pick-crm' }],
    });
    expect(db.published).toEqual([
      { id: 's1', url: 'https://www.acme.test/blog/ai-assistants-pick-crm' },
    ]);
    expect(db.updates).toEqual([
      expect.objectContaining({
        table: 'content_draft_deliveries',
        row: { status: 'failed', error: 'Removed in HubSpot' },
      }),
    ]);
  });

  it('reads nothing without a live sign-in, a blog, or the plan', async () => {
    const { request, calls } = fakeHubspot({});
    conn.hubspotConnection.mockResolvedValue({ ...connected, connected: false });
    expect(await checkHubspotPublished('b1', { request })).toEqual({ checked: 0, published: [] });
    conn.hubspotConnection.mockResolvedValue({ ...connected, settings: { blog: null } });
    expect(await checkHubspotPublished('b1', { request })).toEqual({ checked: 0, published: [] });
    conn.hubspotConnection.mockResolvedValue(connected);
    db.org = { plan: 'starter', plan_overrides: null };
    db.sends = [{ id: 's1', draft_id: 'd1', external_id: '99887766554' }];
    expect(await checkHubspotPublished('b1', { request })).toEqual({ checked: 0, published: [] });
    expect(calls).toEqual([]);
  });

  it('stops at a refused sign-in, and marks it', async () => {
    conn.hubspotConnection.mockResolvedValue(connected);
    db.sends = [{ id: 's1', draft_id: 'd1', external_id: '99887766554' }];
    const { request } = fakeHubspot({
      'GET /cms/v3/blogs/posts/99887766554': new HubspotError('auth', '401'),
    });
    expect(await checkHubspotPublished('b1', { request })).toEqual({ checked: 0, published: [] });
    expect(conn.markSignInRefused).toHaveBeenCalledWith('acc-1');
  });
});
