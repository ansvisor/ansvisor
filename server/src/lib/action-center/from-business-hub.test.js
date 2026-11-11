import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { BUSINESS_HUB_URL, OPENAI_FEED_SPEC_URL } from '../business-hub/links.js';
import { resolve } from '../../config/action-engine.js';
import {
  BUSINESS_HUB_SETUP_KIND,
  businessHubSetupDedupKey,
  businessHubSetupTasks,
  BUSINESS_HUB_NUMBERS_KIND,
  NUMBERS_PATH,
  businessHubNumbersDedupKey,
  businessHubNumbersTask,
  closeNumbersReminder,
  completeFirstNumbersTask,
  syncBusinessHubNumbersAction,
  isOpenRegion,
  syncBusinessHubSetupAction,
} from './from-business-hub.js';

/**
 * The web's task limits (web/src/lib/action-center/task-details.ts
 * TASK_DETAIL_LIMITS): the drawer edits a task within them.
 */
const LIMITS = {
  url: 500,
  where: 300,
  why: 600,
  step: 300,
  steps: 8,
  doneWhen: 300,
  effort: 40,
  role: 60,
};

const BRAND = 'brand-1';
const NOW = new Date('2026-11-12T03:00:00Z');
const ON = { BUSINESS_HUB_ENABLED: 'true' };
const DAY = 86_400_000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString();

/**
 * Enough PostgREST for the sync: eq, gt, gte, order, limit, head counts,
 * maybeSingle and single, and inserts, with `fail` to make a table's insert
 * fail as the database would.
 */
