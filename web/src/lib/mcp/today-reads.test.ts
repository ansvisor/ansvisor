// @vitest-environment node
import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActionItem } from '@/lib/actions/action-center';
import type { FocusCard } from '@/lib/actions/today-focus';
import type { TodayStart } from '@/lib/actions/today-start';
import type { ActionHistoryItem } from '@/lib/action-center/history';
import type { McpAuthContext } from '@/lib/mcp-auth';
import type { Signal } from '@/lib/signals/map';

/**
 * Chat's reads of Today, History and the Signals summary (plan step 6b)
 * answer from the pages' own reads: Today's focus in its cards' order, its
 * Since yesterday and Waiting for you as the page orders them; History's
 * rows as its filters and sort list them; the Signals page's summary cards.
 * Only the caller's brand, and Today only with the person's own session.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ rows: {} as Record<string, Row | null>, reads: [] as string[] }));
vi.mock('@/lib/supabase/admin', () => {
  const from = (table: string) => {
    db.reads.push(table);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'is', 'order', 'limit']) chain[name] = () => chain;
    chain.maybeSingle = async () => ({ data: db.rows[table] ?? null, error: null });
    return chain;
  };
  return { supabaseAdmin: { from } };
});
const session = vi.hoisted(() => ({ userId: 'user-1' as string | null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: session.userId ? { user: { id: session.userId } } : null },
      }),
    },
  }),
}));
const page = vi.hoisted(() => ({
  getTodayStart: vi.fn(),
  getMyMenu: vi.fn(),
  getTodayLastWeek: vi.fn(),
  getTodayEnded: vi.fn(),
  getTodayFirstDay: vi.fn(),
  listChats: vi.fn(),
  getActionHistory: vi.fn(),
  getSignalsSummary: vi.fn(),
}));
vi.mock('@/lib/actions/today-start', () => ({ getTodayStart: page.getTodayStart }));
vi.mock('@/lib/actions/menu-access', () => ({ getMyMenu: page.getMyMenu }));
vi.mock('@/lib/actions/today-week', () => ({
  getTodayLastWeek: page.getTodayLastWeek,
  getTodayEnded: page.getTodayEnded,
}));
vi.mock('@/lib/actions/today-first-day', () => ({ getTodayFirstDay: page.getTodayFirstDay }));
vi.mock('@/lib/chat/conversations', () => ({ CHAT_LIST_DEFAULT: 100, listChats: page.listChats }));
vi.mock('@/lib/chat/flag', () => ({ chatAgenticEnabled: () => true }));
vi.mock('@/lib/actions/action-history', () => ({ getActionHistory: page.getActionHistory }));
vi.mock('@/lib/actions/signals', () => ({ getSignalsSummary: page.getSignalsSummary }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const { dbClient } = await import('@/lib/supabase/scoped');
const { actionTexts } = await import('@/lib/action-center/display');
const { filterHistory } = await import('@/lib/action-center/history');
const { isReminderKind } = await import('@/lib/action-center/focus');
const { waitingRows } = await import('@/lib/action-center/waiting');
const { getSignalsSummaryFor, getTodayFor, historyPageFor } = await import('./today-reads');

const BRAND = 'b1';
const AUTH: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'manager',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};
/** A Tuesday, so Last week stays away unless a test asks for a Monday. */
const TUESDAY = new Date('2026-11-17T09:00:00.000Z');
const textsT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionTexts' });
const titleOf = (action: Pick<ActionItem, 'kind' | 'payload'>) =>
  actionTexts(action as ActionItem, (key, values) => textsT(key as never, values as never)).title;

function action(id: string, over: Partial<ActionItem> = {}): ActionItem {
  return {
    id,
    actionNo: 900,
    brandNo: 1,
    category: 'recover',
    kind: 'recover_lost_citations',
    impact: 'high',
    status: 'new',
    payload: {},
    kpiKeys: [],
    assignee: null,
    dueDate: null,
    createdAt: '2026-11-10T09:00:00Z',
    updatedAt: '2026-11-10T09:00:00Z',
    taskTotal: 4,
    taskCompleted: 1,
    signalCount: 1,
    priorityScore: 70,
    priorityLevel: 'high',
    priorityReason: null,
    ...over,
  };
}

