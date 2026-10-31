import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Daily suggestions in the Inbox (CHAT-26 §2.2, §2.4, §5, §6; 00422): the
 * person reads their own through their session (the last 7 days, not
 * removed or put off, their action not deleted), dated by the job's time
 * zone; every write is the server's, on their own rows only, after the
 * plan check, and answers as a value (#1777).
 */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const BRAND_2 = '44444444-4444-4444-8444-444444444444';
const SUGGESTION = '55555555-5555-4555-8555-555555555555';
const SUGGESTION_2 = '66666666-6666-4666-8666-666666666666';
const ACTION = '77777777-7777-4777-8777-777777777777';

interface Call {
  via: 'session' | 'admin';
  table: string;
  op: string;
  row?: unknown;
  options?: unknown;
  columns?: string;
  selectOptions?: unknown;
  filters: unknown[][];
}
let calls: Call[] = [];
let role = 'admin';
/** What each client, table and operation answers: `admin.chat_suggestions.update`. */
let answers: Record<string, unknown> = {};

function client(via: Call['via']) {
  return (table: string) => {
    const call: Call = { via, table, op: 'select', filters: [] };
    calls.push(call);
    const answer = () => {
      const found = answers[`${via}.${table}.${call.op}`];
      return typeof found === 'function' ? found(call) : (found ?? { data: null, error: null });
    };
    const chain: Record<string, unknown> = {
      select: (columns: string, options?: unknown) =>
        Object.assign(call, { columns, selectOptions: options }) && chain,
      update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
      upsert: (row: unknown, options: unknown) =>
        Object.assign(call, { op: 'upsert', row, options }) && chain,
      ...Object.fromEntries(
        ['eq', 'neq', 'in', 'is', 'gt', 'gte', 'not', 'or', 'order', 'limit'].map((name) => [
          name,
          (...args: unknown[]) => {
            call.filters.push([name, ...args]);
            return chain;
          },
        ]),
      ),
      maybeSingle: async () => answer(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    };
    return chain;
  };
}

const sessionFrom = client('session');
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    from: (table: string) => sessionFrom(table),
  }),
}));
const adminFrom = client('admin');
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => adminFrom(table) },
}));
const guard = vi.hoisted(() => ({ refuse: null as Error | null }));

vi.mock('@/lib/subscription-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscription-guard')>()),
  assertWritable: vi.fn(async () => {
    if (guard.refuse) throw guard.refuse;
  }),
}));

const { SubscriptionInactiveError } = await import('@/lib/subscription-guard');
const {
  markDailySuggestionsSeen,
  openDailySuggestion,
  readDailySuggestions,
  setDailySuggestions,
  startDailySuggestions,
} = await import('./chat-suggestions');

