import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askInOneChat } from './start-chat';

/**
 * A question with one chat (What's new): asked again, it goes on in the
 * person's chat it started, found by the ask-again route; with none, or
 * when that can't be read, it starts a new chat.
 */

let found: { status: number; body: unknown };
let runs: Record<string, unknown>[];

beforeEach(() => {
  runs = [];
  found = { status: 200, body: { ok: true, id: null } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/chat/conversations/ask-again?')) {
        return Response.json(found.body, { status: found.status });
      }
      runs.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('', { status: 200, headers: { 'x-chat-conversation': 'chat-1' } });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('askInOneChat', () => {
  it("goes on in the person's chat the question started, for the brand open", async () => {
    found = { status: 200, body: { ok: true, id: 'chat-7' } };
    expect(await askInOneChat('What’s new?', 'brand-1')).toEqual({ ok: true, chatId: 'chat-1' });
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls[0]).toBe(
      '/api/chat/conversations/ask-again?message=What%E2%80%99s+new%3F&brandId=brand-1',
    );
    expect(runs[0]).toMatchObject({ message: 'What’s new?', conversationId: 'chat-7' });
    expect(runs[0]).not.toHaveProperty('brandId');
  });

  it('starts a new chat when there is none, or it cannot be read', async () => {
    await askInOneChat('What’s new?', 'brand-1');
    found = { status: 500, body: { ok: false } };
    await askInOneChat('What’s new?', null);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ brandId: 'brand-1' });
    expect(runs[0]).not.toHaveProperty('conversationId');
    expect(runs[1]).not.toHaveProperty('conversationId');
  });
});
