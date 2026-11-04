// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * Undo on a version card (CHAT-25 §6, W4-12a): a read-only workspace can't
 * (402) before anything is read; a run, file or version that isn't the
 * person's is 404; a failure is 500 and never throws.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const RUN = '44444444-4444-4444-8444-444444444444';

const state = vi.hoisted(() => ({ refused: false }));
vi.mock('@/lib/subscription-guard', () => ({
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
const versions = vi.hoisted(() => ({ undoPageVersion: vi.fn() }));
vi.mock('@/lib/chat/page-versions', () => versions);

const { POST } = await import('./route');

const params = (n: string, id = RUN) => ({ params: Promise.resolve({ id, n }) });
const post = () => new Request('http://localhost/api', { method: 'POST' });

beforeEach(() => {
  state.refused = false;
  versions.undoPageVersion.mockReset();
});

describe('POST /api/chat/runs/{id}/files/{n}/undo', () => {
  it('puts the page before back', async () => {
    versions.undoPageVersion.mockResolvedValue({ ok: true });
    const res = await POST(post(), params('2'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(versions.undoPageVersion).toHaveBeenCalledWith(ACTOR, RUN, 2);
  });

  it('refuses a read-only workspace before reading anything', async () => {
    state.refused = true;
    expect((await POST(post(), params('2'))).status).toBe(402);
    expect(versions.undoPageVersion).not.toHaveBeenCalled();
  });

  it('is 404 for a bad run or place, and for a version that isn’t there', async () => {
    expect((await POST(post(), params('2', 'not-a-run'))).status).toBe(404);
    expect((await POST(post(), params('0'))).status).toBe(404);
    expect((await POST(post(), params('101'))).status).toBe(404);
    expect(versions.undoPageVersion).not.toHaveBeenCalled();
    versions.undoPageVersion.mockResolvedValue({ ok: false, reason: 'not_found' });
    expect((await POST(post(), params('1'))).status).toBe(404);
  });

  it('answers 500 when the undo fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    versions.undoPageVersion.mockRejectedValue(new Error('boom'));
    expect((await POST(post(), params('2'))).status).toBe(500);
    error.mockRestore();
  });
});
