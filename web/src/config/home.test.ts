import { describe, expect, it } from 'vitest';
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

/** The free trial and the demo start on Chat Home (owner decision 2026-11-06). */
describe('the landing page', () => {
  it('is Chat Home for the trial and the demo, with the new Chat on', () => {
    expect(CHAT_HOME).toBe('/dashboard/chat');
    expect(landingPageFor({ chatOn: true, audience: 'trial' })).toBe(CHAT_HOME);
    expect(landingPageFor({ chatOn: true, audience: 'demo' })).toBe(CHAT_HOME);
  });

  it('is the Action Center for everyone else, and while the new Chat is off', () => {
    expect(landingPageFor({ chatOn: true, audience: null })).toBe(DASHBOARD_HOME);
    expect(landingPageFor({ chatOn: false, audience: 'trial' })).toBe(DASHBOARD_HOME);
    expect(landingPageFor({ chatOn: false, audience: 'demo' })).toBe(DASHBOARD_HOME);
  });
});
