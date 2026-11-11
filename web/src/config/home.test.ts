import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, isDashboardHomeItem } from './home';
import { ACTION_CENTER_TABS } from '@/lib/action-center/tabs';

/** Where everyone lands: Action Center › Today, whatever the plan, role or install. */

describe('the dashboard home', () => {
  it('is Action Center › Today, the first tab', () => {
    expect(DASHBOARD_HOME).toBe('/dashboard/action-center/today');
    expect(ACTION_CENTER_TABS[0].href).toBe(DASHBOARD_HOME);
  });

  it('makes Today the home, under the Action Center item', () => {
    expect(isDashboardHomeItem('/dashboard/action-center')).toBe(true);
    expect(isDashboardHomeItem('/dashboard/action-center/today')).toBe(true);
    expect(isDashboardHomeItem('/dashboard/action-center/actions')).toBe(false);
    expect(isDashboardHomeItem('/dashboard/insights')).toBe(false);
    expect(isDashboardHomeItem('/dashboard/action')).toBe(false);
  });
});
