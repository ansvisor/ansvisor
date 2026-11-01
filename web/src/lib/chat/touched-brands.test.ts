// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * The brands a chat touched (BRAND-ACCESS §10, 00436): a call's brand, or
 * every brand the person can access for a read that lists them (the whole
 * workspace for All brands), noted before the call runs; a new chat starts
 * from its own brand. A database before 00436 notes nothing, quietly.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => fake.db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => fake.db.rpc(name, args),
  },
}));

const { createFakeSupabase } = await import('@/lib/chat/testing/fake-supabase');
const { noteTouchedBrands, startTouchedBrands, touchedByCall } = await import('./touched-brands');

const CHAT = 'chat-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const SHARED = '22222222-2222-4222-8222-222222222222';

/**
 * The two functions as 00436 writes them, on the fake's chat rows: a start
 * only while the set isn't kept yet and nothing is in the chat; a note adds
 * to a kept set, and the whole workspace makes it not known.
 */
function seed(db: FakeSupabase) {
  db.tables.chat_conversations = [{ id: CHAT, brand_id: BRAND, touched_brand_ids: null }];
  db.tables.chat_messages = [];
  db.rpcs.chat_start_touched_brands = ({ p_conversation_id }) => {
    const chat = db.tables.chat_conversations.find((c) => c.id === p_conversation_id);
    const empty = !db.tables.chat_messages.some((m) => m.conversation_id === p_conversation_id);
    if (chat && chat.touched_brand_ids === null && empty) {
      chat.touched_brand_ids = chat.brand_id ? [chat.brand_id] : [];
    }
  };
  db.rpcs.chat_note_touched_brands = ({ p_conversation_id, p_brand_ids, p_whole_workspace }) => {
    const chat = db.tables.chat_conversations.find((c) => c.id === p_conversation_id);
    if (!chat || chat.touched_brand_ids === null) return;
    chat.touched_brand_ids = p_whole_workspace
      ? null
      : [
          ...new Set([...(chat.touched_brand_ids as string[]), ...(p_brand_ids as string[])]),
        ].sort();
  };
}

const touched = () => fake.db.tables.chat_conversations[0].touched_brand_ids;

beforeEach(() => {
  fake.db = createFakeSupabase();
  seed(fake.db);
});
afterEach(() => vi.restoreAllMocks());

describe('touchedByCall', () => {
  it("is the call's brand, else nothing for a read about no brand", () => {
    expect(touchedByCall({}, BRAND, 'all')).toEqual([BRAND]);
    expect(touchedByCall({ namesBrands: true }, BRAND, [SHARED])).toEqual([BRAND]);
    expect(touchedByCall({}, null, 'all')).toEqual([]);
  });

  it('is every brand the person can access for a read that lists them: all of them, the workspace', () => {
    expect(touchedByCall({ namesBrands: true }, null, 'all')).toBe('workspace');
    expect(touchedByCall({ namesBrands: true }, null, [BRAND, SHARED])).toEqual([BRAND, SHARED]);
    expect(touchedByCall({ namesBrands: true }, null, null)).toEqual([]);
  });
});

describe('startTouchedBrands and noteTouchedBrands', () => {
  it("keep a new chat's brands from its own, adding each call's", async () => {
    await startTouchedBrands(CHAT);
    expect(touched()).toEqual([BRAND]);
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(true);
    expect(await noteTouchedBrands(CHAT, [BRAND])).toBe(true);
    expect(touched()).toEqual([BRAND, SHARED]);
  });

  it('never start a chat that already holds something, which stays not known', async () => {
    fake.db.tables.chat_messages.push({ conversation_id: CHAT });
    await startTouchedBrands(CHAT);
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(true);
    expect(touched()).toBeNull();
  });

  it('make the set not known for good once a call listed the whole workspace', async () => {
    await startTouchedBrands(CHAT);
    expect(await noteTouchedBrands(CHAT, 'workspace')).toBe(true);
    expect(touched()).toBeNull();
    await noteTouchedBrands(CHAT, [SHARED]);
    expect(touched()).toBeNull();
  });

  it('ask nothing of the database for a call that touches no brand', async () => {
    expect(await noteTouchedBrands(CHAT, [])).toBe(true);
    expect(fake.db.log).toEqual([]);
  });

  it('note nothing, quietly, on a database before 00436', async () => {
    delete fake.db.rpcs.chat_start_touched_brands;
    delete fake.db.rpcs.chat_note_touched_brands;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startTouchedBrands(CHAT);
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(true);
    expect(touched()).toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('refuse the call when its note fails, and log a start that fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = { code: '57014', message: 'timeout' };
    vi.spyOn(fake.db, 'rpc').mockResolvedValue({ data: null, error: failing });
    expect(await noteTouchedBrands(CHAT, [SHARED])).toBe(false);
    await startTouchedBrands(CHAT);
    expect(error).toHaveBeenCalledTimes(2);
  });
});
