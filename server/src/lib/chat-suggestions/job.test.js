import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

const cron = (await import('node-cron')).default;
const { logger } = await import('../logger.js');
const { SCHEDULE, runDailySuggestions, startDailySuggestions } = await import('./job.js');

/**
 * The hourly job (CHAT-26): who gets a suggestion, when, which, and what it
 * writes, against an in-memory database that reads and writes as PostgREST
 * does for the queries the job makes.
 */

const NOW = new Date('2026-10-30T09:30:00Z');
const DAY = 86_400_000;
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

const ORG = '11111111-1111-1111-1111-111111111111';
const READ_ONLY_ORG = '33333333-3333-3333-3333-333333333333';

const get = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);

/** Tables in memory, with the filters, orders and writes the job uses. */
function fakeDb(tables) {
  const calls = [];
  const uniques = {
    chat_suggestion_feeds: ['user_id', 'brand_id'],
    chat_suggestions: ['user_id', 'brand_id', 'sent_on'],
  };
  const db = {
    calls,
    tables,
    from(table) {
      calls.push(table);
      tables[table] ??= [];
      const filters = [];
      const orders = [];
      let write = null;
      let range = null;
      let limit = Infinity;
      let count = false;
      const keep = (row) => filters.every((test) => test(row));
      const chain = {
        select: () => chain,
        insert: (rows) => ((write = { kind: 'insert', rows: [rows].flat() }), chain),
        upsert: (rows, options) => (
          (write = { kind: 'insert', rows: [rows].flat(), options }),
          chain
        ),
        update: (values) => ((write = { kind: 'update', values }), chain),
        delete: (options) => ((write = { kind: 'delete' }), (count = !!options?.count), chain),
        eq: (column, value) => (filters.push((row) => get(row, column) === value), chain),
        in: (column, values) => (filters.push((row) => values.includes(get(row, column))), chain),
        is: (column, value) => (filters.push((row) => (get(row, column) ?? null) === value), chain),
        not: (column, op, value) => (
          filters.push((row) => (get(row, column) ?? null) !== value),
          chain
        ),
        gte: (column, value) => (filters.push((row) => get(row, column) >= value), chain),
        lt: (column, value) => (filters.push((row) => get(row, column) < value), chain),
        order: (column, { ascending = true, nullsFirst = false } = {}) => (
          orders.push({ column, ascending, nullsFirst }),
          chain
        ),
        limit: (n) => ((limit = n), chain),
        range: (from, to) => ((range = [from, to]), chain),
        then(resolve, reject) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      function run() {
        const rows = tables[table];
        if (write?.kind === 'insert') {
          const key = uniques[table];
          const inserted = [];
          for (const row of write.rows) {
            const taken = key && rows.some((other) => key.every((k) => other[k] === row[k]));
            if (taken && write.options?.ignoreDuplicates) continue;
            const stored = {
              id: `${table}-${rows.length + 1}`,
              created_at: NOW.toISOString(),
              updated_at: NOW.toISOString(),
              ...row,
            };
            rows.push(stored);
            inserted.push(stored);
          }
          return { data: inserted.map((row) => ({ ...row })), error: null };
        }
        if (write?.kind === 'update') {
          const found = rows.filter(keep);
          for (const row of found) Object.assign(row, write.values);
          return { data: found.map((row) => ({ ...row })), error: null };
        }
        if (write?.kind === 'delete') {
          const gone = rows.filter(keep);
          tables[table] = rows.filter((row) => !keep(row));
          return { data: null, count: count ? gone.length : null, error: null };
        }
        let found = rows.filter(keep).map((row) => ({ ...row }));
        if (table === 'chat_suggestions') {
          found = found.map((row) => ({ ...row, category: row.summary?.action?.category ?? null }));
        }
        for (const { column, ascending, nullsFirst } of [...orders].reverse()) {
          found.sort((a, b) => {
            const x = get(a, column) ?? null;
            const y = get(b, column) ?? null;
            if (x === y) return 0;
            if (x === null) return nullsFirst ? -1 : 1;
            if (y === null) return nullsFirst ? 1 : -1;
            return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          });
        }
        if (range) found = found.slice(range[0], range[1] + 1);
        return { data: found.slice(0, limit), error: null };
      }
      return chain;
    },
  };
  return db;
}

/** A workspace in the morning (UTC): its people, brands, open actions and Chat answers. */
function world(overrides = {}) {
  return {
    organizations: [
      { id: ORG, subscription_status: 'trialing' },
      { id: READ_ONLY_ORG, subscription_status: 'canceled' },
    ],
    brands: [
      { id: 'b1', organization_id: ORG, is_active: true, is_demo: false },
      { id: 'demo', organization_id: ORG, is_active: true, is_demo: true },
      { id: 'paused', organization_id: ORG, is_active: false, is_demo: false },
      { id: 'b2', organization_id: READ_ONLY_ORG, is_active: true, is_demo: false },
    ],
    profiles: [
      { id: 'admin', role: 'admin', organization_id: ORG },
      { id: 'manager-ist', role: 'manager', organization_id: ORG },
      { id: 'analyst', role: 'analyst', organization_id: ORG },
      { id: 'partner', role: 'agency_partner', organization_id: ORG },
      { id: 'partner-on', role: 'agency_partner', organization_id: ORG },
      { id: 'ro-admin', role: 'admin', organization_id: READ_ONLY_ORG },
    ],
    // The Inbox made the agency partner's feed when they first opened it.
    chat_suggestion_feeds: [
      {
        user_id: 'partner-on',
        brand_id: 'b1',
        organization_id: ORG,
        status: 'on',
        created_at: daysAgo(3),
        updated_at: daysAgo(3),
        last_used_at: null,
      },
    ],
    chat_suggestions: [],
    // Two answers read in UTC make it the workspace's zone; the manager reads in Istanbul (12:30).
    chat_messages: [
      {
        role: 'assistant',
        timezone: 'UTC',
        created_at: daysAgo(1),
        chat_conversations: { user_id: 'admin', organization_id: ORG },
      },
      {
        role: 'assistant',
        timezone: 'Europe/Istanbul',
        created_at: daysAgo(2),
        chat_conversations: { user_id: 'manager-ist', organization_id: ORG },
      },
      {
        role: 'assistant',
        timezone: 'UTC',
        created_at: daysAgo(3),
        chat_conversations: { user_id: 'admin', organization_id: ORG },
      },
    ],
    actions: [
      {
        id: 'a-top',
        brand_id: 'b1',
        action_no: 2841,
        kind: 'optimize_product_pages',
        category: 'growth',
        impact: 'high',
        status: 'new',
        priority_score: 81,
        priority_level: 'high',
        priority_reason: { version: 1, change: 'gap' },
        payload: {
          targetEntity: 'pages',
          targetCount: 2,
          pages: ['https://s.example/a', 'https://s.example/b'],
        },
        created_at: daysAgo(6),
        assignee_id: null,
        deleted_at: null,
      },
      {
        id: 'a-second',
        brand_id: 'b1',
        action_no: 2866,
        kind: 'add_llms_txt',
        category: 'fix',
        impact: 'medium',
        status: 'in_progress',
        priority_score: 60,
        priority_level: 'medium',
        priority_reason: null,
        payload: {},
        created_at: daysAgo(1),
        assignee_id: null,
        deleted_at: null,
      },
      {
        id: 'a-held',
        brand_id: 'b1',
        kind: 'x',
        category: 'protect',
        status: 'on_hold',
        priority_score: 99,
        created_at: daysAgo(1),
        deleted_at: null,
      },
      {
        id: 'a-deleted',
        brand_id: 'b1',
        kind: 'x',
        category: 'protect',
        status: 'new',
        priority_score: 98,
        created_at: daysAgo(1),
        deleted_at: daysAgo(1),
      },
      {
        id: 'a-demo',
        brand_id: 'demo',
        kind: 'x',
        category: 'growth',
        status: 'new',
        priority_score: 90,
        created_at: daysAgo(1),
        deleted_at: null,
      },
      {
        id: 'a-b2',
        brand_id: 'b2',
        kind: 'x',
        category: 'growth',
        status: 'new',
        priority_score: 90,
        created_at: daysAgo(1),
        deleted_at: null,
      },
    ],
    action_tasks: [
      { action_id: 'a-top', task_key: 'optimize_content', status: 'todo' },
      { action_id: 'a-second', task_key: 'create_content_draft', status: 'completed' },
    ],
    chat_agent_runs: [],
    chat_task_state: [],
    ...overrides,
  };
}

let capture;

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('IS_CLOUD', 'true');
  capture = vi.fn(async (events) => events.length);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const run = (db, now = NOW) => runDailySuggestions({ db, now, capture });
const sentEvents = () => capture.mock.calls.flatMap(([events]) => events);

describe('runDailySuggestions: off', () => {
  it('reads nothing while CHAT_AGENTIC is off', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    const db = { from: vi.fn() };
    const stats = await run(db);
    expect(db.from).not.toHaveBeenCalled();
    expect(stats).toEqual({
      workspaces: 0,
      feedsMade: 0,
      sent: 0,
      paused: 0,
      deleted: 0,
      failed: 0,
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('leaves out workspaces CHAT_AGENTIC_ORGS doesn’t list', async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', '99999999-9999-9999-9999-999999999999');
    const db = fakeDb(world());
    const stats = await run(db);
    expect(stats.sent).toBe(0);
    expect(db.calls).not.toContain('profiles');
    expect(db.tables.chat_suggestions).toEqual([]);
  });
});

describe('runDailySuggestions: who and what', () => {
  it('sends today’s suggestion to the people whose morning it is, with its summary', async () => {
    const db = fakeDb(world());
    const stats = await run(db);

    expect(stats).toMatchObject({ workspaces: 1, sent: 2, feedsMade: 1, paused: 0, failed: 0 });
    const rows = db.tables.chat_suggestions;
    expect(rows.map((row) => row.user_id).sort()).toEqual(['admin', 'partner-on']);
    for (const row of rows) {
      expect(row).toMatchObject({
        organization_id: ORG,
        brand_id: 'b1',
        action_id: 'a-top',
        sent_on: '2026-10-30',
        sent_at: NOW.toISOString(),
      });
    }
    expect(rows[0].summary).toMatchObject({
      version: 1,
      action: {
        no: 2841,
        kind: 'optimize_product_pages',
        category: 'growth',
        payload: { targetCount: 2 },
      },
      priority: { score: 81, level: 'high', reason: { version: 1, change: 'gap' } },
      waitingDays: 6,
      startNow: { method: 'optimize', pages: 2, minutes: 8 },
    });

    expect(sentEvents()).toEqual(
      expect.arrayContaining([
        {
          event: 'daily_suggestion_sent',
          distinctId: 'admin',
          timestamp: NOW.toISOString(),
          properties: {
            organization_id: ORG,
            brand_id: 'b1',
            action_id: 'a-top',
            action_category: 'growth',
            priority_level: 'high',
            start_now: 'optimize',
            variety: false,
          },
        },
      ]),
    );
    expect(sentEvents()).toHaveLength(2);
  });

  it('makes a feed for admins and managers only; analysts and partners who didn’t turn it on get none', async () => {
    const db = fakeDb(world());
    await run(db);
    const feeds = db.tables.chat_suggestion_feeds.map((feed) => `${feed.user_id}/${feed.brand_id}`);
    expect(feeds.sort()).toEqual(['admin/b1', 'partner-on/b1']);
    expect(db.tables.chat_suggestions.some((row) => row.user_id === 'analyst')).toBe(false);
    expect(db.tables.chat_suggestions.some((row) => row.user_id === 'partner')).toBe(false);
  });

  it('waits for a person’s own morning: the manager in Istanbul is past it', async () => {
    const db = fakeDb(world());
    await run(db);
    expect(db.tables.chat_suggestions.some((row) => row.user_id === 'manager-ist')).toBe(false);
    // Her morning, the next day, makes her feed and sends.
    const tomorrow = new Date('2026-10-31T05:30:00Z'); // 08:30 in Istanbul, 05:30 UTC
    await run(db, tomorrow);
    const hers = db.tables.chat_suggestions.filter((row) => row.user_id === 'manager-ist');
    expect(hers).toHaveLength(1);
    expect(hers[0].sent_on).toBe('2026-10-31');
  });

  it('never suggests on a demo brand, a paused brand or in a read-only workspace', async () => {
    const db = fakeDb(world());
    await run(db);
    const brands = new Set(db.tables.chat_suggestions.map((row) => row.brand_id));
    expect([...brands]).toEqual(['b1']);
    expect(db.tables.chat_suggestion_feeds.some((feed) => feed.user_id === 'ro-admin')).toBe(false);
  });

  it('suggests in a self-hosted workspace whatever its subscription says', async () => {
    vi.stubEnv('IS_CLOUD', 'false');
    const db = fakeDb(world());
    await run(db);
    expect(db.tables.chat_suggestions.some((row) => row.brand_id === 'b2')).toBe(true);
    expect(db.calls).not.toContain('organizations');
  });

  it('sends nothing twice: a second run the same morning finds today’s', async () => {
    const db = fakeDb(world());
    await run(db);
    capture.mockClear();
    const again = await run(db, new Date(NOW.getTime() + 3_600_000));
    expect(again.sent).toBe(0);
    expect(db.tables.chat_suggestions).toHaveLength(2);
    expect(sentEvents()).toEqual([]);
  });

  it('skips an action waiting in Needs you, and one suggested in the last 14 days', async () => {
    const db = fakeDb(
      world({
        chat_agent_runs: [{ action_id: 'a-top', status: 'needs_you' }],
        chat_suggestions: [
          {
            id: 'old',
            user_id: 'partner-on',
            organization_id: ORG,
            brand_id: 'b1',
            action_id: 'a-second',
            sent_on: '2026-10-25',
            sent_at: daysAgo(5),
            summary: { action: { category: 'fix' } },
          },
        ],
      }),
    );
    await run(db);
    const today = db.tables.chat_suggestions.filter((row) => row.sent_on === '2026-10-30');
    // The admin gets the second; the partner had it five days ago, so nothing is left for them.
    expect(today.map((row) => [row.user_id, row.action_id])).toEqual([['admin', 'a-second']]);
  });

  it('skips an action whose task a waiting chat works on', async () => {
    const db = fakeDb(
      world({
        chat_task_state: [
          { action_tasks: { action_id: 'a-top' }, chat_runs: { status: 'waiting' } },
          { action_tasks: { action_id: 'a-second' }, chat_runs: { status: 'done' } },
        ],
      }),
    );
    await run(db);
    expect(new Set(db.tables.chat_suggestions.map((row) => row.action_id))).toEqual(
      new Set(['a-second']),
    );
  });

  it('reads no action outside anyone’s morning', async () => {
    const db = fakeDb(world());
    const evening = new Date('2026-10-30T19:00:00Z');
    const stats = await run(db, evening);
    expect(stats.sent).toBe(0);
    expect(db.calls).not.toContain('actions');
    expect(db.calls).not.toContain('chat_suggestion_feeds');
  });
});

describe('runDailySuggestions: keeping and pausing', () => {
  it('deletes suggestions older than 14 days and keeps the rest', async () => {
    const row = (id, days) => ({
      id,
      user_id: 'someone',
      organization_id: ORG,
      brand_id: 'b1',
      action_id: 'a-gone',
      sent_on: daysAgo(days).slice(0, 10),
      sent_at: daysAgo(days),
      summary: {},
    });
    const db = fakeDb(world({ chat_suggestions: [row('kept', 13), row('gone', 15)] }));
    const stats = await run(db);
    expect(stats.deleted).toBe(1);
    const ids = db.tables.chat_suggestions.map((r) => r.id);
    expect(ids).toContain('kept');
    expect(ids).not.toContain('gone');
  });

  it('pauses a feed unused for 30 days and sends it nothing', async () => {
    const unused = (days) => ({
      id: `s${days}`,
      user_id: 'admin',
      organization_id: ORG,
      brand_id: 'b1',
      action_id: `old-${days}`,
      sent_on: daysAgo(days).slice(0, 10),
      sent_at: daysAgo(days),
      summary: { action: { category: 'growth' } },
    });
    const db = fakeDb(
      world({
        chat_suggestion_feeds: [
          {
            user_id: 'admin',
            brand_id: 'b1',
            organization_id: ORG,
            status: 'on',
            created_at: daysAgo(45),
            updated_at: daysAgo(45),
            last_used_at: daysAgo(31),
          },
        ],
        chat_suggestions: [unused(1), unused(2), unused(3)],
      }),
    );
    const stats = await run(db);
    expect(stats.paused).toBe(1);
    const feed = db.tables.chat_suggestion_feeds.find((f) => f.user_id === 'admin');
    expect(feed).toMatchObject({ status: 'paused', paused_at: NOW.toISOString() });
    expect(
      db.tables.chat_suggestions.some((r) => r.user_id === 'admin' && r.sent_on === '2026-10-30'),
    ).toBe(false);
    expect(sentEvents().filter((e) => e.event === 'daily_suggestions_paused')).toEqual([
      {
        event: 'daily_suggestions_paused',
        distinctId: 'admin',
        timestamp: NOW.toISOString(),
        properties: { organization_id: ORG, brand_id: 'b1', idle_days: 31 },
      },
    ]);

    // Paused, it stays paused: nothing turns it back on by itself.
    capture.mockClear();
    await run(db, new Date(NOW.getTime() + DAY));
    expect(db.tables.chat_suggestion_feeds.find((f) => f.user_id === 'admin').status).toBe(
      'paused',
    );
    expect(
      db.tables.chat_suggestions.some((r) => r.user_id === 'admin' && r.sent_on === '2026-10-31'),
    ).toBe(false);
  });

  it('sends nothing to a feed turned off', async () => {
    const db = fakeDb(
      world({
        chat_suggestion_feeds: [
          {
            user_id: 'admin',
            brand_id: 'b1',
            organization_id: ORG,
            status: 'off',
            created_at: daysAgo(3),
            updated_at: daysAgo(3),
          },
        ],
      }),
    );
    await run(db);
    expect(db.tables.chat_suggestions.some((r) => r.user_id === 'admin')).toBe(false);
  });
});

describe('runDailySuggestions: failures', () => {
  it('counts a workspace that fails and logs codes only', async () => {
    const db = fakeDb(world());
    const from = db.from;
    db.from = (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: async () => ({
              data: null,
              error: { code: '57014', message: 'canceling statement' },
            }),
          }),
        };
      }
      return from(table);
    };
    const stats = await run(db);
    expect(stats.failed).toBe(1);
    expect(stats.sent).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      { err: { name: 'SuggestionsDbError', code: '57014' } },
      '[chat-suggestions] workspace failed',
    );
  });
});

describe('startDailySuggestions', () => {
  it('runs every hour, and skips an hour while the last run is still going', async () => {
    cron.schedule.mockClear();
    let finish;
    const job = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    startDailySuggestions({ run: job });
    expect(cron.schedule).toHaveBeenCalledWith(SCHEDULE, expect.any(Function));
    expect(SCHEDULE).toBe('7 * * * *');

    const tick = cron.schedule.mock.calls[0][1];
    const first = tick();
    await tick();
    expect(job).toHaveBeenCalledTimes(1);
    finish();
    await first;
    const next = tick();
    finish();
    await next;
    expect(job).toHaveBeenCalledTimes(2);
  });
});
