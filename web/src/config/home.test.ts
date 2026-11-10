import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_HOME,
  DASHBOARD_HOME,
  INSIGHTS_HOME,
  isDashboardHomeItem,
  landingPageFor,
  startsOnInsights,
} from './home';
import { ACTION_CENTER_TABS } from '@/lib/action-center/tabs';

/**
 * New Ansvisor (AC-ALT2 §3): everything starts at the Action Center's
 * Actions, and its tabs read Actions · Signals · KPIs · History.
 */
describe('the dashboard home', () => {
  it("is the Action Center's Actions", () => {
    expect(DASHBOARD_HOME).toBe('/dashboard/action-center/actions');
  });

  it('marks the Action Center item as the one the home page sits under', () => {
    expect(isDashboardHomeItem('/dashboard/action-center')).toBe(true);
    expect(isDashboardHomeItem('/dashboard/action-center/actions')).toBe(true);
    expect(isDashboardHomeItem('/dashboard/insights')).toBe(false);
    expect(isDashboardHomeItem('/dashboard/action')).toBe(false);
  });

  it('opens the Action Center on Actions, then Signals, KPIs and History', () => {
    expect(ACTION_CENTER_TABS.map((tab) => tab.key)).toEqual([
      'actions',
      'signals',
      'kpis',
      'history',
    ]);
    expect(ACTION_CENTER_TABS[0].href).toBe(DASHBOARD_HOME);
  });
});

/**
 * On Ansvisor Cloud, a paid workspace starts on Insights while it is on the
 * person's menu (owner decision 2026-11-10). Else Ansvisor starts on Chat
 * Home with the new Chat on and on the person's menu (2026-11-06: the trial
 * and the demo; 2026-11-09: a payment due, ended and canceled plans too).
 */
describe('the landing page', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is Chat Home with the new Chat on', () => {
    expect(CHAT_HOME).toBe('/dashboard/chat');
    expect(landingPageFor({ chatOn: true })).toBe(CHAT_HOME);
    expect(landingPageFor({ chatOn: true, chatHidden: false })).toBe(CHAT_HOME);
  });

  it("is the Action Center while the new Chat is off, or off the person's menu", () => {
    expect(landingPageFor({ chatOn: false })).toBe(DASHBOARD_HOME);
    expect(landingPageFor({ chatOn: true, chatHidden: true })).toBe(DASHBOARD_HOME);
  });

  it('is Insights for a paid workspace, with the new Chat on or off', () => {
    expect(INSIGHTS_HOME).toBe('/dashboard/insights');
    expect(landingPageFor({ chatOn: true, onInsights: true })).toBe(INSIGHTS_HOME);
    expect(landingPageFor({ chatOn: false, onInsights: true })).toBe(INSIGHTS_HOME);
    expect(landingPageFor({ chatOn: true, chatHidden: true, onInsights: true })).toBe(
      INSIGHTS_HOME,
    );
  });

  it("keeps Chat Home or the Action Center when Insights is off a paid person's menu", () => {
    expect(landingPageFor({ chatOn: true, onInsights: true, insightsHidden: true })).toBe(
      CHAT_HOME,
    );
    expect(
      landingPageFor({ chatOn: true, chatHidden: true, onInsights: true, insightsHidden: true }),
    ).toBe(DASHBOARD_HOME);
    expect(landingPageFor({ chatOn: false, onInsights: true, insightsHidden: true })).toBe(
      DASHBOARD_HOME,
    );
  });

  it('is Chat Home for a new buyer, asked without the plan (the checkout)', () => {
    expect(landingPageFor({ chatOn: true })).toBe(CHAT_HOME);
  });

  it('is the Action Center self-hosted, paid or not', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(landingPageFor({ chatOn: true })).toBe(DASHBOARD_HOME);
    expect(landingPageFor({ chatOn: true, onInsights: true })).toBe(DASHBOARD_HOME);
  });
});

describe('startsOnInsights', () => {
  const DAY = 86_400_000;
  /** A 14-day trial that began at `began`: its end, as subscription_ends_at holds it. */
  const trialFrom = (began: string) => new Date(new Date(began).getTime() + 14 * DAY).toISOString();
  const facts = (patch: Partial<Parameters<typeof startsOnInsights>[0]>) =>
    startsOnInsights({ status: 'trialing', periodEnd: null, trialDays: 14, ...patch });

  it('starts an active plan there, set to cancel at the period end or not', () => {
    expect(facts({ status: 'active' })).toBe(true);
  });

  it('starts a free trial there from its second day, not on its first', () => {
    const periodEnd = trialFrom('2026-11-10T09:00:00Z');
    expect(facts({ periodEnd, now: new Date('2026-11-10T23:59:00Z') })).toBe(false);
    expect(facts({ periodEnd, now: new Date('2026-11-11T00:00:00Z') })).toBe(true);
    expect(facts({ periodEnd, now: new Date('2026-11-20T12:00:00Z') })).toBe(true);
  });

  it("counts the second day from midnight in the person's time zone", () => {
    // 01:30 on November 10 in Istanbul, still November 9 in UTC.
    const periodEnd = trialFrom('2026-11-09T22:30:00Z');
    const evening = new Date('2026-11-10T20:00:00Z'); // 23:00 in Istanbul, the same day
    expect(facts({ periodEnd, timeZone: 'Europe/Istanbul', now: evening })).toBe(false);
    expect(facts({ periodEnd, timeZone: null, now: evening })).toBe(true);
    expect(
      facts({ periodEnd, timeZone: 'Europe/Istanbul', now: new Date('2026-11-10T21:00:00Z') }),
    ).toBe(true);
  });

  it("uses UTC's day for a zone the runtime doesn't know", () => {
    const periodEnd = trialFrom('2026-11-09T22:30:00Z');
    expect(
      facts({ periodEnd, timeZone: 'Mars/Olympus', now: new Date('2026-11-10T20:00:00Z') }),
    ).toBe(true);
  });

  it('keeps a trial without an end date, and every other plan, off it', () => {
    expect(facts({ periodEnd: null, now: new Date('2026-12-01T00:00:00Z') })).toBe(false);
    expect(facts({ periodEnd: 'not a date' })).toBe(false);
    for (const status of ['past_due', 'unpaid', 'canceled', 'inactive', null, undefined]) {
      expect(facts({ status, periodEnd: trialFrom('2026-11-01T00:00:00Z') })).toBe(false);
    }
  });
});
