import { describe, expect, it } from 'vitest';
import {
  dayByDay,
  frictionOf,
  normalisePath,
  pickReplays,
  summariseActivity,
  token,
} from './activity.js';

/**
 * The person's PostHog rows made into what the team reads: day by day (UTC),
 * where they got stuck, and the sessions to watch.
 */

const BRAND = '0f1e2d3c-4b5a-4968-8776-655443322110';
const S1 = '019a6b2c-1111-7000-8000-000000000001';
const S2 = '019a6b2c-2222-7000-8000-000000000002';
const S3 = '019a6b2c-3333-7000-8000-000000000003';
const S4 = '019a6b2c-4444-7000-8000-000000000004';

const rows = ({ pageviews = [], events = [], clicks = [] } = {}) => ({
  ok: true,
  days: 14,
  appHost: 'https://eu.posthog.com',
  projectId: '12345',
  pageviews,
  events,
  clicks,
});
const view = (timestamp, pathname, sid = S1) => ({ timestamp, pathname, sid });
const act = (event, timestamp, props = {}) => ({
  event,
  timestamp,
  pathname: '/dashboard',
  sid: S1,
  ...props,
});
const click = (url, type, n, sid = S1, first_at = '2026-11-09T10:00:00Z') => ({
  url,
  sid,
  type,
  n,
  first_at,
});

describe('normalisePath', () => {
  it('turns ids into :id and drops the /en prefix and a trailing slash', () => {
    expect(normalisePath(`/en/dashboard/brands/${BRAND}/content/${BRAND.toUpperCase()}`)).toBe(
      '/dashboard/brands/:id/content/:id',
    );
    expect(normalisePath('/en')).toBe('/');
    expect(normalisePath('/en/')).toBe('/');
    expect(normalisePath('/dashboard/')).toBe('/dashboard');
    expect(normalisePath('/enterprise')).toBe('/enterprise');
    expect(normalisePath('/dashboard/settings/billing')).toBe('/dashboard/settings/billing');
  });

  it('reads a full address as its path, without its query', () => {
    expect(normalisePath(`https://app.ansvisor.com/en/dashboard/brands/${BRAND}?tab=1#x`)).toBe(
      '/dashboard/brands/:id',
    );
  });

  it('hides other ids too: long numbers and long tokens with digits, not long words', () => {
    expect(normalisePath('/dashboard/shopping/products/8812345')).toBe(
      '/dashboard/shopping/products/:id',
    );
    expect(normalisePath('/share/a8F3kL9qPz2xW7vB1nM4tR')).toBe('/share/:id');
    expect(normalisePath('/dashboard/ai-visibility-recommendations')).toBe(
      '/dashboard/ai-visibility-recommendations',
    );
  });

  it('answers nothing for no path', () => {
    expect(normalisePath(null)).toBe('');
    expect(normalisePath('')).toBe('');
    expect(normalisePath('not a path')).toBe('');
  });
});

describe('token', () => {
  it('keeps the app’s own names and drops anything else', () => {
    expect(token('brand_add')).toBe('brand_add');
    expect(token('plan-limit')).toBe('plan-limit');
    expect(token(403)).toBe('403');
    expect(token('acme.example')).toBeNull();
    expect(token('Ada Lovelace')).toBeNull();
    expect(token('ada@acme.example')).toBeNull();
    expect(token(null)).toBeNull();
    expect(token({})).toBeNull();
  });
});

