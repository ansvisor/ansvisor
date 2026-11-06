// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An image a message was sent with, shown in its bubble (00409): its bytes
 * inline, private and never sniffed; anything the person can't open, or
 * an id that isn't one, is 404.
 */

const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };
const UPLOAD = '55555555-5555-4555-8555-555555555555';

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/run-api', async (original) => ({
  ...(await original<typeof import('@/lib/chat/run-api')>()),
  chatActor: async () => ACTOR,
}));
const thread = vi.hoisted(() => ({ readSentImage: vi.fn() }));
vi.mock('@/lib/chat/thread', () => thread);

const { GET } = await import('./route');
const get = (id: string) => GET(new Request('http://x'), { params: Promise.resolve({ id }) });

beforeEach(() => thread.readSentImage.mockReset());

describe('GET /api/chat/uploads/{id}', () => {
  it('shows the image inline, in its own format', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    thread.readSentImage.mockResolvedValue({ bytes, mimeType: 'image/png' });
    const res = await get(UPLOAD);
    expect(res.status).toBe(200);
    expect(thread.readSentImage).toHaveBeenCalledWith(ACTOR, UPLOAD);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('is 404 for a file the person can’t open, and for an id that isn’t one', async () => {
    thread.readSentImage.mockResolvedValue(null);
    expect((await get(UPLOAD)).status).toBe(404);
    expect((await get('not-an-id')).status).toBe(404);
    expect(thread.readSentImage).toHaveBeenCalledTimes(1);
  });
});
