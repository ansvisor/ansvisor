// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * The server actions Chat's content rows call (W2-07), as they run against
 * the member's own client: a page goes to the CMS as the Library sends it
 * (its kept slug, a page with placeholders refused) and the API's answers
 * come back as Chat's codes (not_connected, quota_exceeded, failed); audits
 * start on the API's one-page or bulk route, its quota said back; and a
 * draft's change, like the audits, is an Admin's or a Manager's.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(fake.db, {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { access_token: 'token' } } }),
      },
    }),
}));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const readCmsSources = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/cms-sources', () => ({ readCmsSources }));

const { createFakeSupabase } = await import('@/lib/chat/testing/fake-supabase');
const { sendDraftToCms } = await import('./cms-send');
const { startSiteAudits } = await import('./audits');
const { updateContentDraft } = await import('./content-drafts');

const BRAND = '11111111-1111-4111-8111-111111111111';
const DRAFT = '33333333-3333-4333-8333-333333333333';

let requests: { url: string; body: Record<string, unknown> }[];
let answer: { status: number; body: unknown };

beforeEach(() => {
  fake.db = createFakeSupabase();
  Object.assign(fake.db.tables, {
    profiles: [{ id: 'u1', role: 'manager' }],
    content_drafts: [
      {
        id: DRAFT,
        brand_id: BRAND,
        title: 'Pricing FAQ',
        body_html: '<h1>Pricing FAQ</h1><p>Plans start at $49.</p>',
        updated_at: '2026-10-30T09:00:00.000Z',
        archived_at: null,
        slug: 'pricing-faq',
        meta_title: null,
        meta_description: null,
        brands: { name: 'Acme', language: 'en' },
      },
    ],
  });
  readCmsSources.mockImplementation(async ({ draftIds }: { draftIds: string[] }) => {
    const draft = fake.db.tables.content_drafts.find((d) => d.id === draftIds[0]);
    return new Map(
      draft
        ? [
            [
              draft.id,
              {
                draftId: draft.id,
                title: draft.title,
                html: draft.body_html,
                sourceUrl: null,
                author: null,
                teamByline: '',
                byline: null,
              },
            ],
          ]
        : [],
    );
  });
  requests = [];
  answer = { status: 200, body: { deliveries: [{ id: 'd1', draftId: DRAFT, status: 'sent' }] } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const asRole = (role: string) => {
  fake.db.tables.profiles = [{ id: 'u1', role }];
};

describe('sendDraftToCms', () => {
  it('sends the page as the Library does, with the slug it kept, to the API’s send', async () => {
    expect(await sendDraftToCms(DRAFT, 'webflow')).toEqual({
      ok: true,
      target: 'webflow',
      status: 'sent',
      updated: false,
      live: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/api\/content-drafts\/send$/);
    expect(requests[0].body).toMatchObject({
      brandId: BRAND,
      target: 'webflow',
      pages: [{ draftId: DRAFT, title: 'Pricing FAQ', slug: 'pricing-faq' }],
    });
  });

  it('says the API’s refusals as Chat’s codes', async () => {
    for (const [code, reason] of [
      ['no_webflow', 'not_connected'],
      ['wordpress_not_configured', 'not_connected'],
      ['daily_limit', 'quota_exceeded'],
      ['in_progress', 'conflict'],
      ['webflow_refused', 'failed'],
    ] as const) {
      answer = { status: 400, body: { code, error: `Refused: ${code}` } };
      expect(await sendDraftToCms(DRAFT, 'webflow')).toEqual({
        ok: false,
        reason,
        message: `Refused: ${code}`,
      });
    }
    answer = {
      status: 200,
      body: { deliveries: [{ id: 'd1', draftId: DRAFT, status: 'failed', error: 'Timed out' }] },
    };
    expect(await sendDraftToCms(DRAFT, 'webhook')).toMatchObject({
      ok: false,
      reason: 'failed',
      message: 'Timed out',
    });
  });

  it('sends nothing for a page with placeholders, or a draft that isn’t in the Library', async () => {
    fake.db.tables.content_drafts[0].body_html = '<h1>Pricing FAQ</h1><p>[Your price]</p>';
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('placeholders'),
    });
    fake.db.tables.content_drafts[0].archived_at = '2026-10-30T10:00:00.000Z';
    expect(await sendDraftToCms(DRAFT, 'webflow')).toMatchObject({ reason: 'not_found' });
    expect(requests).toEqual([]);
  });
});

describe('startSiteAudits', () => {
  it('starts one page on the one-page route, several on the bulk route', async () => {
    answer = { status: 202, body: { audit: { id: 'a1', url: 'https://acme.example/a' } } };
    expect(await startSiteAudits(BRAND, ['https://acme.example/a'])).toEqual({
      ok: true,
      started: 1,
      audits: [{ id: 'a1', url: 'https://acme.example/a' }],
    });
    answer = {
      status: 202,
      body: {
        audits: [
          { id: 'a2', url: 'https://acme.example/b' },
          { id: 'a3', url: 'https://acme.example/c' },
        ],
      },
    };
    expect(
      await startSiteAudits(BRAND, ['https://acme.example/b', 'https://acme.example/c']),
    ).toMatchObject({ ok: true, started: 2 });
    expect(requests.map((r) => r.url.replace(/^.*\/api/, '/api'))).toEqual([
      '/api/audits',
      '/api/audits/bulk',
    ]);
    expect(requests[0].body).toEqual({ brandId: BRAND, url: 'https://acme.example/a' });
  });

  it('says the month’s quota in the API’s words, and refuses an Analyst', async () => {
    answer = {
      status: 402,
      body: { error: 'quota_exceeded', message: 'You’ve used this month’s 500 audits.' },
    };
    expect(await startSiteAudits(BRAND, ['https://acme.example/a'])).toEqual({
      ok: false,
      reason: 'quota_exceeded',
      message: 'You’ve used this month’s 500 audits.',
    });
    asRole('analyst');
    expect(await startSiteAudits(BRAND, ['https://acme.example/a'])).toMatchObject({
      reason: 'forbidden_role',
    });
    expect(requests).toHaveLength(1);
  });
});

describe('updateContentDraft', () => {
  it('refuses an Analyst, a draft that isn’t one, and one in the archive', async () => {
    asRole('analyst');
    expect(await updateContentDraft(DRAFT, { title: 'New' })).toMatchObject({
      reason: 'forbidden_role',
    });
    asRole('manager');
    expect(await updateContentDraft('not-an-id', { title: 'New' })).toMatchObject({
      reason: 'invalid',
    });
    fake.db.tables.content_drafts[0].archived_at = '2026-10-30T10:00:00.000Z';
    expect(await updateContentDraft(DRAFT, { title: 'New' })).toMatchObject({
      reason: 'not_found',
    });
    expect(fake.db.tables.content_drafts[0].title).toBe('Pricing FAQ');
  });
});