describe('dayByDay', () => {
  const tidyOf = (input) => {
    // dayByDay reads summariseActivity's tidy rows; going through it is the honest way.
    const summary = summariseActivity(rows(input), { distinctId: 'u1' });
    return summary.dayByDay;
  };

  it('groups by UTC day, oldest first, whatever the project’s time zone', () => {
    const days = tidyOf({
      pageviews: [
        // Newest first, as PostHog answers. 01:30 in Istanbul is the day before in UTC.
        view('2026-11-10T09:00:00Z', '/dashboard'),
        view('2026-11-09T01:30:00+03:00', '/en/dashboard/prompts'),
        view('2026-11-07T12:00:00Z', '/dashboard/settings'),
      ],
    });
    expect(days.map((d) => d.day)).toEqual(['2026-11-07', '2026-11-08', '2026-11-10']);
    expect(days[1].pages).toEqual(['/dashboard/prompts']);
  });

  it('lists the pages in the order they went, the same page twice in a row once', () => {
    const [day] = tidyOf({
      pageviews: [
        view('2026-11-09T10:05:00Z', '/dashboard'),
        view('2026-11-09T10:04:00Z', `/dashboard/brands/${BRAND}/prompts`),
        view('2026-11-09T10:03:00Z', '/dashboard'),
        view('2026-11-09T10:02:00Z', '/en/dashboard'),
        view('2026-11-09T10:01:00Z', '/dashboard'),
      ],
    });
    expect(day.pages).toEqual(['/dashboard', '/dashboard/brands/:id/prompts', '/dashboard']);
    expect(day.morePages).toBe(0);
  });

  it('lists twelve pages a day at most, and counts the rest', () => {
    const pageviews = Array.from({ length: 15 }, (_, i) =>
      view(
        `2026-11-09T10:${String(i).padStart(2, '0')}:00Z`,
        `/page-${String.fromCharCode(97 + i)}`,
      ),
    );
    const [day] = tidyOf({ pageviews });
    expect(day.pages).toHaveLength(12);
    expect(day.pages[0]).toBe('/page-a');
    expect(day.pages[11]).toBe('/page-l');
    expect(day.morePages).toBe(3);
  });

  it('counts the day’s product events, most first, and lists its sessions with their replays', () => {
    const [day] = tidyOf({
      pageviews: [view('2026-11-09T10:00:00Z', '/dashboard', S1)],
      events: [
        act('prompt_added', '2026-11-09T10:01:00Z'),
        act('prompt_added', '2026-11-09T10:02:00Z', { sid: S2 }),
        act('brand_switched', '2026-11-09T10:03:00Z'),
        act('survey shown', '2026-11-09T10:03:30Z'),
        act('$autocapture', '2026-11-09T10:04:00Z'),
      ],
    });
    expect(day.events).toEqual([
      { event: 'prompt_added', count: 2 },
      { event: 'brand_switched', count: 1 },
      { event: 'survey shown', count: 1 },
    ]);
    expect(day.sessions).toEqual([
      { id: S1, url: `https://eu.posthog.com/project/12345/replay/${S1}` },
      { id: S2, url: `https://eu.posthog.com/project/12345/replay/${S2}` },
    ]);
  });

  it('takes rows already tidied', () => {
    const at = Date.parse('2026-11-09T10:00:00Z');
    expect(dayByDay({ visits: [{ at, page: '/x', sid: null }], acts: [] })).toEqual([
      { day: '2026-11-09', pages: ['/x'], morePages: 0, events: [], sessions: [] },
    ]);
  });
});