const summary = {
  version: 1,
  action: { no: 2841, kind: 'improve_page_content', payload: { targetCount: 5 } },
  priority: { score: 81, level: 'high', reason: null },
  startNow: { method: 'optimize', pages: 5, minutes: 20 },
};

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T09:00:00.000Z'));
  calls = [];
  role = 'admin';
  guard.refuse = null;
  answers = {
    'session.profiles.select': () => ({ data: { organization_id: ORG, role }, error: null }),
    'session.chat_suggestion_feeds.select': { data: [{ status: 'on' }], error: null },
    'session.chat_suggestions.select': {
      data: [
        {
          id: SUGGESTION,
          brand_id: BRAND,
          action_id: ACTION,
          sent_on: '2026-10-29',
          sent_at: '2026-10-29T07:05:00Z',
          seen_at: null,
          opened_at: null,
          started_at: null,
          started_via: null,
          summary,
          actions: { status: 'new' },
        },
      ],
      count: 1,
      error: null,
    },
    'admin.chat_messages.select': {
      data: [
        { timezone: 'America/New_York', chat_conversations: { user_id: 'someone' } },
        { timezone: 'Pacific/Auckland', chat_conversations: { user_id: ME } },
      ],
      error: null,
    },
    'admin.chat_suggestions.select': {
      data: { id: SUGGESTION, brand_id: BRAND, seen_at: null, opened_at: null },
      error: null,
    },
    'admin.brands.select': { data: [{ id: BRAND }, { id: BRAND_2 }], error: null },
    'admin.chat_suggestion_feeds.select': { data: [], error: null },
    'admin.chat_suggestion_feeds.upsert': (call: Call) => ({
      data: (call.row as { brand_id: string }[]).map((row) => ({ brand_id: row.brand_id })),
      error: null,
    }),
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const writes = () => calls.filter((c) => c.via === 'admin' && c.op !== 'select');
const has = (call: Call | undefined, ...filter: unknown[]) =>
  call?.filters.some((f) => JSON.stringify(f) === JSON.stringify(filter)) ?? false;

describe('readDailySuggestions', () => {
  it("reads the person's own suggestions of the last 7 days, not removed, through their session", async () => {
    const result = await readDailySuggestions();
    expect(result).toEqual({
      ok: true,
      read: {
        roleFeed: 'default_on',
        state: 'on',
        total: 1,
        // 09:00 UTC is 22:00 in Auckland, their latest answer's zone.
        today: '2026-10-29',
        suggestions: [
          {
            id: SUGGESTION,
            brandId: BRAND,
            actionId: ACTION,
            sentOn: '2026-10-29',
            sentAt: '2026-10-29T07:05:00Z',
            seenAt: null,
            openedAt: null,
            startedAt: null,
            startedVia: null,
            closed: null,
            summary: {
              actionNo: 2841,
              kind: 'improve_page_content',
              payload: { targetCount: 5 },
              priorityLevel: 'high',
              startNow: { method: 'optimize', pages: 5, minutes: 20 },
            },
          },
        ],
      },
    });
    const list = calls.find((c) => c.table === 'chat_suggestions')!;
    expect(list.via).toBe('session');
    expect(has(list, 'eq', 'user_id', ME)).toBe(true);
    expect(has(list, 'gt', 'sent_at', '2026-10-22T09:00:00.000Z')).toBe(true);
    expect(has(list, 'is', 'removed_at', null)).toBe(true);
    expect(list.selectOptions).toEqual({ count: 'exact' });
    expect(calls.some((c) => c.via === 'admin' && c.table !== 'chat_messages')).toBe(false);
  });

  it("drops a suggestion whose action was deleted: the action's status comes through the session, joined", async () => {
    await readDailySuggestions();
    const list = calls.find((c) => c.table === 'chat_suggestions')!;
    // The session reads actions without deleted_at only (actions: member select), so the inner join drops them.
    expect(list.columns).toContain('actions!chat_suggestions_action_id_fkey!inner(status)');
  });

  it('keeps one whose action was done or dismissed, with that status', async () => {
    answers['session.chat_suggestions.select'] = {
      data: ['completed', 'dismissed', 'on_hold'].map((status, i) => ({
        id: `${SUGGESTION.slice(0, -1)}${i}`,
        brand_id: BRAND,
        action_id: ACTION,
        sent_on: '2026-10-29',
        sent_at: '2026-10-29T07:05:00Z',
        seen_at: null,
        opened_at: null,
        started_at: null,
        started_via: null,
        summary,
        actions: { status },
      })),
      count: 3,
      error: null,
    };
    const result = await readDailySuggestions();
    expect(result.ok && result.read.suggestions.map((s) => s.closed)).toEqual([
      'completed',
      'dismissed',
      null,
    ]);
  });

  it('leaves out one put off (Not now) until its day', async () => {
    await readDailySuggestions();
    const list = calls.find((c) => c.table === 'chat_suggestions')!;
    expect(
      has(list, 'or', 'snoozed_until.is.null,snoozed_until.lte."2026-10-29T09:00:00.000Z"'),
    ).toBe(true);
  });

  it('counts them all when there are more than it lists', async () => {
    answers['session.chat_suggestions.select'] = {
      ...(answers['session.chat_suggestions.select'] as object),
      count: 140,
    };
    const result = await readDailySuggestions();
    expect(result.ok && result.read.total).toBe(140);
    const list = calls.find((c) => c.table === 'chat_suggestions')!;
    expect(has(list, 'limit', 100)).toBe(true);
  });

  it("dates today in the job's zone: their latest answer's, else the workspace's, and none when it can't be read", async () => {
    vi.setSystemTime(new Date('2026-10-29T13:00:00.000Z'));
    const zone = async () => {
      const result = await readDailySuggestions();
      return result.ok ? result.read.today : 'failed';
    };
    // 13:00 UTC: Oct 30 in Auckland, theirs.
    expect(await zone()).toBe('2026-10-30');
    const read = calls.find((c) => c.table === 'chat_messages')!;
    expect(read.via).toBe('admin');
    expect(has(read, 'eq', 'chat_conversations.organization_id', ORG)).toBe(true);
    expect(has(read, 'eq', 'role', 'assistant')).toBe(true);
    expect(has(read, 'gte', 'created_at', '2026-09-29T13:00:00.000Z')).toBe(true);
    answers['admin.chat_messages.select'] = {
      data: [{ timezone: 'Pacific/Auckland', chat_conversations: { user_id: 'someone' } }],
      error: null,
    };
    expect(await zone()).toBe('2026-10-30');
    answers['admin.chat_messages.select'] = { data: [], error: null };
    expect(await zone()).toBe('2026-10-29');
    answers['admin.chat_messages.select'] = { data: null, error: { message: 'boom' } };
    expect(await zone()).toBeNull();
  });

  it('gives an Analyst none, and reads nothing for them', async () => {
    role = 'analyst';
    expect(await readDailySuggestions()).toEqual({
      ok: true,
      read: { roleFeed: 'never', state: 'none', suggestions: [], total: 0, today: null },
    });
    expect(calls.some((c) => c.table.startsWith('chat_suggestion'))).toBe(false);
  });

  it('says paused while any brand is, and fails as a value', async () => {
    answers['session.chat_suggestion_feeds.select'] = {
      data: [{ status: 'on' }, { status: 'paused' }],
      error: null,
    };
    const paused = await readDailySuggestions();
    expect(paused.ok && paused.read.state).toBe('paused');
    answers['session.chat_suggestions.select'] = { data: null, error: { message: 'boom' } };
    expect(await readDailySuggestions()).toEqual({ ok: false, failure: 'failed' });
  });
});

describe('markDailySuggestionsSeen', () => {
  it("marks the person's own unseen suggestions seen, and leaves the feed alone", async () => {
    expect(await markDailySuggestionsSeen([SUGGESTION, SUGGESTION_2])).toEqual({ ok: true });
    expect(writes()).toHaveLength(1);
    const [update] = writes();
    expect(update.table).toBe('chat_suggestions');
    expect(update.row).toEqual({ seen_at: '2026-10-29T09:00:00.000Z' });
    expect(has(update, 'in', 'id', [SUGGESTION, SUGGESTION_2])).toBe(true);
    expect(has(update, 'eq', 'user_id', ME)).toBe(true);
    expect(has(update, 'eq', 'organization_id', ORG)).toBe(true);
    expect(has(update, 'is', 'seen_at', null)).toBe(true);
  });

  it('refuses ids that are not ones', async () => {
    expect(await markDailySuggestionsSeen(['nope'])).toEqual({ ok: false, failure: 'not_found' });
    expect(await markDailySuggestionsSeen([])).toEqual({ ok: false, failure: 'not_found' });
    expect(writes()).toEqual([]);
  });
});

describe('openDailySuggestion', () => {
  it('marks it opened and seen, and its feed used', async () => {
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: true });
    const read = calls.find((c) => c.via === 'admin' && c.table === 'chat_suggestions')!;
    expect(has(read, 'eq', 'user_id', ME)).toBe(true);
    const [opened, used] = writes();
    expect(opened.table).toBe('chat_suggestions');
    expect(opened.row).toEqual({
      opened_at: '2026-10-29T09:00:00.000Z',
      seen_at: '2026-10-29T09:00:00.000Z',
    });
    expect(has(opened, 'is', 'opened_at', null)).toBe(true);
    expect(used.table).toBe('chat_suggestion_feeds');
    expect(used.row).toEqual({ last_used_at: '2026-10-29T09:00:00.000Z' });
    expect(has(used, 'eq', 'user_id', ME)).toBe(true);
    expect(has(used, 'eq', 'brand_id', BRAND)).toBe(true);
  });

  it('keeps the first open, and still counts the feed used', async () => {
    answers['admin.chat_suggestions.select'] = {
      data: { id: SUGGESTION, brand_id: BRAND, seen_at: 'x', opened_at: '2026-10-28T08:00:00Z' },
      error: null,
    };
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: true });
    expect(writes().map((w) => w.table)).toEqual(['chat_suggestion_feeds']);
  });

  it("writes nothing on someone else's suggestion", async () => {
    answers['admin.chat_suggestions.select'] = { data: null, error: null };
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'not_found' });
    expect(writes()).toEqual([]);
  });

  it('reads it only while its action is not deleted, so a deleted one writes nothing', async () => {
    await openDailySuggestion(SUGGESTION);
    const read = calls.find((c) => c.via === 'admin' && c.table === 'chat_suggestions')!;
    expect(read.columns).toContain('actions!chat_suggestions_action_id_fkey!inner(deleted_at)');
    expect(has(read, 'is', 'actions.deleted_at', null)).toBe(true);
    expect(has(read, 'eq', 'organization_id', ORG)).toBe(true);
  });
});

