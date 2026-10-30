// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import { BRAND, ORG, PEOPLE } from './testing/chat-fixtures';
import { GB } from './files';

/**
 * Files on the server (CHAT-06 items 26–37): the storage a workspace's
 * plan and packs allow, an answer read for its downloads, and Save to
 * Files: once per answer, never past the limit, no row without its file.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const access = vi.hoisted(() => ({ chat: null as Record<string, unknown> | null }));
vi.mock('./conversations', () => ({ readChat: vi.fn(async () => access.chat) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase & { storage: unknown };
const store = await import('./file-store');

const ACTOR = { userId: PEOPLE.admin, email: null, organizationId: ORG };
const CHAT = 'cccccccc-0000-4000-8000-000000000001';
const RUN = 'aaaaaaaa-0000-4000-8000-000000000001';
const ANSWER = 'aaaaaaaa-0000-4000-8000-0000000000a2';

let uploads: { path: string; size: number }[];
let uploadError: { message: string } | null;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  uploads = [];
  uploadError = null;
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  db.storage = {
    from: () => ({
      upload: async (path: string, body: Uint8Array) => {
        if (uploadError) return { error: uploadError };
        uploads.push({ path, size: body.byteLength });
        return { error: null };
      },
    }),
  };
  access.chat = { id: CHAT, title: 'Citations drop', mine: true };
  db.tables = {
    organizations: [
      { id: ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
    ],
    chat_storage_usage: [],
    storage_grants: [],
    chat_files: [],
    chat_conversations: [{ id: CHAT, brand_id: BRAND }],
    chat_runs: [{ id: RUN, message_id: ANSWER, conversation_id: CHAT }],
    chat_messages: [
      {
        id: 'q1',
        conversation_id: CHAT,
        role: 'user',
        content_md: 'Why did citations drop?',
        created_at: '2026-10-30T09:00:00.000Z',
      },
      {
        id: ANSWER,
        conversation_id: CHAT,
        role: 'assistant',
        content_md: 'Two pages lost most of it.\n\n| Page | Lost |\n|---|---|\n| /a | 14 |',
        generated_at: '2026-10-30T09:01:00.000Z',
        data_as_of: null,
        timezone: 'UTC',
        created_at: '2026-10-30T09:00:30.000Z',
      },
    ],
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

describe('readChatStorage', () => {
  it('reads the plan’s GB plus the storage packs still paid for', async () => {
    db.tables.chat_storage_usage = [{ organization_id: ORG, bytes_used: GB, file_count: 3 }];
    db.tables.storage_grants = [
      { organization_id: ORG, bytes: 25 * GB, active_until: '2999-01-01T00:00:00.000Z' },
      { organization_id: ORG, bytes: 100 * GB, active_until: '2020-01-01T00:00:00.000Z' },
    ];
    expect(await store.readChatStorage(ORG)).toEqual({
      usedBytes: GB,
      fileCount: 3,
      limitBytes: 50 * GB,
    });
  });

  it('keeps the free trial to 1 GB', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    expect((await store.readChatStorage(ORG)).limitBytes).toBe(GB);
  });
});

describe('readRunAnswer', () => {
  it('reads the answer under the question before it, with its time line', async () => {
    const read = await store.readRunAnswer(ACTOR, RUN, 'https://app.example');
    expect(read).toMatchObject({
      messageId: ANSWER,
      conversationId: CHAT,
      brandId: BRAND,
      answer: {
        question: 'Why did citations drop?',
        chatTitle: 'Citations drop',
        stamp: 'Generated Oct 30, 2026 · 09:01 GMT+0',
        appOrigin: 'https://app.example',
      },
    });
  });

  it('reads nothing of a chat the person can’t open', async () => {
    access.chat = null;
    expect(await store.readRunAnswer(ACTOR, RUN, null)).toBeNull();
  });
});

describe('saveRunAnswer', () => {
  it('files the answer once, as a document with its formats, and keeps its Markdown', async () => {
    const saved = await store.saveRunAnswer(ACTOR, RUN);
    expect(saved).toMatchObject({
      ok: true,
      already: false,
      file: { title: 'Why did citations drop?' },
    });
    expect(db.tables.chat_files).toHaveLength(1);
    const row = db.tables.chat_files[0];
    expect(row).toMatchObject({
      organization_id: ORG,
      brand_id: BRAND,
      created_by: PEOPLE.admin,
      type: 'document',
      formats: ['md', 'docx', 'pdf', 'csv', 'xlsx'],
      mime_type: 'text/markdown',
      origin: 'chat',
      conversation_id: CHAT,
      message_id: ANSWER,
      run_id: RUN,
    });
    expect(uploads).toEqual([{ path: `${ORG}/${row.id}/answer.md`, size: row.size_bytes }]);

    // Again: its file, nothing new.
    expect(await store.saveRunAnswer(ACTOR, RUN)).toMatchObject({ ok: true, already: true });
    expect(db.tables.chat_files).toHaveLength(1);
  });

  it('files nothing in a full workspace', async () => {
    db.tables.chat_storage_usage = [{ organization_id: ORG, bytes_used: 25 * GB, file_count: 9 }];
    expect(await store.saveRunAnswer(ACTOR, RUN)).toEqual({ ok: false, failure: 'storage_full' });
    expect(db.tables.chat_files).toHaveLength(0);
  });

  it('leaves no row when the file doesn’t go up, and nothing for a chat it can’t open', async () => {
    uploadError = { message: 'bucket down' };
    expect(await store.saveRunAnswer(ACTOR, RUN)).toEqual({ ok: false, failure: 'failed' });
    expect(db.tables.chat_files).toHaveLength(0);
    access.chat = null;
    expect(await store.saveRunAnswer(ACTOR, RUN)).toEqual({ ok: false, failure: 'not_found' });
  });
});

describe('readChatExport', () => {
  it('writes the whole chat, each question under “You”', async () => {
    const chat = await store.readChatExport(ACTOR, CHAT, null);
    expect(chat?.markdown).toBe(
      '## You\n\nWhy did citations drop?\n\nTwo pages lost most of it.\n\n| Page | Lost |\n|---|---|\n| /a | 14 |',
    );
    expect(chat?.question).toBe('Citations drop');
  });
});
