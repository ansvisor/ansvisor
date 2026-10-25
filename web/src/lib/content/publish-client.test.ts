import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Mark published (CE-013), from the browser: the API writes the address. */

const reads = vi.hoisted(() => ({
  draft: null as Record<string, unknown> | null,
  domain: null as { domain: string } | null,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: table === 'content_drafts' ? reads.draft : reads.domain,
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

const { publishPage, readPublishAddress } = await import('./publish-client');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  reads.draft = null;
  reads.domain = null;
});
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('publishPage', () => {
  it('sends the address through the proxy with the session, and reads the answer', async () => {
    answer(200, {
      publishedUrl: 'https://acme.example/x',
      publishedAt: '2026-10-25T10:00:00Z',
      onBrandDomain: false,
      taskCompleted: true,
    });
    expect(await publishPage('d1', 'https://acme.example/x')).toEqual({
      ok: true,
      publishedUrl: 'https://acme.example/x',
      publishedAt: '2026-10-25T10:00:00Z',
      onBrandDomain: false,
      taskCompleted: true,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/content-drafts/d1/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ url: 'https://acme.example/x' }),
    });
  });

  it('names an address that isn’t one, a page gone, and the general reasons', async () => {
    answer(400, { code: 'invalid_url' });
    expect(await publishPage('d1', 'x')).toEqual({ ok: false, code: 'invalid_url' });
    answer(404, { code: 'not_found' });
    expect(await publishPage('d1', 'x')).toEqual({ ok: false, code: 'not_found' });
    answer(403, { code: 'not_in_workspace' });
    expect(await publishPage('d1', 'x')).toEqual({ ok: false, code: 'workspace' });
    answer(500, { code: 'failed' });
    expect(await publishPage('d1', 'x')).toEqual({ ok: false, code: 'failed' });
  });
});

describe('readPublishAddress', () => {
  it('starts from where the page went live, else the page it optimizes, else the brand’s site and its slug', async () => {
    reads.draft = {
      brand_id: 'b1',
      published_url: 'https://acme.example/live',
      source_url: 'https://acme.example/old',
      slug: 's',
    };
    expect(await readPublishAddress('d1')).toBe('https://acme.example/live');
    reads.draft = { ...reads.draft, published_url: null };
    expect(await readPublishAddress('d1')).toBe('https://acme.example/old');
    reads.draft = { ...reads.draft, source_url: null, slug: 'cold-brew' };
    reads.domain = { domain: 'https://www.acme.example/' };
    expect(await readPublishAddress('d1')).toBe('https://www.acme.example/cold-brew');
    reads.domain = null;
    expect(await readPublishAddress('d1')).toBe('');
    reads.draft = null;
    expect(await readPublishAddress('d1')).toBe('');
  });
});
