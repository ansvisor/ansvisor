import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { actionCenterRows, NUMBERS_REMINDER_KIND } = await import('./action-center.js');
const { agentRows } = await import('./agents.js');
const { businessHubRows } = await import('./business-hub.js');
const { coreRows } = await import('./core.js');
const { DEMO_MAX_AGE_MS } = await import('./index.js');
const { loadStartNow } = await import('../chat-suggestions/reads.js');
const { rankActions } = await import('../chat-suggestions/rules.js');

/**
 * The demo brand on Action Center › Today (SIMPLE_NAV): its dates fall in
 * the windows Today reads, whatever the hour it is built at and whenever it
 * is opened before its next rebuild (DEMO_MAX_AGE_MS). The windows are the
 * web's: the nightly run (lib/actions/menu-state.ts, the menu's green dots),
 * "Since yesterday" (lib/action-center/since.ts), the focus's ranking
 * (action-center/today.js, the Inbox's), "Waiting for you"
 * (lib/action-center/waiting.ts) and Monday's "Last week"
 * (lib/action-center/last-week.ts).
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const ORG_ID = '22222222-3333-4444-8555-666666666666';
const OWNER_ID = '33333333-4444-4555-8666-777777777777';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ENV = { BUSINESS_HUB_ENABLED: 'true' };
const OPEN_SIGNALS = ['new', 'acknowledged'];
const OPEN_ACTIONS = ['new', 'in_progress'];
/** Today's focus never gives a reminder a slot (web lib/action-center/focus.ts REMINDER_KINDS). */
const REMINDER_KINDS = [NUMBERS_REMINDER_KIND];
/** UTC offsets, in hours, a person's clock can have. */
const ZONES = [-12, -8, -5, 0, 1, 3, 5.5, 9, 14];

/**
 * Builds across a week, at and around the run's hour (06:00 UTC; before
 * 07:00 the latest run is the day before's): a Wednesday at noon and before
 * the run, a Thursday night, a Friday morning, a Saturday, a Monday before
 * the run and a Monday morning.
 */
const BUILDS = [
  '2026-11-11T12:00:00Z',
  '2026-11-11T05:00:00Z',
  '2026-11-12T23:00:00Z',
  '2026-11-13T07:00:00Z',
  '2026-11-14T12:00:00Z',
  '2026-11-16T05:00:00Z',
  '2026-11-16T09:30:00Z',
];

/**
 * Last week on a clock `offset` hours from UTC, Monday to Sunday, as
 * instants (last-week.ts lastWeekOf): when `visit` is that clock's Monday.
 */
function lastWeekOn(visit, offset) {
  const local = new Date(visit.getTime() + offset * HOUR);
  if (local.getUTCDay() !== 1) return null;
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return { start: monday - 7 * DAY - offset * HOUR, end: monday - offset * HOUR };
}

