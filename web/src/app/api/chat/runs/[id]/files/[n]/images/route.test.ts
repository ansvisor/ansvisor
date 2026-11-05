// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * A set of images on its output card (CHAT-15 item 22, W4-08): its images
 * listed and each one shown, and another picked, in the person's own chat
 * only; a read-only workspace picks nothing (402); anything the person
 * can't open is 404.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const RUN = '44444444-4444-4444-8444-444444444444';

const state = vi.hoisted(() => ({ refused: false }));
vi.mock('@/lib/subscription-guard', () => ({
  failedCallResponse: () => NextResponse.json({ error: 'Failed' }, { status: 500 }),
  writeRefusal: async () =>
    state.refused
      ? NextResponse.json({ ok: false, code: 'subscription_inactive' }, { status: 402 })
      : null,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/run-api', async (original) => ({
  ...(await original<typeof import('@/lib/chat/run-api')>()),
  chatActor: async () => ACTOR,
}));
const files = vi.hoisted(() => ({
  readRunImages: vi.fn(),
  readRunImage: vi.fn(),
  selectRunImage: vi.fn(),
}));
vi.mock('@/lib/chat/file-store', () => files);

const setRoute = await import('./route');
const imageRoute = await import('./[image]/route');

const params = (n = '1', id = RUN) => ({ params: Promise.resolve({ id, n }) });
const pick = (body: unknown, n = '1') =>
  setRoute.POST(
    new Request(`http://x/api/chat/runs/${RUN}/files/${n}/images`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params(n),
  );

beforeEach(() => {
  state.refused = false;
  files.readRunImages.mockReset();
  files.readRunImage.mockReset();
  files.selectRunImage.mockReset();
});

describe('GET /api/chat/runs/{id}/files/{n}/images', () => {
  it('lists the set: how many, which is selected, and whether the person may pick', async () => {
    files.readRunImages.mockResolvedValue({ count: 4, selected: 1, mine: true });
    const res = await setRoute.GET(new Request('http://x'), params('2'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 4, selected: 1, mine: true });
    expect(files.readRunImages).toHaveBeenCalledWith(ACTOR, RUN, 2);
  });

  it('is 404 for a set the person can’t open, or a place that isn’t one', async () => {
    files.readRunImages.mockResolvedValue(null);
    expect((await setRoute.GET(new Request('http://x'), params())).status).toBe(404);
    expect((await setRoute.GET(new Request('http://x'), params('0'))).status).toBe(404);
    expect((await setRoute.GET(new Request('http://x'), params('1', 'nope'))).status).toBe(404);
    expect(files.readRunImages).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/chat/runs/{id}/files/{n}/images', () => {
  it('picks another image in the person’s own chat', async () => {
    files.selectRunImage.mockResolvedValue('ok');
    const res = await pick({ image: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, selected: 3 });
    expect(files.selectRunImage).toHaveBeenCalledWith(ACTOR, RUN, 1, 3);
  });

  it('refuses a teammate’s shared chat (403), a set it can’t find (404) and a bad pick (400)', async () => {
    files.selectRunImage.mockResolvedValue('forbidden');
    expect((await pick({ image: 2 })).status).toBe(403);
    files.selectRunImage.mockResolvedValue('not_found');
    expect((await pick({ image: 2 })).status).toBe(404);
    expect((await pick({ image: 0 })).status).toBe(400);
    expect((await pick({ image: '2' })).status).toBe(400);
  });

  it('picks nothing on a read-only workspace', async () => {
    state.refused = true;
    expect((await pick({ image: 2 })).status).toBe(402);
    expect(files.selectRunImage).not.toHaveBeenCalled();
  });
});

describe('GET /api/chat/runs/{id}/files/{n}/images/{image}', () => {
  const get = (image: string, n = '1') =>
    imageRoute.GET(new Request('http://x'), {
      params: Promise.resolve({ id: RUN, n, image }),
    });

  it('shows the image inline in its own type, kept private', async () => {
    files.readRunImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
    });
    const res = await get('2');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Content-Disposition')).toBe('inline');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toMatch(/^private/);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(files.readRunImage).toHaveBeenCalledWith(ACTOR, RUN, 1, 2);
  });

  it('is 404 for an image that isn’t there, or a number that can’t be one', async () => {
    files.readRunImage.mockResolvedValue(null);
    expect((await get('5')).status).toBe(404);
    expect((await get('11')).status).toBe(404);
    expect((await get('x')).status).toBe(404);
    expect(files.readRunImage).toHaveBeenCalledTimes(1);
  });
});
