import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, homeFor, isDashboardHomeItem, withJobId } from './home';
import { PROMPTS_SECTIONS } from '@/lib/prompts-routes';
import { ACTION_CENTER_TODAY } from '@/lib/action-center/tabs';

/**
 * Where everyone lands (the owner's decision of 2026-11-17): Prompts ›
 * Tracked Prompts, whatever the plan, role, demo or install; Action Center ›
 * Today, on every menu, for someone whose menu leaves Prompts off.
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

describe('homeFor', () => {
  it('is Tracked Prompts while Prompts is on the person’s menu', () => {
    expect(homeFor()).toBe(DASHBOARD_HOME);
    expect(homeFor([])).toBe(DASHBOARD_HOME);
    expect(homeFor(['mentions', 'content', 'audit'])).toBe(DASHBOARD_HOME);
    expect(homeFor(new Set(['insights']))).toBe(DASHBOARD_HOME);
  });

  it('is Action Center › Today, on every menu, when Prompts is off it', () => {
    expect(ACTION_CENTER_TODAY).toBe('/dashboard/action-center/today');
    expect(homeFor(['prompts'])).toBe(ACTION_CENTER_TODAY);
    expect(homeFor(new Set(['mentions', 'prompts']))).toBe(ACTION_CENTER_TODAY);
  });

  it('marks the menu item of whichever home it is', () => {
    const fallback = homeFor(['prompts']);
    expect(isDashboardHomeItem('/dashboard/action-center', fallback)).toBe(true);
    expect(isDashboardHomeItem('/dashboard/prompts', fallback)).toBe(false);
    expect(isDashboardHomeItem('/dashboard/prompts', homeFor([]))).toBe(true);
  });
});

describe('withJobId', () => {
  it('carries the first run’s job, or nothing', () => {
    expect(withJobId('/dashboard', 'job 1')).toBe('/dashboard?jobId=job%201');
    expect(withJobId(DASHBOARD_HOME, null)).toBe(DASHBOARD_HOME);
    expect(withJobId(DASHBOARD_HOME, '')).toBe(DASHBOARD_HOME);
  });
});
