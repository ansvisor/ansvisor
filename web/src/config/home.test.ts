import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, isDashboardHomeItem } from './home';
import { PROMPTS_SECTIONS } from '@/lib/prompts-routes';

/**
 * Where everyone lands (the owner's decision of 2026-11-17): Prompts ›
 * Tracked Prompts, whatever the plan, role, demo or install.
 */

describe('the dashboard home', () => {
  it('is Prompts › Tracked Prompts, the first Prompts view', () => {
    expect(DASHBOARD_HOME).toBe('/dashboard/prompts/tracked');
    expect(PROMPTS_SECTIONS[0].href).toBe(DASHBOARD_HOME);
  });

  it('makes Tracked Prompts the home, under the Prompts item', () => {
    expect(isDashboardHomeItem('/dashboard/prompts')).toBe(true);
    expect(isDashboardHomeItem('/dashboard/prompts/tracked')).toBe(true);
    expect(isDashboardHomeItem('/dashboard/prompts/suggestions')).toBe(false);
    expect(isDashboardHomeItem('/dashboard/action-center')).toBe(false);
    expect(isDashboardHomeItem('/dashboard/action-center/today')).toBe(false);
    expect(isDashboardHomeItem('/dashboard/prompt')).toBe(false);
  });
});