const card = (id: string, act: ActionItem, over: Partial<FocusCard> = {}): FocusCard => ({
  id,
  action: act,
  isNew: false,
  firstStep: { taskKey: null, title: 'Add a pricing FAQ to /pricing', titleParams: {}, url: null },
  effort: '~2h',
  who: 'me',
  ...over,
});

/** The page's focus, in its order: not the Priority Score's. */
const CARDS = [
  card('a7', action('a7', { brandNo: 7, priorityScore: 40, kind: 'competitor_surge' })),
  card('a3', action('a3', { brandNo: 3, priorityScore: 90 }), { isNew: true }),
  card('a12', action('a12', { brandNo: 12, priorityScore: 60, kind: 'prompt_gain' })),
];

function signal(id: string, over: Partial<Signal> = {}): Signal {
  return {
    id,
    brandNo: 7,
    category: 'visibility',
    kind: 'prompt_gain',
    impact: 'high',
    status: 'new',
    source: ['ai_results'],
    detectedAt: '2026-11-16T04:00:00Z',
    lastDetectedAt: '2026-11-16T04:00:00Z',
    resolvedAt: null,
    previousValue: null,
    currentValue: null,
    changeValue: 12,
    payload: { promptText: 'best whole bean coffee' },
    kpiKeys: [],
    actionId: null,
    where: { platforms: [], regions: [] } as unknown as Signal['where'],
    ...over,
  };
}

const WAITING = {
  canManage: true,
  today: '2026-11-17',
  drafts: [{ id: 'd1', title: 'Pricing FAQ' }],
  actions: [
    {
      id: 'a20',
      action: action('a20', { brandNo: 20 }),
      firstStep: null,
      dueDate: '2026-11-15',
    },
  ],
  reviews: 2,
  ideas: null,
  prompts: null,
};

const settled = <T>(value: T) => Promise.resolve(value);
const failed = () => {
  const read = Promise.reject(new Error('failed'));
  read.catch(() => {});
  return read;
};

function start(over: Partial<TodayStart> = {}): TodayStart {
  return {
    overview: settled({
      zone: 'UTC',
      lastRunAt: '2026-11-17T06:00:00Z',
      trackedPrompts: 40,
      openActions: 9,
      openBreakdown: { onHold: 1, mine: 3 },
      doneThisWeek: 2,
    }),
    state: settled(null),
    focus: settled(CARDS),
    changes: settled({
      since: '2026-11-16T06:00:00Z',
      items: [
        signal('s1'),
        signal('s2', {
          brandNo: 8,
          category: 'competitor',
          kind: 'competitor_surge',
          impact: 'medium',
        }),
      ],
      total: 4,
      small: 3,
    }),
    waiting: settled(WAITING),
    setup: settled(null),
    standing: settled({
      score: 54.2,
      change: 1.1,
      rank: 2,
      of: 5,
      set: 'rivals',
      neighbour: { name: 'Northbound', gap: 3.4, ahead: false },
      competitors: [],
    }),
    ...over,
  } as TodayStart;
}

const CHATS = [
  { id: 'c2', title: 'Fix FAQ', mine: true, state: 'needsYou', lastMessageAt: '2026-11-17T08:00Z' },
  { id: 'c3', title: 'Theirs', mine: false, state: 'needsYou', lastMessageAt: '2026-11-17T08:30Z' },
  { id: 'c4', title: 'Done', mine: true, state: 'done', lastMessageAt: '2026-11-17T08:40Z' },
];

beforeEach(() => {
  db.rows = { brands: { id: BRAND } };
  db.reads = [];
  session.userId = 'user-1';
  for (const fn of Object.values(page)) fn.mockReset();
  page.getTodayStart.mockImplementation(async () => start());
  page.getMyMenu.mockResolvedValue({ hidden: [] });
  page.listChats.mockResolvedValue({ chats: CHATS, total: 3, archived: 0 });
});