describe('frictionOf', () => {
  const friction = (input) => summariseActivity(rows(input), { distinctId: 'u1' }).friction;

  it('counts rage and dead clicks by page from the heatmap rows', () => {
    const { clicksByPage } = friction({
      clicks: [
        click(`https://app.ansvisor.com/en/dashboard/brands/${BRAND}/prompts?x=1`, 'rageclick', 4),
        click(`https://app.ansvisor.com/dashboard/brands/${BRAND}/prompts`, 'rageclick', 2, S2),
        click(`https://app.ansvisor.com/dashboard/brands/${BRAND}/prompts`, 'deadclick', 3, S2),
        click('https://app.ansvisor.com/dashboard/settings/billing', 'deadclick', 1),
        // Only rage and dead clicks are asked for; anything else is ignored.
        click('https://app.ansvisor.com/dashboard', 'click', 40),
        click('https://app.ansvisor.com/dashboard', 'mousemove', 90),
      ],
    });
    expect(clicksByPage).toEqual([
      { page: '/dashboard/brands/:id/prompts', rage: 6, dead: 3 },
      { page: '/dashboard/settings/billing', rage: 0, dead: 1 },
    ]);
  });

  it('lists the flows started and never completed, and the failed ones, by flow', () => {
    const { flowsNotFinished } = friction({
      events: [
        act('flow_started', '2026-11-09T10:00:00Z', { flow: 'brand_add' }),
        act('flow_failed', '2026-11-09T10:01:00Z', {
          flow: 'brand_add',
          error_code: 'plan_limit',
          target: 'acme.example',
        }),
        act('flow_started', '2026-11-09T10:02:00Z', { flow: 'brand_add' }),
        act('flow_started', '2026-11-09T10:03:00Z', { flow: 'brand_add' }),
        act('flow_completed', '2026-11-09T10:04:00Z', { flow: 'brand_add' }),
        // Done: not listed.
        act('flow_started', '2026-11-09T10:05:00Z', { flow: 'prompt_add' }),
        act('flow_completed', '2026-11-09T10:06:00Z', { flow: 'prompt_add' }),
        // Failed without a start of its own: still listed.
        act('flow_failed', '2026-11-09T10:07:00Z', {
          flow: 'cms_connect',
          target: 'wordpress',
          error_code: 401,
        }),
      ],
    });
    expect(flowsNotFinished).toEqual([
      {
        flow: 'brand_add',
        started: 3,
        completed: 1,
        failed: 1,
        notCompleted: 2,
        errorCodes: ['plan_limit'],
        // A target that isn't an app name (a domain) is dropped.
        targets: [],
      },
      {
        flow: 'cms_connect',
        started: 0,
        completed: 0,
        failed: 1,
        notCompleted: 0,
        errorCodes: ['401'],
        targets: ['wordpress'],
      },
    ]);
  });

  it('counts the upgrade walls by feature and the errors by page', () => {
    const { walls, errorsByPage } = friction({
      events: [
        act('upgrade_wall_shown', '2026-11-09T10:00:00Z', {
          feature: 'brands',
          reason: 'limit',
          source: 'brand_switcher',
        }),
        act('upgrade_wall_shown', '2026-11-09T10:01:00Z', { feature: 'brands', reason: 'limit' }),
        act('upgrade_wall_shown', '2026-11-09T10:02:00Z', { feature: 'Ada’s secret plan' }),
        act('error_shown', '2026-11-09T10:03:00Z', {
          pathname: `/en/dashboard/brands/${BRAND}/content`,
          kind: 'network',
        }),
        act('error_shown', '2026-11-09T10:04:00Z', {
          pathname: `/dashboard/brands/${BRAND}/content`,
          kind: 'server',
        }),
      ],
    });
    expect(walls).toEqual([
      { feature: 'brands', count: 2, reasons: ['limit'], sources: ['brand_switcher'] },
      { feature: 'unknown', count: 1, reasons: [], sources: [] },
    ]);
    expect(errorsByPage).toEqual([
      { page: '/dashboard/brands/:id/content', count: 2, kinds: ['network', 'server'] },
    ]);
  });

  it('keeps the cancel flow’s steps in order', () => {
    const { cancelFlow } = friction({
      events: [
        act('subscription_canceled', '2026-11-10T09:05:00Z'),
        act('cancel_dialog_opened', '2026-11-10T09:00:00Z'),
        act('cancel_dialog_closed', '2026-11-08T12:00:00Z'),
        act('cancel_dialog_opened', '2026-11-08T11:59:00Z'),
      ],
    });
    expect(cancelFlow).toEqual([
      { event: 'cancel_dialog_opened', at: '2026-11-08T11:59:00.000Z' },
      { event: 'cancel_dialog_closed', at: '2026-11-08T12:00:00.000Z' },
      { event: 'cancel_dialog_opened', at: '2026-11-10T09:00:00.000Z' },
      { event: 'subscription_canceled', at: '2026-11-10T09:05:00.000Z' },
    ]);
  });

  it('is empty when nothing went wrong', () => {
    expect(frictionOf({ acts: [], marks: [] })).toEqual({
      walls: [],
      errorsByPage: [],
      flowsNotFinished: [],
      clicksByPage: [],
      cancelFlow: [],
    });
  });
});

