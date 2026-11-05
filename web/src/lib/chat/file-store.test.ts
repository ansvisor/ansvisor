// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import { BRAND, ORG, PEOPLE } from './testing/chat-fixtures';
import { unzipSync } from 'fflate';
import { GB, ZIP_MAX_BYTES } from './files';

/**
 * Files on the server (CHAT-06 items 26–37): the storage a workspace's
 * plan and packs allow, an answer read for its downloads, and Save to
 * Files: once per answer, never past the limit, no row without its file.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));
// Files are read as the person: the fake stands in for their client too (no policies here).
vi.mock('@/lib/supabase/server', async () => ({
  createClient: async () => (await import('@/lib/supabase/admin')).supabaseAdmin,
}));
const access = vi.hoisted(() => ({ chat: null as Record<string, unknown> | null }));
vi.mock('./conversations', () => ({ readChat: vi.fn(async () => access.chat) }));
const DRAFT = 'dddddddd-0000-4000-8000-000000000001';
const drafts = vi.hoisted(() => ({ createContentDraft: vi.fn() }));
vi.mock('@/lib/actions/content-drafts', () => drafts);

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase & { storage: unknown };
const store = await import('./file-store');
const { fileChatImages, readChatStorage } = await import('./file-output');

const ACTOR = { userId: PEOPLE.admin, email: null, organizationId: ORG };
const CHAT = 'cccccccc-0000-4000-8000-000000000001';
const RUN = 'aaaaaaaa-0000-4000-8000-000000000001';
const ANSWER = 'aaaaaaaa-0000-4000-8000-0000000000a2';

let uploads: { path: string; size: number }[];
let stored: Record<string, string>;
let uploadError: { message: string } | null;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  uploads = [];
  stored = {};
  uploadError = null;
  drafts.createContentDraft.mockReset().mockResolvedValue(DRAFT);
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  db.storage = {
    from: () => ({
      upload: async (path: string, body: Uint8Array) => {
        if (uploadError) return { error: uploadError };
        uploads.push({ path, size: body.byteLength });
        return { error: null };
      },
      download: async (path: string) =>
        path in stored
          ? { data: new Blob([stored[path]]), error: null }
          : { data: null, error: { message: 'missing' } },
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
    expect(await readChatStorage(ORG)).toEqual({
      usedBytes: GB,
      fileCount: 3,
      limitBytes: 50 * GB,
    });
  });

  it('keeps the free trial to 1 GB', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    expect((await readChatStorage(ORG)).limitBytes).toBe(GB);
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

describe('answerToDraft', () => {
  it('makes the answer a Content draft in the chat’s brand, marked on its file', async () => {
    await store.saveRunAnswer(ACTOR, RUN);
    expect(await store.answerToDraft(ACTOR, RUN, null)).toEqual({ draftId: DRAFT });
    const [brandId, start] = drafts.createContentDraft.mock.calls[0];
    expect(brandId).toBe(BRAND);
    expect(start).toMatchObject({
      method: 'create',
      title: 'Why did citations drop?',
      source: { kind: 'content' },
    });
    expect(start.bodyHtml).toContain('<table>');
    expect(db.tables.chat_files[0].content_draft_id).toBe(DRAFT);
  });

  it('keeps an answer’s images as their alt text and its raw HTML as text, as the answer shows them', async () => {
    db.tables.chat_messages[1].content_md =
      'See ![the chart](https://example.com/c.png?d=1) and [the page](https://example.com/p).\n\n<img src="https://example.com/x.png">\n';
    await store.answerToDraft(ACTOR, RUN, null);
    const html = drafts.createContentDraft.mock.calls[0][1].bodyHtml as string;
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('the chart');
    expect(html).toContain('&lt;img src=');
    expect(html).toContain('<a href="https://example.com/p">the page</a>');
  });

  it('takes the brand open for a chat about none, and asks for one without it', async () => {
    db.tables.chat_conversations[0].brand_id = null;
    const other = '33333333-3333-4333-8333-333333333333';
    await store.answerToDraft(ACTOR, RUN, other);
    expect(drafts.createContentDraft.mock.calls[0][0]).toBe(other);
    expect(await store.answerToDraft(ACTOR, RUN, null)).toEqual({ failure: 'no_brand' });
    access.chat = null;
    expect(await store.answerToDraft(ACTOR, RUN, other)).toEqual({ failure: 'not_found' });
  });
});

describe('readRunFile', () => {
  it('reads the run’s n-th deliverable from Files, never an answer saved to it', async () => {
    db.tables.chat_files = [
      {
        id: 'saved',
        organization_id: ORG,
        run_id: RUN,
        message_id: ANSWER,
        title: 'The answer',
        mime_type: 'text/markdown',
        formats: ['md'],
        storage_path: 'saved.md',
        generated_at: '2026-10-30T09:01:00.000Z',
        data_as_of: null,
        timezone: 'UTC',
        created_at: '2026-10-30T09:01:00.000Z',
      },
      {
        id: 'made',
        organization_id: ORG,
        run_id: RUN,
        message_id: null,
        title: 'Pricing FAQ',
        mime_type: 'text/html',
        formats: ['html', 'md'],
        storage_path: 'page.html',
        generated_at: '2026-10-30T09:01:00.000Z',
        data_as_of: null,
        timezone: 'UTC',
        created_at: '2026-10-30T09:01:00.000Z',
      },
    ];
    stored['page.html'] = '<h1>Pricing FAQ</h1>';
    expect(await store.readRunFile(ACTOR, RUN, 1, null)).toMatchObject({
      title: 'Pricing FAQ',
      mimeType: 'text/html',
      content: '<h1>Pricing FAQ</h1>',
      stamp: 'Generated Oct 30, 2026 · 09:01 GMT+0',
    });
    expect(await store.readRunFile(ACTOR, RUN, 2, null)).toBeNull();
    access.chat = null;
    expect(await store.readRunFile(ACTOR, RUN, 1, null)).toBeNull();
  });
});

/** A file in Files: an answer saved as Markdown, unless told otherwise. */
const fileRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  run_id: RUN,
  message_id: ANSWER,
  title: 'Why citations dropped',
  mime_type: 'text/markdown',
  formats: ['md', 'docx', 'pdf'],
  storage_path: `${id}.md`,
  size_bytes: 120,
  generated_at: '2026-10-30T09:01:00.000Z',
  data_as_of: null,
  timezone: 'UTC',
  created_at: '2026-10-30T09:01:00.000Z',
  ...extra,
});