describe('setDailySuggestions', () => {
  it('turns every feed of theirs back on, paused ones included, and makes a missing one', async () => {
    expect(await setDailySuggestions(true)).toEqual({ ok: true });
    const [update, upsert] = writes();
    expect(update.table).toBe('chat_suggestion_feeds');
    expect(update.row).toEqual({ status: 'on', paused_at: null });
    expect(has(update, 'eq', 'user_id', ME)).toBe(true);
    expect(has(update, 'neq', 'status', 'on')).toBe(true);
    expect(upsert.row).toEqual([
      { user_id: ME, brand_id: BRAND, organization_id: ORG, status: 'on' },
      { user_id: ME, brand_id: BRAND_2, organization_id: ORG, status: 'on' },
    ]);
    expect(upsert.options).toEqual({ onConflict: 'user_id,brand_id', ignoreDuplicates: true });
    const brands = calls.find((c) => c.table === 'brands')!;
    expect(has(brands, 'eq', 'is_demo', false)).toBe(true);
    expect(has(brands, 'eq', 'is_active', true)).toBe(true);
  });

  it('pauses them (off) on the Pause link', async () => {
    expect(await setDailySuggestions(false)).toEqual({ ok: true });
    const [update, upsert] = writes();
    expect(update.row).toEqual({ status: 'off', paused_at: null });
    expect(has(update, 'neq', 'status', 'off')).toBe(true);
    expect((upsert.row as { status: string }[]).every((row) => row.status === 'off')).toBe(true);
  });

  it("isn't an Analyst's to change", async () => {
    role = 'analyst';
    expect(await setDailySuggestions(true)).toEqual({ ok: false, failure: 'not_allowed' });
    expect(writes()).toEqual([]);
  });
});

