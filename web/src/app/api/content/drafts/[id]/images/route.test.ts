// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * The Content Editor's Generate with AI (CHAT-25 §9, W4-09): the image
 * models with their costs, and a request for a draft the person can open;
 * a read-only workspace, the demo brand and a bad body make nothing.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const DRAFT = '44444444-4444-4444-8444-444444444444';
const LITE = 'google/gemini-3.1-flash-lite-image';
const OPTION = { id: 'a.jpg', url: 'https://cdn.example/content-images/org-1/ai-options/a.jpg' };

const state = vi.hoisted(() => ({
  refused: false,
  draft: null as Record<string, unknown> | null,
  brand: null as Record<string, unknown> | null,
}));
vi.mock('@/lib/subscription-guard', () => ({
  failedCallResponse: () => NextResponse.json({ error: 'Failed' }, { status: 500 }),
  writeRefusal: async () =>
    state.refused
      ? NextResponse.json({ ok: false, code: 'subscription_inactive' }, { status: 402 })
      : null,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
// The draft and its brand, as the person reads them (RLS).
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'content_drafts' ? state.draft : state.brand,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/chat/run-api', async (original) => ({
  ...(await original<typeof import('@/lib/chat/run-api')>()),
  chatActor: async () => ACTOR,
}));
const images = vi.hoisted(() => ({ options: vi.fn(), make: vi.fn() }));
vi.mock('@/lib/chat/images/access', () => ({ imageModelOptions: images.options }));
vi.mock('@/lib/content/ai-images', async (original) => ({
  ...(await original<typeof import('@/lib/content/ai-images')>()),
  makeDraftImages: images.make,
}));

const route = await import('./route');
const params = (id = DRAFT) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, id = DRAFT) =>
  route.POST(
    new Request(`http://x/api/content/drafts/${id}/images`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params(id),
  );

beforeEach(() => {
  state.refused = false;
  state.draft = { id: DRAFT, brand_id: 'brand-1' };
  state.brand = { name: 'Acme Coffee', is_demo: false };
  images.options.mockReset().mockResolvedValue({ models: [{ id: LITE }], ownKey: false });
  images.make.mockReset().mockResolvedValue({ ok: true, images: [OPTION], failed: 0 });
});

describe('GET /api/content/drafts/{id}/images', () => {
  it('lists the image models with their costs for a draft the person can open', async () => {
    const res = await route.GET(new Request('http://x'), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, models: [{ id: LITE }], ownKey: false });
    expect(images.options).toHaveBeenCalledWith('org-1');
    state.draft = null;
    expect((await route.GET(new Request('http://x'), params())).status).toBe(404);
    expect((await route.GET(new Request('http://x'), params('nope'))).status).toBe(404);
  });
});

describe('POST /api/content/drafts/{id}/images', () => {
  const body = { prompt: 'A cover image', model: LITE, count: 3, style: 'photo' };

  it('makes images for the draft, in the brand’s name, and answers with their addresses', async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, images: [OPTION], failed: 0 });
    expect(images.make).toHaveBeenCalledWith({
      organizationId: 'org-1',
      draftId: DRAFT,
      brandName: 'Acme Coffee',
      input: {
        prompt: 'A cover image',
        model: LITE,
        count: 3,
        style: 'photo',
        aspectRatio: '16:9',
      },
    });
  });

  it('answers each failure with its status', async () => {
    for (const [made, status] of [
      [{ ok: false, code: 'ai_limit', trial: false }, 429],
      [{ ok: false, code: 'refused', why: 'Blocked' }, 422],
      [{ ok: false, code: 'own_key' }, 409],
      [{ ok: false, code: 'not_saved', made: 3 }, 502],
      [{ ok: false, code: 'unavailable' }, 503],
    ] as const) {
      images.make.mockResolvedValueOnce(made);
      const res = await post(body);
      expect(res.status, made.code).toBe(status);
      expect(await res.json()).toEqual(made);
    }
  });

  it('makes nothing on a read-only workspace, the demo brand, a bad body or a draft it can’t open', async () => {
    state.refused = true;
    expect((await post(body)).status).toBe(402);
    state.refused = false;
    state.brand = { name: 'Beveline Coffee', is_demo: true };
    expect((await post(body)).status).toBe(403);
    state.brand = { name: 'Acme Coffee', is_demo: false };
    expect((await post({ ...body, count: 9 })).status).toBe(400);
    expect((await post({ ...body, model: 'acme/x' })).status).toBe(400);
    state.draft = null;
    expect((await post(body)).status).toBe(404);
    expect(images.make).not.toHaveBeenCalled();
  });
});