describe('readChatFile', () => {
  it('reads a file of the person’s workspace, and nothing of another', async () => {
    db.tables.chat_files = [fileRow('f1'), fileRow('f2', { organization_id: 'other-org' })];
    stored['f1.md'] = 'Two pages lost most of it.';
    stored['f2.md'] = 'Not yours.';
    expect(await store.readChatFile(ACTOR, 'f1', null)).toMatchObject({
      title: 'Why citations dropped',
      content: 'Two pages lost most of it.',
      stamp: 'Generated Oct 30, 2026 · 09:01 GMT+0',
    });
    expect(await store.readChatFile(ACTOR, 'f2', null)).toBeNull();
  });
});

describe('zipChatFiles', () => {
  it('zips the picked files in their main format, two of a name kept apart', async () => {
    db.tables.chat_files = [
      fileRow('f1'),
      fileRow('f2', { created_at: '2026-10-30T09:02:00.000Z' }),
      fileRow('f3', { organization_id: 'other-org' }),
    ];
    stored['f1.md'] = 'First.';
    stored['f2.md'] = 'Second.';
    stored['f3.md'] = 'Not yours.';
    const zip = await store.zipChatFiles(ACTOR, ['f1', 'f2', 'f3'], null);
    if (!zip.ok) throw new Error(zip.failure);
    expect(zip.count).toBe(2);
    expect(zip.fileName).toMatch(/^files-\d{4}-\d{2}-\d{2}\.zip$/);
    // Streamed to its end: a whole .zip, with each file in it.
    const body = new Uint8Array(await new Response(zip.stream).arrayBuffer());
    const files = unzipSync(body);
    expect(new TextDecoder().decode(files['why-citations-dropped-2026-10-30.md'])).toContain(
      'Second.',
    );
    const names = Object.keys(files);
    expect(names).toEqual([
      'why-citations-dropped-2026-10-30.md',
      'why-citations-dropped-2026-10-30 (2).md',
    ]);
  });

  it('refuses past 100 MB before reading anything, and none of the workspace’s', async () => {
    db.tables.chat_files = [fileRow('f1', { size_bytes: ZIP_MAX_BYTES + 1 })];
    expect(await store.zipChatFiles(ACTOR, ['f1'], null)).toEqual({
      ok: false,
      failure: 'too_big',
    });
    expect(await store.zipChatFiles(ACTOR, ['nope'], null)).toEqual({
      ok: false,
      failure: 'not_found',
    });
  });
});