describe('pickReplays', () => {
  const replays = (input) => summariseActivity(rows(input), { distinctId: 'u1' }).replays;

  it('picks the three sessions with the most friction, with their day, page and replay', () => {
    const picked = replays({
      pageviews: [
        view('2026-11-08T09:00:00Z', '/dashboard', S1),
        view('2026-11-08T09:01:00Z', '/dashboard/prompts', S1),
        view('2026-11-09T09:00:00Z', '/dashboard/settings', S2),
        view('2026-11-09T09:05:00Z', '/dashboard/settings', S2),
        view('2026-11-07T09:00:00Z', '/dashboard', S3),
        view('2026-11-10T09:00:00Z', '/dashboard', S4),
      ],
      events: [
        act('error_shown', '2026-11-09T09:02:00Z', { sid: S2, pathname: '/dashboard/content' }),
        act('flow_failed', '2026-11-09T09:03:00Z', { sid: S2, flow: 'content_generate' }),
        act('upgrade_wall_shown', '2026-11-07T09:01:00Z', {
          sid: S3,
          feature: 'prompts',
          pathname: null,
        }),
        // Not friction: S4 has none.
        act('prompt_added', '2026-11-10T09:01:00Z', { sid: S4 }),
      ],
      clicks: [
        click('https://app.ansvisor.com/dashboard/prompts', 'rageclick', 5, S1),
        click('https://app.ansvisor.com/dashboard/prompts', 'deadclick', 1, S1),
        click('https://app.ansvisor.com/dashboard/content', 'deadclick', 1, S2),
      ],
    });
    expect(picked).toEqual([
      {
        id: S1,
        score: 6,
        day: '2026-11-08',
        page: '/dashboard/prompts',
        rage: 5,
        dead: 1,
        errors: 0,
        walls: 0,
        failedFlows: 0,
        url: `https://eu.posthog.com/project/12345/replay/${S1}`,
      },
      {
        id: S2,
        score: 3,
        day: '2026-11-09',
        page: '/dashboard/content',
        rage: 0,
        dead: 1,
        errors: 1,
        walls: 0,
        failedFlows: 1,
        url: `https://eu.posthog.com/project/12345/replay/${S2}`,
      },
      {
        id: S3,
        score: 1,
        day: '2026-11-07',
        // No page of its own: the one they viewed most.
        page: '/dashboard',
        rage: 0,
        dead: 0,
        errors: 0,
        walls: 1,
        failedFlows: 0,
        url: `https://eu.posthog.com/project/12345/replay/${S3}`,
      },
    ]);
  });

  it('keeps three at most, the most recent first among equals', () => {
    const sessions = [S1, S2, S3, S4];
    const picked = replays({
      clicks: sessions.map((sid, i) =>
        click(
          'https://app.ansvisor.com/dashboard',
          'rageclick',
          2,
          sid,
          `2026-11-0${i + 1}T10:00:00Z`,
        ),
      ),
    });
    expect(picked.map((replay) => replay.id)).toEqual([S4, S3, S2]);
  });

  it('lists none when no session had friction', () => {
    expect(pickReplays({ visits: [{ at: 1, page: '/x', sid: S1 }], acts: [], marks: [] })).toEqual(
      [],
    );
  });
});

describe('summariseActivity', () => {
  it('counts the days, sessions and page views, with the last moment seen and their profile', () => {
    const summary = summariseActivity(
      rows({
        pageviews: [
          view('2026-11-09T10:00:00Z', '/dashboard', S2),
          view('2026-11-08T10:00:00Z', '/dashboard', S1),
        ],
        events: [act('cancel_dialog_opened', '2026-11-09T10:30:00Z', { sid: S2 })],
      }),
      { distinctId: 'u 1', rowLimit: 2000 },
    );
    expect(summary).toMatchObject({
      ok: true,
      days: 14,
      totals: {
        activeDays: 2,
        sessions: 2,
        pageviews: 2,
        lastSeen: '2026-11-09T10:30:00.000Z',
      },
      truncated: false,
      personUrl: 'https://eu.posthog.com/project/12345/person/u%201',
    });
  });

  it('says nobody was seen with no rows, and when a read hit its limit', () => {
    expect(summariseActivity(rows(), { distinctId: 'u1' })).toMatchObject({
      totals: { activeDays: 0, sessions: 0, pageviews: 0, lastSeen: null },
      dayByDay: [],
      replays: [],
    });
    const full = rows({
      pageviews: Array.from({ length: 3 }, () => view('2026-11-09T10:00:00Z', '/x')),
    });
    expect(summariseActivity(full, { distinctId: 'u1', rowLimit: 3 }).truncated).toBe(true);
  });
});
