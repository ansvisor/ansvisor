// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from './testing/fake-supabase';

/**
 * A page's version in a chat (CHAT-25 §6, W4-12a): numbered after the
 * versions this chat filed of it, what changed since the page before, and
 * Undo, which only the chat's own person can use and which puts back the
 * History version the run kept for that card.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  restored: [] as [string, string][],
  restoreError: null as Error | null,
}));
vi.mock('@/lib/supabase/admin', () => ({
  get supabaseAdmin() {
    return fake.db;
  },
}));
vi.mock('@/lib/actions/content-drafts', () => ({
  restoreDraftVersion: async (draftId: string, versionId: string) => {
    if (fake.restoreError) throw fake.restoreError;
    fake.restored.push([draftId, versionId]);
  },
}));

const { readPageVersion, undoPageVersion } = await import('./page-versions');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const BEFORE = '55555555-5555-4555-8555-555555555555';
const RUN = '66666666-6666-4666-8666-666666666666';

const V1 =
  '<h2>Can I change plans?</h2><p>Yes, you can move to another plan at any time from Billing.</p>';
const V2 =
  '<h2>Can I change plans?</h2><p>Yes, any time.</p><h2>Can I get a refund?</h2><p>Within [REFUND PERIOD].</p>';

beforeEach(() => {
  fake.db = createFakeSupabase();
  fake.restored = [];
  fake.restoreError = null;
  fake.db.tables.content_drafts = [{ id: DRAFT, title: 'FAQ: Pricing', body_html: V2 }];
  fake.db.tables.content_draft_versions = [{ id: BEFORE, draft_id: DRAFT, body_html: V1 }];
  fake.db.tables.chat_files = [];
});

const filed = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  conversation_id: CHAT,
  run_id: RUN,
  message_id: null,
  content_draft_id: DRAFT,
  created_at: `2026-11-03T09:00:0${id.slice(-1)}.000Z`,
  ...extra,
});

describe('a page version in chat (W4-12a)', () => {
  it('makes a new page version 1, with only its placeholders and no Undo', async () => {
    const read = await readPageVersion({ draftId: DRAFT, conversationId: CHAT });
    expect(read?.title).toBe('FAQ: Pricing');
    expect(read?.undoVersionId).toBeNull();
    expect(read?.version).toMatchObject({
      n: 1,
      counts: { questions: 2, sections: 2 },
      changes: { shortened: [], added: [], placeholders: ['[REFUND PERIOD]'] },
    });
    expect(read?.version.canUndo).toBeUndefined();
  });

  it('numbers a change after the versions this chat filed, with what changed and Undo', async () => {
    fake.db.tables.chat_files = [filed('f1')];
    const read = await readPageVersion({
      draftId: DRAFT,
      conversationId: CHAT,
      beforeVersionId: BEFORE,
    });
    expect(read?.version.n).toBe(2);
    expect(read?.version.changes.shortened).toEqual([
      { heading: 'Can I change plans?', before: expect.any(Number), after: 14 },
    ]);
    expect(read?.version.changes.added).toEqual(['Can I get a refund?']);
    expect(read?.version.canUndo).toBe(true);
    expect(read?.undoVersionId).toBe(BEFORE);
  });

  it('counts a Library page Chat changes first as version 1, so the change is version 2', async () => {
    const read = await readPageVersion({
      draftId: DRAFT,
      conversationId: CHAT,
      beforeVersionId: BEFORE,
    });
    expect(read?.version.n).toBe(2);
  });

  it('reads nothing for a page that is gone', async () => {
    fake.db.tables.content_drafts = [];
    expect(await readPageVersion({ draftId: DRAFT, conversationId: CHAT })).toBeNull();
  });
});

describe('Undo on a version card (W4-12a)', () => {
  const actor = { userId: USER, organizationId: ORG };

  beforeEach(() => {
    fake.db.tables.chat_runs = [{ id: RUN, conversation_id: CHAT }];
    fake.db.tables.chat_conversations = [{ id: CHAT, user_id: USER, organization_id: ORG }];
    fake.db.tables.chat_files = [filed('f1'), filed('f2')];
    fake.db.tables.chat_run_state = [
      { run_id: RUN, progress: { pageUndos: { f2: { draftId: DRAFT, versionId: BEFORE } } } },
    ];
  });

  it('puts back the History version the run kept for the n-th file', async () => {
    expect(await undoPageVersion(actor, RUN, 2)).toEqual({ ok: true });
    expect(fake.restored).toEqual([[DRAFT, BEFORE]]);
  });

  it('finds nothing for a file without a version before it, or past the last', async () => {
    expect(await undoPageVersion(actor, RUN, 1)).toEqual({ ok: false, reason: 'not_found' });
    expect(await undoPageVersion(actor, RUN, 3)).toEqual({ ok: false, reason: 'not_found' });
    expect(fake.restored).toEqual([]);
  });

  it('finds nothing in someone else’s chat, or another workspace', async () => {
    const other = '77777777-7777-4777-8777-777777777777';
    expect(await undoPageVersion({ ...actor, userId: other }, RUN, 2)).toMatchObject({
      ok: false,
    });
    expect(await undoPageVersion({ ...actor, organizationId: other }, RUN, 2)).toMatchObject({
      ok: false,
    });
    expect(fake.restored).toEqual([]);
  });

  it('finds nothing when History no longer has that version', async () => {
    fake.restoreError = new Error('not_found');
    expect(await undoPageVersion(actor, RUN, 2)).toEqual({ ok: false, reason: 'not_found' });
  });
});
