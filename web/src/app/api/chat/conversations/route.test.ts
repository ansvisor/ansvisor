// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The chats API (CHAT-01 §1–3, 7–8, 26): not there while the new Chat is off
 * for the workspace; a bad query or chat id is refused as a value (#1777),
 * never thrown; a chat the person can't open, or a deleted one, is 404.
 */

const state = vi.hoisted(() => ({ on: true }));
const ACTOR = { userId: 'user-1', email: null, organizationId: 'org-1' };

vi.mock('@/lib/chat/run-api', async (original) => {
  const actual = await original<typeof import('@/lib/chat/run-api')>();
  return {
    ...actual,
    chatActor: async () =>
      state.on ? ACTOR : actual.runFailure(404, 'not_found', 'not_found', 'Not found'),
  };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/engine', () => ({ driveRun: vi.fn(), stopChatRun: vi.fn() }));
vi.mock('@/lib/chat/conversations', async (original) => {
  const actual = await original<typeof import('@/lib/chat/conversations')>();
  return {
    ...actual,
    listChats: vi.fn(async () => ({ chats: [], total: 0, archived: 0 })),
    readChat: vi.fn(async () => null),
    deleteChat: vi.fn(async () => ({ ok: false, reason: 'not_found' })),
  };
});
vi.mock('@/lib/chat/thread', () => ({ loadChatThread: vi.fn(async () => null) }));

const list = await import('./route');
const one = await import('./[id]/route');
const { listChats } = await import('@/lib/chat/conversations');

const ID = 'cccccccc-0000-4000-8000-000000000001';
const params = (id: string) => ({ params: Promise.resolve({ id }) });

afterEach(() => {
  state.on = true;
});

describe('/api/chat/conversations', () => {
  it('is not there while the new Chat is off', async () => {
    state.on = false;
    const res = await list.GET(new Request('https://app.example.com/api/chat/conversations'));
    expect(res.status).toBe(404);
    expect(listChats).not.toHaveBeenCalled();
  });

  it('lists with the defaults, and refuses a bad query as a value', async () => {
    const ok = await list.GET(new Request('https://app.example.com/api/chat/conversations'));
    expect(await ok.json()).toEqual({ ok: true, chats: [], total: 0, archived: 0 });
    expect(listChats).toHaveBeenCalledWith({}, ACTOR, { view: 'active', limit: 100 });
    const bad = await list.GET(
      new Request('https://app.example.com/api/chat/conversations?view=deleted'),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, failure: 'failed' });
  });

  it('refuses a bad body when starting a chat', async () => {
    const res = await list.POST(
      new Request('https://app.example.com/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ brandId: 'not-a-uuid' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("answers 404 for a chat that isn't there, a bad id, or one it can't delete", async () => {
    const req = new Request('https://app.example.com/api/chat/conversations/x');
    expect((await one.GET(req, params(ID))).status).toBe(404);
    expect((await one.GET(req, params('../x'))).status).toBe(404);
    expect((await one.DELETE(req, params(ID))).status).toBe(404);
  });
});