afterEach(() => vi.unstubAllEnvs());

describe('get_today', () => {
  it("lists Today's focus in the page's order, and names its first card as what to do first", async () => {
    const today = await getTodayFor(AUTH, { brandId: BRAND, timezone: 'UTC', now: TUESDAY });
    expect(page.getTodayStart).toHaveBeenCalledWith(BRAND, 'UTC', [], false);
    if (!today || !('focus' in today)) throw new Error('no Today');
    // The page's cards, in its order, each by its title and code.
    expect(today.focus?.cards.map((c) => [c.position, c.ref, c.title])).toEqual(
      CARDS.map((c, i) => [
        i + 1,
        `AC-${String(c.action.brandNo).padStart(2, '0')}`,
        titleOf(c.action),
      ]),
    );
    expect(today.focus?.title).toBe("Today's focus");
    expect(today.focus?.cards[0]).toMatchObject({
      ref: 'AC-07',
      first_step: 'Add a pricing FAQ to /pricing',
      effort: '~2h',
      who: 'me',
      steps: '1/4',
      open: '/dashboard/action-center/actions?action=a7',
    });
    expect(today.focus?.cards[1].new).toBe(true);
    expect(today.note).toContain(`${titleOf(CARDS[0].action)} (AC-07)`);
    expect(today).toMatchObject({
      day: 'normal',
      loop: { tracked_prompts: 40, open_actions: 9, done_this_week: 2 },
      where_you_stand: { score: 54.2, rank: 2, of: 5, rank_among: 'rivals' },
      last_week: null,
    });
  });

  it("lists Since yesterday's changes by code, and Waiting for you as the page orders it", async () => {
    const today = await getTodayFor(AUTH, { brandId: BRAND, timezone: 'UTC', now: TUESDAY });
    if (!today || !('since_yesterday' in today)) throw new Error('no Today');
    expect(today.since_yesterday).toMatchObject({
      not_listed: 2,
      small_moves: 3,
      changes: [
        { code: 'S-07', direction: 'up', impact: 'high' },
        { code: 'S-08', direction: 'rival', impact: 'medium' },
      ],
    });
    // The person's own chats on this brand whose agent run waits for them.
    expect(page.listChats).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 'user-1', email: null, organizationId: 'org-1' },
      { view: 'active', limit: 100, brandId: BRAND },
    );
    const expected = waitingRows({
      ...WAITING,
      chatOn: true,
      hidden: new Set(),
      agents: [{ id: 'c2', title: 'Fix FAQ' }],
      isReminder: isReminderKind,
      broken: null,
    });
    expect(today.waiting_for_you?.rows.map((row) => row.type)).toEqual(
      expected.map((row) => row.type),
    );
    expect(today.waiting_for_you?.rows).toEqual([
      expect.objectContaining({
        type: 'agent',
        line: 'An agent is waiting for your OK on “Fix FAQ”.',
        open: '/dashboard/chat/c2',
      }),
      expect.objectContaining({
        type: 'drafts',
        count: 1,
        line: '1 draft waiting for your review. Nothing goes live without your OK.',
      }),
      expect.objectContaining({ type: 'due', ref: 'AC-20', due: '2026-11-15' }),
      expect.objectContaining({ type: 'review', count: 2 }),
    ]);
  });

  it('leaves out what the page leaves out: a section off the menu, a part whose read failed', async () => {
    page.getMyMenu.mockResolvedValue({ hidden: ['agent', 'content'] });
    page.getTodayStart.mockImplementation(async () => start({ changes: failed() }));
    const today = await getTodayFor(AUTH, { brandId: BRAND, timezone: 'UTC', now: TUESDAY });
    if (!today || !('since_yesterday' in today)) throw new Error('no Today');
    expect(page.getTodayStart).toHaveBeenCalledWith(BRAND, 'UTC', ['agent', 'content'], false);
    expect(page.listChats).not.toHaveBeenCalled();
    expect(today.since_yesterday).toBeNull();
    expect(today.waiting_for_you?.rows.map((row) => row.type)).toEqual(['due', 'review']);
  });

  it("reads Last week on the person's Monday, and This week's focus", async () => {
    page.getTodayLastWeek.mockResolvedValue({
      visibility: {
        score: 50,
        change: 2,
        rank: 1,
        of: 4,
        set: 'top',
        neighbour: null,
        competitors: [],
      },
      done: { count: 1, actions: [{ id: 'a3', kind: 'recover_lost_citations', payload: {} }] },
      results: null,
    });
    const today = await getTodayFor(AUTH, {
      brandId: BRAND,
      timezone: 'UTC',
      now: new Date('2026-11-16T09:00:00.000Z'),
    });
    if (!today || !('last_week' in today)) throw new Error('no Today');
    expect(today.day).toBe('monday');
    expect(today.focus?.title).toBe("This week's focus");
    expect(today.last_week?.done).toEqual({
      count: 1,
      actions: [{ id: 'a3', title: titleOf({ kind: 'recover_lost_citations', payload: {} }) }],
    });
    expect(today.where_you_stand).toBeNull();
  });

  it("reads a brand's first day, and the ended day, with their own reads", async () => {
    page.getTodayStart.mockImplementation(async () =>
      start({
        overview: settled({
          zone: 'UTC',
          lastRunAt: null,
          trackedPrompts: 8,
          openActions: 0,
          openBreakdown: { onHold: 0, mine: 0 },
          doneThisWeek: 0,
        }),
        // A part the first day doesn't show is null, as getTodayStart gives it.
        focus: settled(null),
        changes: settled(null),
        waiting: settled(null),
      }),
    );
    page.getTodayFirstDay.mockResolvedValue({
      firstName: 'Ada',
      engines: ['ChatGPT'],
      prompts: [{ id: 'p1', text: 'best crm', topic: 'CRM', demand: 'high' }],
      total: 8,
      checked: false,
      platforms: [],
      models: [],
      suggestions: [{ id: 's1', text: 'crm for teams' }],
      spots: null,
    });
    const first = await getTodayFor(AUTH, { brandId: BRAND, now: TUESDAY });
    if (!first || !('first_day' in first)) throw new Error('no Today');
    expect(first.day).toBe('first_day');
    // The first day shows no focus, as the page doesn't.
    expect(first.focus).toBeNull();
    expect(first.note).toContain("The brand's first day");
    expect(first.first_day).toEqual({
      engines: ['ChatGPT'],
      prompts: [{ text: 'best crm', topic: 'CRM', demand: 'high' }],
      tracked_prompts: 8,
      checked: false,
      suggestions: ['crm for teams'],
    });

    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    db.rows.organizations = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
    page.getTodayStart.mockImplementation(async () => start());
    page.getTodayEnded.mockResolvedValue({
      lastRunAt: '2026-11-01T06:00:00Z',
      trial: null,
      prompts: 40,
      competitors: 5,
      done: 3,
      improved: null,
      open: 6,
      drafts: null,
    });
    const ended = await getTodayFor(AUTH, { brandId: BRAND, now: TUESDAY });
    if (!ended || !('ended' in ended)) throw new Error('no Today');
    expect(page.getTodayStart).toHaveBeenLastCalledWith(BRAND, null, [], true);
    expect(ended).toMatchObject({
      day: 'ended',
      ended: { prompts: 40, done: 3, open: 6 },
      since_yesterday: null,
      waiting_for_you: null,
    });
    expect(ended.focus?.cards).toHaveLength(3);
    expect(ended.focus?.title).toBe('Ready when you pick a plan');
  });

  it("is only the person's own Today: with no session of theirs, it says what to read instead", async () => {
    session.userId = 'someone-else';
    const today = await getTodayFor(AUTH, { brandId: BRAND });
    expect(today).toEqual({ note: expect.stringContaining('list_action_center_tasks') });
    expect(page.getTodayStart).not.toHaveBeenCalled();
  });

  it('reads nothing of a brand outside the caller’s organization or access', async () => {
    db.rows.brands = null;
    expect(await getTodayFor(AUTH, { brandId: 'b9' })).toBeNull();
    expect(await getTodayFor({ ...AUTH, brandAccess: ['b2'] }, { brandId: BRAND })).toBeNull();
    expect(page.getTodayStart).not.toHaveBeenCalled();
    expect(new Set(db.reads)).toEqual(new Set(['brands']));
  });
});

