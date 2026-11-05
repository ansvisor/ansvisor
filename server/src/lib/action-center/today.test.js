import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { NEXT_ITEMS, TODAY_ITEMS, readToday, todaysSuggestion } = await import('./today.js');
const { pickSuggestion } = await import('../chat-suggestions/rules.js');

/**
 * The Today card's order (AC-011): the Inbox's ranking (CHAT-26, rules.js
 * rankActions), with the person's suggestion for today first, against an
 * in-memory database that reads as PostgREST does for these queries.
 */

const NOW = new Date('2026-10-30T09:30:00Z');
const DAY = 86_400_000;
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

const ORG = '11111111-1111-1111-1111-111111111111';
const BRAND = '22222222-2222-2222-2222-222222222222';
const ME = 'u1';

const get = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);

function fakeDb(tables) {
  const db = {
    reads: [],
    fail: null,
    from(table) {
      db.reads.push(table);
      const filters = [];
      const orders = [];
      let limit = Infinity;
      const keep = (row) => filters.every((test) => test(row));
      const run = () => {
        if (db.fail === table) return { data: null, error: { code: '57014' } };
        const found = (tables[table] ?? []).filter(keep).map((row) => ({ ...row }));
        for (const { column, ascending } of [...orders].reverse()) {
          found.sort((a, b) => {
            const x = get(a, column) ?? null;
            const y = get(b, column) ?? null;
            if (x === y) return 0;
            if (x === null) return 1;
            if (y === null) return -1;
            return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          });
        }
        return { data: found.slice(0, limit), error: null };
      };
      const chain = {
        select: () => chain,
        eq: (column, value) => (filters.push((row) => get(row, column) === value), chain),
        in: (column, values) => (filters.push((row) => values.includes(get(row, column))), chain),
        is: (column, value) => (filters.push((row) => (get(row, column) ?? null) === value), chain),
        not: (column, _op, value) => (
          filters.push((row) => (get(row, column) ?? null) !== value),
          chain
        ),
        gte: (column, value) => (filters.push((row) => get(row, column) >= value), chain),
        order: (column, { ascending = true } = {}) => (orders.push({ column, ascending }), chain),
        limit: (n) => ((limit = n), chain),
        maybeSingle: async () => {
          const { data, error } = run();
          return { data: data?.[0] ?? null, error };
        },
        then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
      };
      return chain;
    },
  };
  return db;
}

function action(id, overrides = {}) {
  return {
    id,
    brand_id: BRAND,
    category: 'growth',
    status: 'new',
    priority_score: 60,
    created_at: NOW.toISOString(),
    assignee_id: null,
    deleted_at: null,
    ...overrides,
  };
}

/** Twelve open actions, scored 90 down to 35: a-l, best first. */
const twelve = () =>
  'abcdefghijkl'.split('').map((id, i) => action(id, { priority_score: 90 - i * 5 }));

function suggestion(actionId, overrides = {}) {
  return {
    user_id: ME,
    brand_id: BRAND,
    action_id: actionId,
    sent_on: '2026-10-30',
    snoozed_until: null,
    removed_at: null,
    ...overrides,
  };
}