describe('startDailySuggestions', () => {
  it("makes an Agency partner's feeds on their first Inbox, on, for the brands that get them", async () => {
    role = 'agency_partner';
    expect(await startDailySuggestions()).toEqual({ ok: true, made: 2 });
    const [upsert] = writes();
    expect(upsert.table).toBe('chat_suggestion_feeds');
    expect(upsert.row).toEqual([
      { user_id: ME, brand_id: BRAND, organization_id: ORG, status: 'on' },
      { user_id: ME, brand_id: BRAND_2, organization_id: ORG, status: 'on' },
    ]);
  });

  it('makes none once they have one in this workspace: paused or off stays so', async () => {
    role = 'agency_partner';
    answers['admin.chat_suggestion_feeds.select'] = { data: [{ brand_id: BRAND }], error: null };
    expect(await startDailySuggestions()).toEqual({ ok: true, made: 0 });
    expect(writes()).toEqual([]);
    const read = calls.find((c) => c.via === 'admin' && c.table === 'chat_suggestion_feeds')!;
    expect(has(read, 'eq', 'user_id', ME)).toBe(true);
    expect(has(read, 'eq', 'organization_id', ORG)).toBe(true);
  });

  it("makes none for an Analyst, nor for an Admin or Manager (the job's to make)", async () => {
    for (const who of ['analyst', 'admin', 'manager']) {
      role = who;
      expect(await startDailySuggestions()).toEqual({ ok: false, failure: 'not_allowed' });
    }
    expect(writes()).toEqual([]);
  });
});

describe('a read-only workspace', () => {
  it('keeps its list and writes nothing', async () => {
    guard.refuse = new SubscriptionInactiveError();
    role = 'agency_partner';
    expect((await readDailySuggestions()).ok).toBe(true);
    expect(await markDailySuggestionsSeen([SUGGESTION])).toEqual({
      ok: false,
      failure: 'read_only',
    });
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'read_only' });
    expect(await setDailySuggestions(true)).toEqual({ ok: false, failure: 'read_only' });
    expect(await startDailySuggestions()).toEqual({ ok: false, failure: 'read_only' });
    expect(writes()).toEqual([]);
  });

  it('answers failed when the plan check fails otherwise', async () => {
    guard.refuse = new Error('Could not read the plan');
    expect(await setDailySuggestions(false)).toEqual({ ok: false, failure: 'failed' });
  });
});

describe('with the new Chat off', () => {
  it('reads and writes nothing', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await readDailySuggestions()).toEqual({ ok: false, failure: 'chat_off' });
    expect(await markDailySuggestionsSeen([SUGGESTION])).toEqual({
      ok: false,
      failure: 'chat_off',
    });
    expect(await openDailySuggestion(SUGGESTION)).toEqual({ ok: false, failure: 'chat_off' });
    expect(await setDailySuggestions(true)).toEqual({ ok: false, failure: 'chat_off' });
    expect(await startDailySuggestions()).toEqual({ ok: false, failure: 'chat_off' });
    expect(calls.some((c) => c.table.startsWith('chat_suggestion'))).toBe(false);
  });

  it("is off for a workspace CHAT_AGENTIC_ORGS doesn't list", async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', '99999999-9999-4999-8999-999999999999');
    expect(await readDailySuggestions()).toEqual({ ok: false, failure: 'chat_off' });
  });
});