describe('a set of images Chat made (W4-08, CHAT-15 items 22, 24)', () => {
  let objects: Map<string, Uint8Array>;
  const jpeg = (byte: number, size = 10) => ({
    bytes: new Uint8Array(size).fill(byte),
    mimeType: 'image/jpeg',
  });
  const file = (images: ReturnType<typeof jpeg>[]) =>
    fileChatImages({
      organizationId: ORG,
      createdBy: PEOPLE.admin,
      brandId: BRAND,
      title: 'Cover image · GEO 2026',
      images,
      origin: 'chat',
      conversationId: CHAT,
      messageId: null,
      runId: RUN,
      generatedAt: '2026-11-03T10:00:00.000Z',
      dataAsOf: null,
      timezone: null,
    });

  beforeEach(() => {
    objects = new Map();
    db.storage = {
      from: () => ({
        upload: async (path: string, body: Uint8Array) => {
          if (uploadError && path.endsWith('image-2.jpg')) return { error: uploadError };
          objects.set(path, body);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const path of paths) objects.delete(path);
          return { error: null };
        },
        list: async (folder: string) => ({
          data: [...objects.keys()]
            .filter((path) => path.startsWith(`${folder}/`))
            .map((path) => ({ name: path.slice(folder.length + 1) })),
          error: null,
        }),
        download: async (path: string) =>
          objects.has(path)
            ? {
                data: new Blob([objects.get(path)! as BlobPart], { type: 'image/jpeg' }),
                error: null,
              }
            : { data: null, error: { message: 'missing' } },
      }),
    };
  });

  it('files one row for the set, its first image selected, every image counted in storage', async () => {
    const filed = await file([jpeg(1), jpeg(2, 20), jpeg(3), jpeg(4)]);
    if (!filed.ok) throw new Error(filed.failure);
    expect(db.tables.chat_files).toHaveLength(1);
    expect(db.tables.chat_files[0]).toMatchObject({
      id: filed.id,
      type: 'image',
      formats: ['jpg'],
      mime_type: 'image/jpeg',
      storage_path: `${ORG}/${filed.id}/image-1.jpg`,
      size_bytes: 50,
      run_id: RUN,
      message_id: null,
      origin: 'chat',
    });
    expect([...objects.keys()].sort()).toEqual(
      [1, 2, 3, 4].map((n) => `${ORG}/${filed.id}/image-${n}.jpg`),
    );
  });

  it('files nothing without room for every image, and nothing half-kept', async () => {
    db.tables.chat_storage_usage = [{ organization_id: ORG, bytes_used: 50 * GB - 30 }];
    expect(await file([jpeg(1), jpeg(2, 30)])).toEqual({ ok: false, failure: 'storage_full' });
    expect(db.tables.chat_files).toEqual([]);

    db.tables.chat_storage_usage = [];
    uploadError = { message: 'boom' };
    expect(await file([jpeg(1), jpeg(2)])).toEqual({ ok: false, failure: 'failed' });
    expect(db.tables.chat_files).toEqual([]);
    expect(objects.size).toBe(0);
  });

  it('lists, shows and picks the set’s images in the person’s own chat', async () => {
    const filed = await file([jpeg(1), jpeg(2), jpeg(3)]);
    if (!filed.ok) throw new Error(filed.failure);
    expect(await store.readRunImages(ACTOR, RUN, 1)).toEqual({
      count: 3,
      selected: 1,
      mine: true,
    });
    const second = await store.readRunImage(ACTOR, RUN, 1, 2);
    expect(second?.mimeType).toBe('image/jpeg');
    expect([...(second?.bytes ?? [])]).toEqual(new Array(10).fill(2));
    expect(await store.readRunImage(ACTOR, RUN, 1, 4)).toBeNull();

    expect(await store.selectRunImage(ACTOR, RUN, 1, 3)).toBe('ok');
    expect(db.tables.chat_files[0].storage_path).toBe(`${ORG}/${filed.id}/image-3.jpg`);
    expect(await store.readRunImages(ACTOR, RUN, 1)).toMatchObject({ selected: 3 });
    // Files downloads the selected one, in its own format, named after its title.
    const download = await store.readChatFile(ACTOR, filed.id, null);
    const { exportChatFile } = await import('./file-export');
    const out = await exportChatFile(download!, 'jpg');
    expect(out).toMatchObject({
      fileName: 'cover-image-geo-2026-2026-11-03.jpg',
      contentType: 'image/jpeg',
    });
    expect([...out!.body]).toEqual(new Array(10).fill(3));
    expect(await exportChatFile(download!, 'md')).toBeNull();
  });

  it('keeps the picked image’s own type in a set that mixes them', async () => {
    const filed = await file([
      jpeg(1),
      { bytes: new Uint8Array(4).fill(9), mimeType: 'image/png' },
    ]);
    if (!filed.ok) throw new Error(filed.failure);
    expect((await store.readRunImage(ACTOR, RUN, 1, 2))?.mimeType).toBe('image/png');
    expect(await store.selectRunImage(ACTOR, RUN, 1, 2)).toBe('ok');
    expect(db.tables.chat_files[0]).toMatchObject({
      storage_path: `${ORG}/${filed.id}/image-2.png`,
      mime_type: 'image/png',
      formats: ['png'],
    });
  });

  it('lets a teammate see a shared chat’s set but not pick, and nobody else see it', async () => {
    const filed = await file([jpeg(1), jpeg(2)]);
    if (!filed.ok) throw new Error(filed.failure);
    access.chat = { id: CHAT, title: 'Citations drop', mine: false };
    expect(await store.readRunImages(ACTOR, RUN, 1)).toMatchObject({ mine: false });
    expect(await store.selectRunImage(ACTOR, RUN, 1, 2)).toBe('forbidden');
    expect(db.tables.chat_files[0].storage_path).toMatch(/image-1\.jpg$/);
    access.chat = null;
    expect(await store.readRunImages(ACTOR, RUN, 1)).toBeNull();
    expect(await store.readRunImage(ACTOR, RUN, 1, 1)).toBeNull();
    expect(await store.selectRunImage(ACTOR, RUN, 1, 1)).toBe('not_found');
  });

  it('reads no set from a file that isn’t images', async () => {
    db.tables.chat_files = [
      fileRow('f1', { run_id: RUN, message_id: null, storage_path: 'f1.md' }),
    ];
    expect(await store.readRunImages(ACTOR, RUN, 1)).toBeNull();
  });
});
