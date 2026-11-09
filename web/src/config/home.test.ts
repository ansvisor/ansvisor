import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_HOME, DASHBOARD_HOME, isDashboardHomeItem, landingPageFor } from './home';
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
 * Ansvisor starts on Chat Home, whatever the plan (owner decisions
 * 2026-11-06: the trial and the demo; 2026-11-09: paid, ended and canceled
 * plans too), on Ansvisor Cloud with the new Chat on and on the person's menu.
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

  it('is the Action Center self-hosted', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(landingPageFor({ chatOn: true })).toBe(DASHBOARD_HOME);
  });
});