function fakeDb(seed = {}, { fail = {} } = {}) {
  const tables = new Map(Object.entries(seed).map(([name, rows]) => [name, [...rows]]));
  const rows = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const reads = [];
  const from = (table) => {
    const state = { op: 'select', filters: [], head: false, one: null, limit: null, payload: null };
    const run = () => {
      const match = (row) =>
        state.filters.every(([kind, column, value]) => {
          const at = row[column];
          if (kind === 'eq') return at === value;
          if (kind === 'gt') return at != null && at > value;
          if (kind === 'gte') return at != null && at >= value;
          return value.includes(at);
        });
      if (state.op === 'update') {
        const changed = rows(table).filter(match);
        for (const row of changed) Object.assign(row, state.payload);
        return { data: changed, error: null };
      }
      if (state.op === 'insert') {
        if (fail[table]) return { data: null, error: fail[table] };
        const added = [state.payload].flat().map((values) => ({
          id: randomUUID(),
          created_at: NOW.toISOString(),
          ...values,
        }));
        rows(table).push(...added);
        return { data: state.one ? added[0] : null, error: null };
      }
      reads.push(table);
      const found = rows(table).filter(match);
      if (state.head) return { data: null, count: found.length, error: null };
      const data = state.limit === null ? found : found.slice(0, state.limit);
      if (state.one) return { data: data[0] ?? null, error: null };
      return { data, error: null };
    };
    const builder = {
      select: (_columns, options) => {
        if (options?.head) state.head = true;
        return builder;
      },
      eq: (column, value) => {
        state.filters.push(['eq', column, value]);
        return builder;
      },
      gt: (column, value) => {
        state.filters.push(['gt', column, value]);
        return builder;
      },
      gte: (column, value) => {
        state.filters.push(['gte', column, value]);
        return builder;
      },
      in: (column, values) => {
        state.filters.push(['in', column, values]);
        return builder;
      },
      order: () => builder,
      limit: (n) => {
        state.limit = n;
        return builder;
      },
      maybeSingle: () => {
        state.one = 'maybe';
        return builder;
      },
      single: () => {
        state.one = 'single';
        return builder;
      },
      insert: (payload) => {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      update: (payload) => {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      then: (onFulfilled, onRejected) => Promise.resolve(run()).then(onFulfilled, onRejected),
    };
    return builder;
  };
  return { db: { from }, rows, reads };
}

const brandRow = (over = {}) => ({
  id: BRAND,
  name: 'Northwind Outdoors',
  region: 'US',
  site_type: null,
  industry: 'Software',
  shopping_mode_enabled: false,
  is_demo: false,
  openai_product_feed: false,
  ...over,
});

/** 120 ChatGPT answers in the window, 34 naming the brand and 9 citing its site; and others. */
function answers() {
  const out = [];
  for (let i = 0; i < 120; i += 1) {
    out.push({
      id: `r${i}`,
      brand_id: BRAND,
      platform: 'chatgpt-web',
      created_at: daysAgo(1 + (i % 20)),
      mention_count: i < 34 ? 1 : 0,
      citation_count: i < 9 ? 2 : 0,
    });
  }
  // Outside the window, and another platform: not counted.
  out.push({
    id: 'old',
    brand_id: BRAND,
    platform: 'chatgpt-web',
    created_at: daysAgo(45),
    mention_count: 1,
    citation_count: 1,
  });
  out.push({
    id: 'gem',
    brand_id: BRAND,
    platform: 'gemini-web',
    created_at: daysAgo(2),
    mention_count: 1,
    citation_count: 1,
  });
  return out;
}

const seed = ({ brand = {}, domains, results, actions = [] } = {}) => ({
  brands: [brandRow(brand)],
  brand_domains: domains ?? [{ brand_id: BRAND, domain: 'northwind.example', is_primary: true }],
  prompt_results: results ?? answers(),
  actions,
});

const sync = (fake, opts = {}) =>
  syncBusinessHubSetupAction(BRAND, { db: fake.db, now: NOW, env: ON, ...opts });

const within = (details) => {
  expect(details.url.length).toBeLessThanOrEqual(LIMITS.url);
  expect(details.where.length).toBeLessThanOrEqual(LIMITS.where);
  expect(details.why.length).toBeLessThanOrEqual(LIMITS.why);
  expect(details.how.length).toBeLessThanOrEqual(LIMITS.steps);
  for (const step of details.how) expect(step.length).toBeLessThanOrEqual(LIMITS.step);
  expect(details.doneWhen.length).toBeLessThanOrEqual(LIMITS.doneWhen);
  expect(details.effort.length).toBeLessThanOrEqual(LIMITS.effort);
  expect(details.role.length).toBeLessThanOrEqual(LIMITS.role);
};

describe('businessHubSetupTasks', () => {
  it('gives a US online shop six tasks, each saying why, how and when it is done, linked to Business Hub', () => {
    const tasks = businessHubSetupTasks({
      brandName: 'Northwind Outdoors',
      domain: 'northwind.example',
      region: 'US',
      open: true,
      ecommerce: true,
    });
    expect(tasks.map((t) => t.details.step)).toEqual([
      'claim',
      'verify',
      'facts',
      'feed',
      'agent',
      'numbers',
    ]);
    expect(tasks.map((t) => t.details.type)).toEqual([
      'technical',
      'technical',
      'content',
      'product',
      'product',
      'technical',
    ]);
    for (const t of tasks.slice(0, 5)) {
      expect(t.status).toBe('todo');
      expect(t.details).toMatchObject({
        source: 'business_hub',
        url: BUSINESS_HUB_URL,
        check: 'manual',
      });
      expect(t.details.why).toBeTruthy();
      expect(t.details.how.length).toBeGreaterThan(0);
      expect(t.details.doneWhen).toBeTruthy();
    }
    expect(tasks[0].title).toBe('Claim your business in ChatGPT Business Hub');
    expect(tasks[0].details.how[1]).toContain('northwind.example');
    // DNS first, as Ansvisor knows the domain; Persona is part of it.
    expect(tasks[1].details.how.join(' ')).toMatch(/DNS record .* for northwind\.example/);
    expect(tasks[1].details.how.join(' ')).toContain('Persona');
    expect(tasks[1].details.doneWhen).toBe(
      'Business Hub shows your business as verified, with the blue check.',
    );
    expect(tasks[3].details.how.join(' ')).toContain(OPENAI_FEED_SPEC_URL);
    expect(tasks[4].title).toBe('Turn on your Business Agent (optional)');
    // Nothing promises more visibility for claiming.
    expect(tasks[0].details.why).toMatch(/doesn't move you up in answers/);
  });

  it('keeps every task within the limits the drawer edits it in', () => {
    const long = 'N'.repeat(300);
    for (const open of [true, false]) {
      for (const t of businessHubSetupTasks({
        brandName: long,
        domain: `${'d'.repeat(200)}.example`,
        open,
        ecommerce: true,
      })) {
        within(t.details);
        expect(t.title.length).toBeLessThanOrEqual(200);
      }
    }
  });

  it('outside the open regions, starts with the waitlist and has no Business Agent task', () => {
    const tasks = businessHubSetupTasks({
      brandName: 'Kuzey',
      domain: 'kuzey.example',
      region: 'TR',
      open: false,
      ecommerce: false,
    });
    expect(tasks.map((t) => t.details.step)).toEqual(['claim', 'verify', 'facts', 'numbers']);
    expect(tasks[0].title).toBe('Join ChatGPT Business Hub');
    expect(tasks[0].details.how[0]).toBe(
      "If Business Hub says it isn't open in your country yet, join the waitlist and mark this task done.",
    );
    expect(tasks[0].details.doneWhen).toMatch(/or you joined its waitlist/);
  });

  it('creates the feed task as completed for a brand that already sends OpenAI a direct feed', () => {
    const tasks = businessHubSetupTasks({
      brandName: 'Northwind',
      domain: 'northwind.example',
      open: true,
      ecommerce: true,
      directFeed: true,
    });
    expect(tasks.find((t) => t.details.step === 'feed').status).toBe('completed');
    expect(tasks.filter((t) => t.status === 'todo')).toHaveLength(5);
  });
});

describe('isOpenRegion', () => {
  it('reads BUSINESS_HUB_OPEN_REGIONS, the US by default, a brand with no region as the US', () => {
    expect(isOpenRegion('US', {})).toBe(true);
    expect(isOpenRegion('us', {})).toBe(true);
    expect(isOpenRegion(null, {})).toBe(true);
    expect(isOpenRegion('TR', {})).toBe(false);
    expect(isOpenRegion('TR', { BUSINESS_HUB_OPEN_REGIONS: 'US, tr' })).toBe(true);
  });
});

describe('syncBusinessHubSetupAction', () => {
  it('reads nothing with the flag off', async () => {
    const fake = fakeDb(seed());
    expect(await sync(fake, { env: {} })).toBe('ineligible');
    expect(fake.reads).toEqual([]);
    expect(fake.rows('actions')).toEqual([]);
  });

  it('opens a US online shop’s action: medium impact, its evidence, six tasks and a History line', async () => {
    const fake = fakeDb(seed({ brand: { industry: 'E-commerce & Retail' } }));
    expect(await sync(fake)).toBe('opened');

    const [action] = fake.rows('actions');
    expect(action).toMatchObject({
      brand_id: BRAND,
      kind: BUSINESS_HUB_SETUP_KIND,
      category: 'growth',
      impact: 'medium',
      status: 'new',
      kpi_keys: [],
      dedup_key: businessHubSetupDedupKey(BRAND),
      tasks_generated_at: NOW.toISOString(),
      payload: {
        source: 'business_hub',
        variant: 'open',
        region: 'US',
        domain: 'northwind.example',
        evidence: { answers: 120, named: 34, cited: 9, since: daysAgo(30) },
        targetEntity: 'platforms',
        targetCount: 1,
        targets: [{ id: 'chatgpt-web', label: 'ChatGPT' }],
      },
    });
    expect(action.priority_score).toEqual(expect.any(Number));
    expect(action.priority_reason).toMatchObject({
      change: 'opportunity',
      subject: { entity: 'platforms', count: 1 },
    });

    const tasks = fake.rows('action_tasks');
    expect(tasks.map((t) => [t.position, t.details.step, t.status])).toEqual([
      [1, 'claim', 'todo'],
      [2, 'verify', 'todo'],
      [3, 'facts', 'todo'],
      [4, 'feed', 'todo'],
      [5, 'agent', 'todo'],
      [6, 'numbers', 'todo'],
    ]);
    expect(tasks.every((t) => t.action_id === action.id)).toBe(true);
    expect(fake.rows('action_events')).toEqual([
      expect.objectContaining({
        action_id: action.id,
        event: 'created',
        actor_id: null,
        data: { source: 'business_hub', variant: 'open', taskCount: 6 },
      }),
    ]);
  });

  it('opens a Turkish B2B brand’s with low impact, the waitlist wording and no agent task', async () => {
    const fake = fakeDb(seed({ brand: { region: 'TR' } }));
    expect(await sync(fake)).toBe('opened');
    const [action] = fake.rows('actions');
    expect(action.impact).toBe('low');
    expect(action.payload).toMatchObject({ variant: 'waitlist', region: 'TR' });
    expect(fake.rows('action_tasks').map((t) => t.details.step)).toEqual([
      'claim',
      'verify',
      'facts',
      'numbers',
    ]);
    expect(fake.rows('action_tasks')[0].title).toBe('Join ChatGPT Business Hub');
  });

  it('creates the feed task as completed when the brand already sends OpenAI a direct feed', async () => {
    const fake = fakeDb(seed({ brand: { site_type: 'ecommerce', openai_product_feed: true } }));
    expect(await sync(fake)).toBe('opened');
    const feed = fake.rows('action_tasks').find((t) => t.details.step === 'feed');
    expect(feed.status).toBe('completed');
  });

  it.each([
    ['open', 'new'],
    ['completed', 'completed'],
    ['dismissed', 'dismissed'],
  ])('never raises it again once the brand had one (%s)', async (_label, status) => {
    const fake = fakeDb(
      seed({
        actions: [
          {
            id: 'a0',
            brand_id: BRAND,
            dedup_key: businessHubSetupDedupKey(BRAND),
            status,
            created_at: daysAgo(90),
          },
        ],
      }),
    );
    expect(await sync(fake)).toBe('exists');
    expect(fake.rows('actions')).toHaveLength(1);
    // One read a night once it exists.
    expect(fake.reads).toEqual(['actions']);
  });

  it('skips a demo brand, a brand with no website, and one with no ChatGPT answers in 30 days', async () => {
    expect(await sync(fakeDb(seed({ brand: { is_demo: true } })))).toBe('ineligible');
    expect(await sync(fakeDb(seed({ domains: [] })))).toBe('ineligible');
    const quiet = answers().filter((r) => r.platform !== 'chatgpt-web' || r.id === 'old');
    const fake = fakeDb(seed({ results: quiet }));
    expect(await sync(fake)).toBe('ineligible');
    expect(fake.rows('actions')).toEqual([]);
  });

  it('holds it when the day’s new actions are spent, and opens it the next night', async () => {
    const fake = fakeDb(seed());
    expect(await sync(fake, { open: false })).toBe('held');
    expect(fake.rows('actions')).toEqual([]);

    // Spent by actions sent earlier today, which the pass doesn't see.
    const max = resolve().noise.maxNewActionsPerDay;
    const today = Array.from({ length: max }, (_, i) => ({
      id: `t${i}`,
      brand_id: BRAND,
      dedup_key: `chat:${i}`,
      status: 'new',
      created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    }));
    const busy = fakeDb(seed({ actions: today }));
    expect(await sync(busy)).toBe('held');
    expect(busy.rows('actions')).toHaveLength(max);

    const tomorrow = new Date(NOW.getTime() + DAY);
    expect(await sync(busy, { now: tomorrow })).toBe('opened');
  });

  it('reads a pass beside it opening the same action (23505) as exists', async () => {
    const fake = fakeDb(seed(), { fail: { actions: { code: '23505', message: 'duplicate key' } } });
    expect(await sync(fake)).toBe('exists');
    expect(fake.rows('action_tasks')).toEqual([]);
  });

  it('fails on any other write error', async () => {
    const fake = fakeDb(seed(), { fail: { actions: { code: '42501', message: 'denied' } } });
    await expect(sync(fake)).rejects.toThrow('actions write: denied');
  });
});

describe('the first numbers task', () => {
  it('asks for the first entry in Visibility, and is checked automatically', () => {
    const [numbers] = businessHubSetupTasks({
      brandName: 'Northwind',
      domain: 'northwind.example',
      open: true,
      ecommerce: false,
    }).slice(-1);
    expect(numbers.title).toBe('Enter your first Business Hub numbers');
    expect(numbers.details).toMatchObject({
      source: 'business_hub',
      step: 'numbers',
      url: NUMBERS_PATH,
      check: 'auto',
    });
    expect(NUMBERS_PATH).toBe('/dashboard/insights?businessHub=enter');
    within(numbers.details);
  });

  it('is completed by the first save, with a History line, and the action stays open', async () => {
    const fake = fakeDb(seed());
    expect(await sync(fake)).toBe('opened');
    const [action] = fake.rows('actions');
    const later = new Date(NOW.getTime() + 2 * DAY);

    expect(await completeFirstNumbersTask(BRAND, { db: fake.db, now: later })).toBe(true);
    const numbers = fake.rows('action_tasks').find((t) => t.details.step === 'numbers');
    expect(numbers.status).toBe('completed');
    expect(numbers.details.autoCheck).toEqual({
      at: later.toISOString(),
      triedAt: later.toISOString(),
      passed: true,
      missing: [],
    });
    // Only its own task: the others are the person's to mark.
    expect(fake.rows('action_tasks').filter((t) => t.status === 'completed')).toHaveLength(1);
    expect(fake.rows('action_events').at(-1)).toMatchObject({
      action_id: action.id,
      event: 'task_checked',
      data: { taskId: numbers.id, task: null, title: 'Enter your first Business Hub numbers' },
      actor_id: null,
    });
    expect(action.status).toBe('new');
    expect(action.updated_at).toBe(later.toISOString());

    // A second save finds nothing left to complete.
    expect(await completeFirstNumbersTask(BRAND, { db: fake.db, now: later })).toBe(false);
    expect(fake.rows('action_events').filter((e) => e.event === 'task_checked')).toHaveLength(1);
  });

  it('does nothing without an open setup action', async () => {
    const fake = fakeDb(
      seed({
        actions: [
          {
            id: 'a0',
            brand_id: BRAND,
            dedup_key: businessHubSetupDedupKey(BRAND),
            status: 'dismissed',
          },
        ],
      }),
    );
    expect(await completeFirstNumbersTask(BRAND, { db: fake.db, now: NOW })).toBe(false);
    expect(fake.rows('action_events')).toEqual([]);
  });
});

describe('the weekly numbers reminder', () => {
  const day = (n) => daysAgo(n).slice(0, 10);
  /** The brand's entries, newest first, as the sync reads them. */
  const remindSeed = ({ ends = [7, 14], actions = [], brand = {} } = {}) => ({
    brands: [brandRow(brand)],
    business_hub_snapshots: ends.map((n, i) => ({
      id: `s${i}`,
      brand_id: BRAND,
      period_days: 7,
      period_end: day(n),
    })),
    actions,
  });
  const reminder = (status, over = {}) => ({
    id: `r-${status}`,
    brand_id: BRAND,
    dedup_key: businessHubNumbersDedupKey(BRAND),
    kind: BUSINESS_HUB_NUMBERS_KIND,
    status,
    dismiss_reason: null,
    created_at: daysAgo(20),
    updated_at: daysAgo(20),
    completed_at: null,
    ...over,
  });
  const remind = (fake, opts = {}) =>
    syncBusinessHubNumbersAction(BRAND, { db: fake.db, now: NOW, env: ON, ...opts });

  it('opens once the newest entry ended 7 days ago: low impact, one task checked on the next save', async () => {
    const fake = fakeDb(remindSeed({ ends: [7, 14] }));
    expect(await remind(fake)).toBe('opened');
    const [action] = fake.rows('actions');
    expect(action).toMatchObject({
      kind: BUSINESS_HUB_NUMBERS_KIND,
      category: 'growth',
      impact: 'low',
      status: 'new',
      kpi_keys: [],
      dedup_key: businessHubNumbersDedupKey(BRAND),
      payload: { source: 'business_hub', lastEnd: day(7), lastDays: 7, targetCount: 1 },
    });
    const [task] = fake.rows('action_tasks');
    expect(task).toMatchObject({
      action_id: action.id,
      position: 1,
      title: "Enter this week's ChatGPT Business Hub numbers",
      status: 'todo',
      details: { source: 'business_hub', step: 'reminder', check: 'auto', url: NUMBERS_PATH },
    });
    expect(task.details.how[0]).toBe('In Business Hub, open Insights and pick 7 days.');
    within(task.details);
    expect(fake.rows('action_events')).toEqual([
      expect.objectContaining({ action_id: action.id, event: 'created' }),
    ]);
  });

  it('waits while the numbers are fresh, and before the first entry', async () => {
    expect(await remind(fakeDb(remindSeed({ ends: [6] })))).toBe('fresh');
    expect(await remind(fakeDb(remindSeed({ ends: [] })))).toBe('ineligible');
    expect(await remind(fakeDb(remindSeed()), { env: {} })).toBe('ineligible');
    expect(await remind(fakeDb(remindSeed({ brand: { is_demo: true } })))).toBe('ineligible');
  });

  it('keeps one open, and holds a new one when the day’s actions are spent', async () => {
    expect(await remind(fakeDb(remindSeed({ actions: [reminder('in_progress')] })))).toBe('exists');
    const fake = fakeDb(remindSeed());
    expect(await remind(fake, { open: false })).toBe('held');
    expect(fake.rows('actions')).toEqual([]);
  });

  it('stops for good once dismissed as Not relevant', async () => {
    const fake = fakeDb(
      remindSeed({
        ends: [60],
        actions: [
          reminder('dismissed', { dismiss_reason: 'not_relevant', updated_at: daysAgo(50) }),
        ],
      }),
    );
    expect(await remind(fake)).toBe('opted_out');
    expect(fake.rows('actions')).toHaveLength(1);
  });

  it('rests a week after Not now, or after one was closed, then reminds again', async () => {
    const notNow = (n) =>
      fakeDb(
        remindSeed({
          ends: [14],
          actions: [reminder('dismissed', { dismiss_reason: 'not_now', updated_at: daysAgo(n) })],
        }),
      );
    expect(await remind(notNow(3))).toBe('resting');
    expect(await remind(notNow(8))).toBe('opened');
    const closed = fakeDb(
      remindSeed({
        actions: [reminder('completed', { completed_at: daysAgo(2), updated_at: daysAgo(2) })],
      }),
    );
    expect(await remind(closed)).toBe('resting');
  });

  it('is closed by a save: its task checked, then the reminder completed, each in its History', async () => {
    const fake = fakeDb(remindSeed());
    await remind(fake);
    const [action] = fake.rows('actions');
    const later = new Date(NOW.getTime() + DAY);
    expect(await closeNumbersReminder(BRAND, { db: fake.db, now: later })).toBe(true);
    expect(fake.rows('action_tasks')[0]).toMatchObject({
      status: 'completed',
      details: { autoCheck: { passed: true, at: later.toISOString() } },
    });
    expect(action).toMatchObject({ status: 'completed', completed_at: later.toISOString() });
    expect(
      fake.rows('action_events').map((e) => [e.event, e.data.to ?? null, e.data.source ?? null]),
    ).toEqual([
      ['created', null, 'business_hub'],
      ['task_checked', null, null],
      ['status_changed', 'completed', 'business_hub'],
    ]);
    // Nothing open: nothing to close.
    expect(await closeNumbersReminder(BRAND, { db: fake.db, now: later })).toBe(false);
  });

  it('stays open when someone added a task to it, its own task checked', async () => {
    const fake = fakeDb(remindSeed());
    await remind(fake);
    const [action] = fake.rows('actions');
    fake.rows('action_tasks').push({
      id: 't-own',
      action_id: action.id,
      title: 'Share the numbers with the team',
      status: 'todo',
      details: null,
    });
    const later = new Date(NOW.getTime() + DAY);
    expect(await closeNumbersReminder(BRAND, { db: fake.db, now: later })).toBe(false);
    expect(action.status).toBe('new');
    expect(action.updated_at).toBe(later.toISOString());
    const tasks = fake.rows('action_tasks');
    expect(tasks.find((t) => t.details?.step === 'reminder').status).toBe('completed');
    expect(tasks.find((t) => t.id === 't-own').status).toBe('todo');
  });

  it('names the last entry’s day in its why', () => {
    expect(businessHubNumbersTask({ lastEnd: '2026-11-03' }).details.why).toMatch(
      /^Your last Business Hub numbers end 2026-11-03\./,
    );
  });
});