// ─── History ────────────────────────────────────────────────────────────────

function item(id: string, over: Partial<ActionHistoryItem> = {}): ActionHistoryItem {
  return {
    id,
    actionNo: 500,
    brandNo: Number(id.slice(1)),
    kind: 'recover_lost_citations',
    type: 'recover',
    priorityScore: 50,
    priorityLevel: 'medium',
    status: 'completed',
    outcome: 'improved',
    payload: {},
    kpiKeys: [],
    sources: ['ai_results'],
    triggerSignals: [],
    affected: [],
    results: [],
    positionOutcome: null,
    tasks: [],
    assignee: null,
    dueDate: null,
    createdAt: '2026-10-20T09:00:00Z',
    completedAt: '2026-11-01T09:00:00Z',
    timeToCloseDays: 12,
    ...over,
  };
}

/** What History reads for the brand: newest raised first, as the page's read gives them. */
const ITEMS = [
  item('h1', { completedAt: '2026-11-10T09:00:00Z', priorityScore: 20 }),
  item('h2', { status: 'in_progress', completedAt: null, createdAt: '2026-11-12T09:00:00Z' }),
  item('h3', { type: 'growth', kind: 'prompt_gain', sources: ['gsc'], priorityLevel: 'high' }),
  item('h4', { status: 'dismissed', completedAt: '2026-11-05T09:00:00Z', priorityScore: 95 }),
];

