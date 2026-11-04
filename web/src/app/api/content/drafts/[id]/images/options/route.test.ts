// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * The Content Editor's AI image options once the person is done (W4-09):
 * Use this image keeps the picked one and drops the others; Regenerate and
 * a closed dialog drop what is left. Only the person's own workspace's.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const DRAFT = '44444444-4444-4444-8444-444444444444';
const A = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c01.jpg';
const B = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c02.jpg';

const state = vi.hoisted(() => ({
  refused: false,
  draft: null as { id: string; brandName: string; demo: boolean } | null,
}));
vi.mock('@/lib/subscription-guard', () => ({
  failedCallResponse: () => NextResponse.json({ error: 'Failed' }, { status: 500 }),
  writeRefusal: async () =>
    state.refused
      ? NextResponse.json({ ok: false, code: 'subscription_inactive' }, { status: 402 })
      : null,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/run-api', async (original) => ({
  ...(await original<typeof import('@/lib/chat/run-api')>()),
  chatActor: async () => ACTOR,
}));
vi.mock('@/lib/content/ai-images', () => ({ imageDraftOf: async () => state.draft }));
const store = vi.hoisted(() => ({ keep: vi.fn(), drop: vi.fn() }));
vi.mock('@/lib/content/ai-image-store', async (original) => ({
  ...(await original<typeof import('@/lib/content/ai-image-store')>()),
  keepAiImageOption: store.keep,
  dropAiImageOptions: store.drop,
}));

const route = await import('./route');
const post = (body: unknown, id = DRAFT) =>
  route.POST(
    new Request(`http://x/api/content/drafts/${id}/images/options`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  state.refused = false;
  state.draft = { id: DRAFT, brandName: 'Acme Coffee', demo: false };
  store.keep.mockReset().mockResolvedValue({ url: `https://cdn.example/org-1/${B}` });
  store.drop.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/content/drafts/{id}/images/options', () => {
  it('keeps the picked option, drops the others, and answers with the address the page takes', async () => {
    const res = await post({ keep: B, drop: [A] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: `https://cdn.example/org-1/${B}` });
    expect(store.keep).toHaveBeenCalledWith('org-1', B, [A]);
    expect(store.drop).not.toHaveBeenCalled();
  });

  it('says so when the option couldn’t be kept', async () => {
    store.keep.mockResolvedValue(null);
    expect((await post({ keep: B, drop: [A] })).status).toBe(503);
  });

  it('drops options without a pick (Regenerate, the dialog closed), also on a read-only workspace', async () => {
    state.refused = true;
    const res = await post({ drop: [A, B] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.drop).toHaveBeenCalledWith('org-1', [A, B]);
    // Keeping one goes into the page: refused while read-only.
    expect((await post({ keep: B })).status).toBe(402);
    expect(store.keep).not.toHaveBeenCalled();
  });

  it('takes only option ids, for a draft the person can open', async () => {
    expect((await post({ drop: ['../org-2/x.jpg'] })).status).toBe(400);
    expect((await post({ keep: 'org-2/a.jpg' })).status).toBe(400);
    expect((await post({ drop: Array.from({ length: 11 }, () => A) })).status).toBe(400);
    state.draft = null;
    expect((await post({ drop: [A] })).status).toBe(404);
    expect((await post({ drop: [A] }, 'nope')).status).toBe(404);
    expect(store.drop).not.toHaveBeenCalled();
    expect(store.keep).not.toHaveBeenCalled();
  });
});