/** The tasks' rows, read as loadStartNow reads them. */
function tasksDb(tasks) {
  return {
    from: () => ({
      select: () => ({
        in: (_, ids) => ({
          in: async (__, keys) => ({
            data: tasks.filter((t) => ids.includes(t.action_id) && keys.includes(t.task_key)),
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe.each(BUILDS)('the demo built at %s', (iso) => {
  const now = new Date(iso);
  const nightly = coreRows({ brandId: BRAND_ID, now })
    .runs.filter((r) => r.source === 'cron')
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .at(-1);
  let rows;
  beforeAll(async () => {
    rows = await actionCenterRows({ brandId: BRAND_ID, now, env: ENV });
  });

  it('ends a nightly run the night it is built, before it is built: the menu’s green dots', () => {
    const completed = Date.parse(nightly.completed_at);
    expect(completed).toBeLessThanOrEqual(now.getTime());
    expect(now.getTime() - completed).toBeLessThan(DAY + 2 * HOUR);
    // From the run's hour on, the same UTC day.
    if (now.getUTCHours() >= 7) expect(nightly.completed_at.slice(0, 10)).toBe(iso.slice(0, 10));
  });

  it('finds an Up, a Down with its action and a Rival since the night’s run', () => {
    // No visit yet: "Since yesterday" starts at the latest nightly run's start.
    const since = Date.parse(nightly.started_at);
    const changes = rows.signals.filter(
      (s) =>
        OPEN_SIGNALS.includes(s.status) &&
        ['high', 'medium'].includes(s.impact) &&
        (Date.parse(s.detected_at) >= since || Date.parse(s.last_detected_at) >= since),
    );
    expect(changes).toHaveLength(3);
    for (const s of changes) expect(Date.parse(s.last_detected_at)).toBeLessThanOrEqual(+now);

    // Up: a positive kind (web lib/signals/registry.ts), found tonight.
    const up = changes.find((s) => s.kind === 'prompt_gain');
    expect(Date.parse(up.detected_at)).toBeGreaterThanOrEqual(since);
    expect(up.change_value).toBeGreaterThan(0);
    const rival = changes.find((s) => s.category === 'competitor');
    expect(rival).toBeTruthy();
    const down = changes.find((s) => s !== up && s !== rival);
    expect(Date.parse(down.detected_at)).toBeGreaterThanOrEqual(since);
    // "An action was added" tonight.
    const added = rows.actions.find((a) => a.id === down.action_id);
    expect(Date.parse(added.created_at)).toBeGreaterThanOrEqual(since);
    expect(Date.parse(added.created_at)).toBeLessThanOrEqual(+now);
  });

  it('ranks three actions named after what they are about first, until the next rebuild', async () => {
    const open = rows.actions.filter((a) => OPEN_ACTIONS.includes(a.status));
    const startNow = await loadStartNow(
      tasksDb(rows.tasks),
      open.map((a) => a.id),
    );
    for (const visit of [now, new Date(now.getTime() + DEMO_MAX_AGE_MS - HOUR)]) {
      const focus = rankActions({ actions: open, userId: OWNER_ID, startNow, now: visit })
        .map((r) => r.action)
        .filter((a) => !REMINDER_KINDS.includes(a.kind))
        .slice(0, 3);
      expect(focus.map((a) => a.kind)).toEqual([
        'content_opportunity',
        'topic_competitor_gap',
        'shopping_product',
      ]);
      const [guide, gap, product] = focus.map((a) => a.payload);
      expect(guide.title).toMatch(/low-acid coffee/);
      expect(gap).toMatchObject({
        competitorName: 'Northbound Roasters',
        topicName: expect.any(String),
      });
      expect(gap.gap).toBeGreaterThan(0);
      expect(product.title).toBe('Brewline Single Origin Club');
    }
  });

  it('waits on the person: the owner’s agent run, and the weekly Business Hub reminder', () => {
    const agents = agentRows({ brandId: BRAND_ID, now, organizationId: ORG_ID, ownerId: OWNER_ID });
    expect(agents.runs.filter((r) => r.status === 'needs_you')).toHaveLength(1);
    const waiting = agents.chats.runs.filter((r) => r.status === 'waiting');
    expect(waiting).toHaveLength(1);
    const chat = agents.chats.conversations.find((c) => c.id === waiting[0].conversation_id);
    expect(chat.user_id).toBe(OWNER_ID);

    // Raised the night it is due: the newest entry a week old (from-business-hub.js REMIND_AFTER_DAYS).
    const reminder = rows.actions.find((a) => a.kind === NUMBERS_REMINDER_KIND);
    const newest = businessHubRows({ brandId: BRAND_ID, now }).at(-1).period_end;
    expect(reminder).toMatchObject({ status: 'new', payload: { lastEnd: newest, lastDays: 7 } });
    const raisedOn = Date.parse(reminder.created_at.slice(0, 10));
    expect(raisedOn - Date.parse(newest)).toBe(7 * DAY);
    expect(Date.parse(reminder.created_at)).toBeGreaterThanOrEqual(Date.parse(nightly.started_at));
    expect(Date.parse(reminder.created_at)).toBeLessThanOrEqual(+now);
    const tasks = rows.tasks.filter((t) => t.action_id === reminder.id);
    expect(tasks).toEqual([
      expect.objectContaining({
        task_key: null,
        title: "Enter this week's ChatGPT Business Hub numbers",
        status: 'todo',
      }),
    ]);
  });

  it('closes an action and has a result in, in the last 7 days and in any Monday’s “Last week”', () => {
    const done = rows.actions.filter((a) => a.status === 'completed');
    const improved = done.filter((a) => a.outcome === 'improved');
    const within = (at) => at && Date.parse(at) <= +now && +now - Date.parse(at) < 7 * DAY;
    expect(done.some((a) => within(a.completed_at))).toBe(true);
    expect(improved.some((a) => within(a.validated_at))).toBe(true);

    // Every Monday, on every clock, it is opened on before the next rebuild.
    let mondays = 0;
    for (let at = +now; at < +now + DEMO_MAX_AGE_MS; at += HOUR) {
      for (const offset of ZONES) {
        const week = lastWeekOn(new Date(at), offset);
        if (!week) continue;
        mondays += 1;
        const inWeek = (stamp) =>
          stamp && Date.parse(stamp) >= week.start && Date.parse(stamp) < week.end;
        expect(
          done.some((a) => inWeek(a.completed_at)),
          `${offset}h at ${at}`,
        ).toBe(true);
        expect(
          improved.some((a) => inWeek(a.validated_at)),
          `${offset}h at ${at}`,
        ).toBe(true);
      }
    }
    // The Monday builds (and the ones days before) are opened on a Monday.
    if (/2026-11-1[346]/.test(iso)) expect(mondays).toBeGreaterThan(0);
  });
});

describe('without BUSINESS_HUB_ENABLED', () => {
  it('raises no Business Hub reminder', async () => {
    const rows = await actionCenterRows({ brandId: BRAND_ID, now: new Date(BUILDS[0]), env: {} });
    expect(rows.actions.some((a) => a.kind === NUMBERS_REMINDER_KIND)).toBe(false);
  });
});