describe('get_action_history', () => {
  const searchText = (row: ActionHistoryItem) => {
    const texts = actionTexts(row as never, (key, values) => textsT(key as never, values as never));
    return `${texts.title} ${texts.description} AC-${String(row.brandNo).padStart(2, '0')}`;
  };

  beforeEach(() => {
    page.getActionHistory.mockImplementation(async () => {
      // The page's read, made with the service role once the brand is the caller's.
      expect(await dbClient()).toBe(supabaseAdmin);
      return ITEMS;
    });
  });

  it("lists the page's rows over the range, newest first, with its summary cards", async () => {
    const read = await historyPageFor(AUTH, {
      brandId: BRAND,
      dateFrom: '2026-10-18',
      dateTo: '2026-11-17',
    });
    // The window covers whole days, as the page's range does.
    expect(page.getActionHistory).toHaveBeenCalledWith(BRAND, {
      from: '2026-10-18T00:00:00.000Z',
      to: '2026-11-17T23:59:59.999Z',
    });
    expect(read?.actions.map((a) => a.ref)).toEqual(['AC-02', 'AC-01', 'AC-04', 'AC-03']);
    expect(read?.actions.map((a) => a.id)).toEqual(
      filterHistory(ITEMS, {}, 'newest', searchText).map((row) => row.id),
    );
    expect(read).toMatchObject({
      total: 4,
      offset: 0,
      next_offset: null,
      sort: 'newest',
      range: { from: '2026-10-18', to: '2026-11-17' },
      summary: { totalActions: 4, completed: 2, inProgress: 1, dismissed: 1 },
    });
    expect(read?.actions[1]).toMatchObject({ title: titleOf(ITEMS[0]), status: 'completed' });
  });

  it("narrows by the page's filters and sorts as the page does", async () => {
    const run = (over: Record<string, unknown>) =>
      historyPageFor(AUTH, { brandId: BRAND, ...over }).then((r) => r?.actions.map((a) => a.ref));
    expect(await run({ status: 'completed' })).toEqual(['AC-01', 'AC-03']);
    expect(await run({ category: 'growth' })).toEqual(['AC-03']);
    expect(await run({ priority: 'high' })).toEqual(['AC-03']);
    expect(await run({ source: 'gsc' })).toEqual(['AC-03']);
    expect(await run({ search: 'ac-04' })).toEqual(['AC-04']);
    expect(await run({ sort: 'priority' })).toEqual(['AC-04', 'AC-02', 'AC-03', 'AC-01']);
    expect(await run({ sort: 'oldest' })).toEqual(['AC-03', 'AC-04', 'AC-01', 'AC-02']);
    for (const [filters, sort] of [
      [{ status: 'completed' }, 'newest'],
      [{ type: 'growth' }, 'oldest'],
      [{ search: 'citations' }, 'priority'],
    ] as const) {
      const expected = filterHistory(ITEMS, filters, sort, searchText).map((row) => row.id);
      const read = await historyPageFor(AUTH, {
        brandId: BRAND,
        sort,
        status: 'status' in filters ? filters.status : undefined,
        category: 'type' in filters ? filters.type : undefined,
        search: 'search' in filters ? filters.search : undefined,
      });
      expect(read?.actions.map((a) => a.id)).toEqual(expected);
    }
  });

  it('pages the rows with their total, and reads nothing of another brand', async () => {
    const first = await historyPageFor(AUTH, { brandId: BRAND, limit: 3 });
    expect(first).toMatchObject({ total: 4, next_offset: 3 });
    const next = await historyPageFor(AUTH, { brandId: BRAND, limit: 3, offset: 3 });
    expect(next?.actions.map((a) => a.ref)).toEqual(['AC-03']);
    expect(next?.next_offset).toBeNull();
    db.rows.brands = null;
    page.getActionHistory.mockClear();
    expect(await historyPageFor(AUTH, { brandId: 'b9' })).toBeNull();
    expect(page.getActionHistory).not.toHaveBeenCalled();
  });
});

