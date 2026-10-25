import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A page marked Published at its live address (CE-013), by a person or a
 * CMS: the draft, its History version, and a linked action's page and
 * Publish task.
 */

const db = {
  action: null,
  others: [],
  tasks: [],
  writes: [],
  rpcs: [],
};
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const q = { table, filters: [], write: null };
      const result = () => {
        if (q.write) {
          db.writes.push({ table, ...q.write, filters: q.filters });
          return { data: null, error: null };
        }
        if (table === 'actions') return { data: db.action, error: null };
        if (table === 'content_drafts') return { data: db.others, error: null };
        if (table === 'action_tasks') return { data: db.tasks, error: null };
        return { data: null, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (col, value) => (q.filters.push(['eq', col, value]), chain),
        neq: (col, value) => (q.filters.push(['neq', col, value]), chain),
        is: (col, value) => (q.filters.push(['is', col, value]), chain),
        update: (row) => ((q.write = { update: row }), chain),
        insert: (row) => ((q.write = { insert: row }), chain),
        maybeSingle: async () => result(),
        then: (resolve) => resolve(result()),
      };
      return chain;
    },
    rpc: async (fn, args) => {
      db.rpcs.push({ fn, args });
      return { data: 'v1', error: null };
    },
  },
}));

const { liveAddress, markDraftPublished, publishDraft } = await import('./content-published.js');

const URL_LIVE = 'https://www.acme.example/blog/cold-brew';
const draft = (over = {}) => ({ id: 'dr1', brand_id: 'b1', action_id: null, ...over });

beforeEach(() => {
  db.action = null;
  db.others = [];
  db.tasks = [];
  db.writes = [];
  db.rpcs = [];
});

describe('liveAddress', () => {
  it('takes an http(s) address as the browser reads it, without sign-in details', () => {
    expect(liveAddress('  https://Acme.example/blog/x  ')).toBe('https://acme.example/blog/x');
    expect(liveAddress('http://acme.example')).toBe('http://acme.example/');
    expect(liveAddress('ftp://acme.example/x')).toBeNull();
    expect(liveAddress('https://user:pw@acme.example/x')).toBeNull();
    expect(liveAddress('acme.example/x')).toBeNull();
    expect(liveAddress(`https://acme.example/${'a'.repeat(2100)}`)).toBeNull();
    expect(liveAddress(null)).toBeNull();
  });
});

describe('markDraftPublished', () => {
  it('publishes the page at its address and keeps it in History', async () => {
    await markDraftPublished('dr1', URL_LIVE, '2026-10-25T10:00:00Z');
    expect(db.writes).toEqual([
      {
        table: 'content_drafts',
        update: {
          status: 'published',
          published_url: URL_LIVE,
          published_at: '2026-10-25T10:00:00Z',
        },
        filters: [['eq', 'id', 'dr1']],
      },
    ]);
    expect(db.rpcs).toEqual([
      { fn: 'content_draft_snapshot', args: { p_draft_id: 'dr1', p_origin: 'publish' } },
    ]);
  });
});

describe('publishDraft', () => {
  it('publishes a page with no action, and touches no action', async () => {
    const published = await publishDraft(draft(), URL_LIVE, 'u1');
    expect(published).toMatchObject({ publishedUrl: URL_LIVE, taskCompleted: false });
    expect(db.writes.map((w) => w.table)).toEqual(['content_drafts']);
  });

  it('gives a linked action the live page and completes its Publish task, once', async () => {
    db.action = { id: 'a1', payload: { source: 'content_draft', pages: [] } };
    db.tasks = [
      { id: 't1', status: 'todo' },
      { id: 't2', status: 'completed' },
    ];
    const published = await publishDraft(draft({ action_id: 'a1' }), URL_LIVE, 'u1');
    expect(published.taskCompleted).toBe(true);
    const actionWrite = db.writes.find((w) => w.table === 'actions');
    expect(actionWrite.update.payload).toEqual({ source: 'content_draft', pages: [URL_LIVE] });
    expect(db.writes.filter((w) => w.table === 'action_tasks')).toEqual([
      {
        table: 'action_tasks',
        update: { status: 'completed', updated_at: expect.any(String) },
        filters: [['eq', 'id', 't1']],
      },
    ]);
    expect(db.writes.find((w) => w.table === 'action_events').insert).toEqual({
      action_id: 'a1',
      event: 'task_status',
      data: { taskId: 't1', to: 'completed', draftId: 'dr1', publishedUrl: URL_LIVE },
      actor_id: 'u1',
    });

    // Its page already there: the payload isn't written again.
    db.writes = [];
    db.action = { id: 'a1', payload: { pages: [URL_LIVE] } };
    db.tasks = [{ id: 't1', status: 'completed' }];
    expect((await publishDraft(draft({ action_id: 'a1' }), URL_LIVE, 'u1')).taskCompleted).toBe(
      false,
    );
    expect(db.writes.map((w) => w.table)).toEqual(['content_drafts']);
  });

  it('leaves the Publish task while another page of the action isn’t live', async () => {
    db.action = { id: 'a1', payload: { pages: ['https://www.acme.example/a'] } };
    db.others = [{ id: 'dr2' }];
    db.tasks = [{ id: 't1', status: 'todo' }];
    expect((await publishDraft(draft({ action_id: 'a1' }), URL_LIVE, 'u1')).taskCompleted).toBe(
      false,
    );
    expect(db.writes.find((w) => w.table === 'actions').update.payload.pages).toEqual([
      'https://www.acme.example/a',
      URL_LIVE,
    ]);
    expect(db.writes.some((w) => w.table === 'action_tasks')).toBe(false);
  });

  it('leaves a deleted action as it is', async () => {
    db.action = null;
    expect((await publishDraft(draft({ action_id: 'a1' }), URL_LIVE, 'u1')).taskCompleted).toBe(
      false,
    );
    expect(db.writes.map((w) => w.table)).toEqual(['content_drafts']);
  });
});
