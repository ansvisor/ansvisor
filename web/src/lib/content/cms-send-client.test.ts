import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsPage } from './cms-send';

/**
 * Send to CMS from the browser (#1331): through the API's proxy with the
 * session's token, its errors as the server names them, and the draft's kept
 * fields and last send read when the dialog opens.
 */

let session: { access_token: string } | null;
let reads: Record<string, { data: unknown; error: unknown }>;
const filters: [string, string, unknown][] = [];

vi.mock('@/config/api', () => ({ BROWSER_API_BASE_URL: '/api/aeo' }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (filters.push([table, col, v]), chain),
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => reads[table],
      };
      return chain;
    },
  }),
}));

const { readDraftCms, sendPagesToCms } = await import('./cms-send-client');

const page: CmsPage = {
  draftId: 'd1',
  title: 'Pour-over',
  slug: 'pour-over',
  metaTitle: 'Pour-over',
  metaDescription: 'Brew it slowly.',
  html: '<p>Brew it slowly.</p>',
  author: null,
  featuredImage: null,
};
const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  session = { access_token: 'token-1' };
  filters.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendPagesToCms', () => {
  it('posts the pages with the session’s token and gives what was sent', async () => {
    answer(200, { batchId: 'b1', deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }] });
    const result = await sendPagesToCms('brand-1', [page]);
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/content-drafts/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({ brandId: 'brand-1', pages: [page] }),
    });
    expect(result).toEqual({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
    });
  });

  it('gives the server’s reason, and the field a 400 names', async () => {
    answer(409, { code: 'webhook_not_subscribed' });
    expect(await sendPagesToCms('brand-1', [page])).toEqual({
      ok: false,
      code: 'webhook_not_subscribed',
      field: null,
    });
    answer(400, { code: 'invalid', field: 'pages.0.slug' });
    expect(await sendPagesToCms('brand-1', [page])).toEqual({
      ok: false,
      code: 'invalid',
      field: 'pages.0.slug',
    });
  });

  it('reads the session, another workspace and the rate limiter as other calls do', async () => {
    answer(401, { error: 'Unauthorized' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'session' });
    answer(403, { error: 'Not in your workspace', code: 'not_in_workspace' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'workspace' });
    answer(429, { message: 'Too many requests' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'busy' });
    // A send's own reason first: the day's limit is a 429 too.
    answer(429, { code: 'daily_limit' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'daily_limit' });
    session = null;
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'session' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reads an unknown code, a body that isn’t JSON or no answer as failed', async () => {
    answer(409, { code: 'conflict' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: false, code: 'failed' });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => Promise.reject(new Error('not JSON')),
    });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: false, code: 'failed' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: false, code: 'failed' });
    // No route yet (the API before the send was deployed).
    answer(404, {});
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: false, code: 'failed' });
  });
});

describe('readDraftCms', () => {
  it('gives the kept fields, where the page went live and its last send', async () => {
    reads = {
      content_drafts: {
        data: {
          slug: 'coffee',
          meta_title: null,
          meta_description: 'Slowly.',
          published_url: 'https://example.com/coffee',
        },
        error: null,
      },
      content_draft_deliveries: {
        data: {
          status: 'sent',
          created_at: '2026-10-24T10:00:00Z',
          sent_at: '2026-10-24T10:00:02Z',
          error: null,
        },
        error: null,
      },
    };
    expect(await readDraftCms('d1')).toEqual({
      fields: { slug: 'coffee', metaTitle: undefined, metaDescription: 'Slowly.' },
      publishedUrl: 'https://example.com/coffee',
      last: { status: 'sent', at: '2026-10-24T10:00:02Z', error: null },
    });
    expect(filters).toEqual([
      ['content_drafts', 'id', 'd1'],
      ['content_draft_deliveries', 'draft_id', 'd1'],
    ]);
  });

  it('gives no last send when its read fails, and null when the draft’s does', async () => {
    reads = {
      content_drafts: {
        data: { slug: null, meta_title: null, meta_description: null, published_url: null },
        error: null,
      },
      content_draft_deliveries: { data: null, error: { message: 'no such table' } },
    };
    expect((await readDraftCms('d1'))?.last).toBeNull();
    // Before its columns are there (00262), the dialog fills the fields from the page.
    reads.content_drafts = { data: null, error: { message: 'column "slug" does not exist' } };
    expect(await readDraftCms('d1')).toBeNull();
  });
});
