import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The editor's writes (CE-004): a save or Mark ready that RLS turns away
 * matches no row without an error, so each reads its row back and says so.
 */

const DRAFT = '2f1d1c52-0f7a-4c1e-9b8a-5d6e7f8a9b0c';

interface Call {
  op: string;
  value?: unknown;
  filters: [string, string, unknown][];
}
let calls: Call[];
// What the next update returns: its row, or none (RLS, or not found).
let updated: Record<string, unknown> | null;
// Or, update by update, when a test needs more than one.
let updates: (Record<string, unknown> | null)[];
let row: Record<string, unknown> | null;

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const call: Call = { op: 'select', filters: [] };
      calls.push(call);
      const result = () =>
        call.op === 'update'
          ? { data: updates.length ? updates.shift()! : updated, error: null }
          : call.op === 'insert'
            ? { data: { id: 'new-draft' }, error: null }
            : { data: row, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (call.filters.push(['eq', col, v]), chain),
        in: (col: string, v: unknown) => (call.filters.push(['in', col, v]), chain),
        update: (value: unknown) => ((call.op = 'update'), (call.value = value), chain),
        insert: (value: unknown) => ((call.op = 'insert'), (call.value = value), chain),
        maybeSingle: async () => result(),
        single: async () => result(),
      };
      return chain;
    },
  })),
}));

const { createContentDraft, getContentDraft, markContentDraftReady, saveContentDraft } =
  await import('./content-drafts');
const { bodyHash } = await import('@/lib/content/editor');

beforeEach(() => {
  calls = [];
  updated = null;
  updates = [];
  row = null;
});

describe('saveContentDraft', () => {
  const LOADED = '<h1>Pipeline</h1>';
  const base = async (html = LOADED) => ({
    updatedAt: '2026-10-20T14:00:00Z',
    bodyHash: await bodyHash(html),
  });

  it('saves the body and the title over the version the editor last saw', async () => {
    updated = { updated_at: '2026-10-20T15:00:00Z' };
    await expect(
      saveContentDraft(DRAFT, {
        title: 'Pipeline forecasting',
        bodyHtml: '<h1>Pipeline forecasting</h1>',
        base: await base(),
      }),
    ).resolves.toEqual({
      ok: true,
      updatedAt: '2026-10-20T15:00:00Z',
      bodyHash: await bodyHash('<h1>Pipeline forecasting</h1>'),
    });
    expect(calls[0]).toMatchObject({
      op: 'update',
      value: { title: 'Pipeline forecasting', body_html: '<h1>Pipeline forecasting</h1>' },
      filters: [
        ['eq', 'id', DRAFT],
        ['eq', 'updated_at', '2026-10-20T14:00:00Z'],
      ],
    });
  });

  it('checks the body against the draft allow-list again before saving it', async () => {
    updated = { updated_at: '2026-10-20T15:00:00Z' };
    const result = await saveContentDraft(DRAFT, {
      title: 'Hi',
      bodyHtml: '<p onclick="steal()">Hi</p><script>alert(1)</script>',
      base: await base(),
    });
    expect(calls[0].value).toEqual({ title: 'Hi', body_html: '<p>Hi</p>' });
    // The fingerprint is of the page as stored.
    expect(result).toMatchObject({ ok: true, bodyHash: await bodyHash('<p>Hi</p>') });
  });

  it('goes over a change to the draft’s other columns, the page being the same', async () => {
    // Marked ready meanwhile: a newer updated_at, the page as the editor saw it.
    updates = [null, { updated_at: '2026-10-20T15:01:00Z' }];
    row = { updated_at: '2026-10-20T14:30:00Z', body_html: LOADED };
    const result = await saveContentDraft(DRAFT, {
      title: 'Pipeline',
      bodyHtml: '<h1>Pipeline</h1><p>More</p>',
      base: await base(),
    });
    expect(result).toMatchObject({ ok: true, updatedAt: '2026-10-20T15:01:00Z' });
    expect(calls.map((c) => c.op)).toEqual(['update', 'select', 'update']);
    expect(calls[2].filters).toContainEqual(['eq', 'updated_at', '2026-10-20T14:30:00Z']);
  });

  it('doesn’t overwrite a page someone else changed', async () => {
    row = { updated_at: '2026-10-20T14:30:00Z', body_html: '<h1>Their version</h1>' };
    await expect(
      saveContentDraft(DRAFT, { title: 'Mine', bodyHtml: '<h1>Mine</h1>', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'conflict' });
    expect(calls.map((c) => c.op)).toEqual(['update', 'select']);
  });

  it('says so when the draft is gone or not the member’s, rather than reporting it saved', async () => {
    await expect(
      saveContentDraft(DRAFT, { title: '', bodyHtml: '', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'not_found' });
  });

  it('says a body over the limit is too large, and refuses a bad title or id, before writing', async () => {
    await expect(
      saveContentDraft(DRAFT, { title: '', bodyHtml: 'x'.repeat(500_001), base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
    await expect(
      saveContentDraft(DRAFT, { title: 'x'.repeat(301), bodyHtml: '', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(
      saveContentDraft('nope', { title: '', bodyHtml: '', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(calls).toEqual([]);
  });
});

describe('markContentDraftReady', () => {
  it('moves a draft or an agent draft in review to ready', async () => {
    updated = { status: 'ready' };
    await expect(markContentDraftReady(DRAFT)).resolves.toBe('ready');
    expect(calls[0]).toMatchObject({
      op: 'update',
      value: { status: 'ready' },
      filters: [
        ['eq', 'id', DRAFT],
        ['in', 'status', ['draft', 'in_review']],
      ],
    });
  });

  it('leaves a published draft published', async () => {
    row = {
      id: DRAFT,
      brand_id: 'b1',
      title: '',
      page_type: null,
      method: 'create',
      status: 'published',
      body_html: '',
      author: 'user',
      updated_at: '2026-10-20T15:00:00Z',
    };
    await expect(markContentDraftReady(DRAFT)).resolves.toBe('published');
  });

  it('says so when the draft isn’t the member’s', async () => {
    await expect(markContentDraftReady(DRAFT)).rejects.toThrow('not_found');
  });
});

describe('getContentDraft and createContentDraft', () => {
  it('reads nothing for a malformed id', async () => {
    await expect(getContentDraft('../etc')).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('starts a blank draft as the signed-in member', async () => {
    await expect(createContentDraft('b1')).resolves.toBe('new-draft');
    expect(calls[0]).toMatchObject({ op: 'insert', value: { brand_id: 'b1', created_by: 'u1' } });
  });
});