const read = (db) => readToday(db, { orgId: ORG, brandId: BRAND, userId: ME, now: NOW });
// Today and the Next 7 under it, in order.
const ids = (result) => [...result.today, ...result.next].map((item) => item.id);
const suggestedIds = (result) =>
  result.today.filter((item) => item.suggested).map((item) => item.id);

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readToday', () => {
  it('lists the best three for today and the next seven, as the Inbox ranks them', async () => {
    const db = fakeDb({ actions: twelve(), profiles: [{ id: ME, time_zone: 'UTC' }] });
    const result = await read(db);
    expect([TODAY_ITEMS, NEXT_ITEMS]).toEqual([3, 7]);
    expect(result.today.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(ids(result)).toEqual('abcdefghij'.split(''));
    expect(suggestedIds(result)).toEqual([]);
  });

  it('ranks with the wait and Start now lifts, as the daily suggestion does', async () => {
    const actions = [
      action('fresh', { priority_score: 70 }),
      action('waiting', { priority_score: 60, created_at: daysAgo(12) }),
      action('writing', { priority_score: 66 }),
    ];
    const db = fakeDb({
      actions,
      action_tasks: [{ action_id: 'writing', task_key: 'create_content_draft', status: 'todo' }],
      profiles: [{ id: ME, time_zone: 'UTC' }],
    });
    const result = await read(db);
    expect(ids(result)).toEqual(['waiting', 'writing', 'fresh']);
    // The nightly pick, given the same rows, picks the same first.
    const pick = pickSuggestion({
      actions,
      userId: ME,
      rows: [],
      needsYou: new Set(),
      startNow: new Map([['writing', 'create']]),
      now: NOW,
    });
    expect(pick.action.id).toBe(result.today[0].id);
  });

  it('leaves out actions on hold, closed, deleted, or someone else’s', async () => {
    const db = fakeDb({
      actions: [
        action('mine', { assignee_id: ME }),
        action('theirs', { assignee_id: 'u2', priority_score: 99 }),
        action('held', { status: 'on_hold', priority_score: 99 }),
        action('done', { status: 'completed', priority_score: 99 }),
        action('gone', { deleted_at: daysAgo(1), priority_score: 99 }),
        action('other-brand', { brand_id: 'b2', priority_score: 99 }),
        action('open'),
      ],
      profiles: [{ id: ME, time_zone: 'UTC' }],
    });
    expect(ids(await read(db))).toEqual(['mine', 'open']);
  });

  it('puts the Inbox’s suggestion for today first, and marks it', async () => {
    const db = fakeDb({
      actions: twelve(),
      profiles: [{ id: ME, time_zone: 'UTC' }],
      chat_suggestions: [suggestion('f'), suggestion('a', { sent_on: '2026-10-29' })],
    });
    const result = await read(db);
    expect(ids(result)).toEqual(['f', 'a', 'b', 'c', 'd', 'e', 'g', 'h', 'i', 'j']);
    expect(suggestedIds(result)).toEqual(['f']);
  });

  it('pins a suggestion from below the first ten too', async () => {
    const db = fakeDb({
      actions: twelve(),
      profiles: [{ id: ME, time_zone: 'UTC' }],
      chat_suggestions: [suggestion('l')],
    });
    const result = await read(db);
    expect(ids(result)[0]).toBe('l');
    expect(ids(result)).toHaveLength(10);
  });

  it('reads today in the person’s zone, as the job dates the suggestion', async () => {
    // 09:30 UTC is already Oct 31 in Kiritimati (UTC+14): yesterday's there is Oct 30's.
    const db = fakeDb({
      actions: twelve(),
      profiles: [{ id: ME, time_zone: 'Pacific/Kiritimati' }],
      chat_suggestions: [suggestion('f'), suggestion('g', { sent_on: '2026-10-31' })],
    });
    expect(ids(await read(db))[0]).toBe('g');
  });

  it('takes the zone from the person’s Chat answers when they picked none', async () => {
    const db = fakeDb({
      actions: twelve(),
      profiles: [{ id: ME, time_zone: null }],
      chat_messages: [
        {
          role: 'assistant',
          timezone: 'Pacific/Kiritimati',
          created_at: daysAgo(1),
          chat_conversations: { user_id: ME, organization_id: ORG },
        },
      ],
      chat_suggestions: [suggestion('g', { sent_on: '2026-10-31' })],
    });
    expect(ids(await read(db))[0]).toBe('g');
  });

  it('keeps the ranking when today’s suggestion was removed, put off, or isn’t open now', async () => {
    for (const row of [
      suggestion('f', { removed_at: daysAgo(0) }),
      suggestion('f', { snoozed_until: new Date(NOW.getTime() + 7 * DAY).toISOString() }),
      suggestion('zz'),
    ]) {
      const db = fakeDb({
        actions: twelve(),
        profiles: [{ id: ME, time_zone: 'UTC' }],
        chat_suggestions: [row],
      });
      const result = await read(db);
      expect(ids(result)[0]).toBe('a');
      expect(suggestedIds(result)).toEqual([]);
    }
  });

  it('doesn’t read the Inbox where Chat is off', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    const db = fakeDb({ actions: twelve(), chat_suggestions: [suggestion('f')] });
    expect(ids(await read(db))[0]).toBe('a');
    expect(db.reads).not.toContain('chat_suggestions');
    expect(db.reads).not.toContain('chat_messages');
  });

  it('reads nothing more when no action is open', async () => {
    const db = fakeDb({ actions: [] });
    expect(await read(db)).toEqual({ today: [], next: [] });
    expect(db.reads).toEqual(['actions']);
  });

  it('fails as the job’s reads do, by what and the code', async () => {
    const db = fakeDb({ actions: twelve(), profiles: [{ id: ME, time_zone: 'UTC' }] });
    db.fail = 'chat_suggestions';
    await expect(read(db)).rejects.toMatchObject({
      name: 'SuggestionsDbError',
      message: 'suggestion read failed',
      code: '57014',
    });
  });
});

describe('todaysSuggestion', () => {
  it('is null with no suggestion sent today', async () => {
    const db = fakeDb({ profiles: [{ id: ME, time_zone: 'UTC' }] });
    expect(
      await todaysSuggestion(db, { orgId: ORG, brandId: BRAND, userId: ME, now: NOW }),
    ).toBeNull();
  });

  it('gives back a suggestion put off until a time already past', async () => {
    const db = fakeDb({
      profiles: [{ id: ME, time_zone: 'UTC' }],
      chat_suggestions: [suggestion('f', { snoozed_until: daysAgo(1) })],
    });
    expect(await todaysSuggestion(db, { orgId: ORG, brandId: BRAND, userId: ME, now: NOW })).toBe(
      'f',
    );
  });
});