// ─── The Signals summary ────────────────────────────────────────────────────

describe('get_signals_summary', () => {
  beforeEach(() => {
    page.getSignalsSummary.mockImplementation(async () => {
      expect(await dbClient()).toBe(supabaseAdmin);
      return {
        total: 451,
        prevTotal: 400,
        important: 60,
        prevImportant: 55,
        newCount: 90,
        prevNew: 80,
        resolved: 30,
        prevResolved: 41,
        byDayActive: {},
        byDayImportant: {},
        byDayNew: {},
        byDayResolved: {},
        byCategory: { visibility: 300, citation: 151 },
        bySource: { ai_results: 451 },
      };
    });
  });

  it("reads the page's cards over its window: 30 days to today by default, or the period asked", async () => {
    const read = await getSignalsSummaryFor(AUTH, { brandId: BRAND, now: TUESDAY });
    expect(page.getSignalsSummary).toHaveBeenCalledWith(BRAND, '2026-10-19', '2026-11-17');
    expect(read).toMatchObject({
      window: { from: '2026-10-19', to: '2026-11-17' },
      active: { now: 451, before: 400 },
      high_impact: { now: 60, before: 55 },
      new: { now: 90, before: 80 },
      resolved: { now: 30, before: 41 },
      by_category: { visibility: 300, citation: 151 },
    });
    await getSignalsSummaryFor(AUTH, {
      brandId: BRAND,
      dateFrom: '2026-11-10T00:00:00Z',
      dateTo: '2026-11-16',
    });
    expect(page.getSignalsSummary).toHaveBeenLastCalledWith(BRAND, '2026-11-10', '2026-11-16');
  });

  it('reads nothing of a brand outside the caller’s access', async () => {
    expect(
      await getSignalsSummaryFor({ ...AUTH, brandAccess: ['b2'] }, { brandId: BRAND }),
    ).toBeNull();
    expect(page.getSignalsSummary).not.toHaveBeenCalled();
  });
});
