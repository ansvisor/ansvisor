import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * /dashboard/action-center opens its first tab: Actions, or Today with the
 * simplified layout on (SIMPLE_NAV).
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const { default: ActionCenterPage } = await import('./page');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the Action Center’s own address', () => {
  it('opens Actions while SIMPLE_NAV is off', () => {
    vi.stubEnv('SIMPLE_NAV', undefined);
    expect(() => ActionCenterPage()).toThrow('NEXT_REDIRECT /dashboard/action-center/actions');
  });

  it('opens Today with SIMPLE_NAV on', () => {
    vi.stubEnv('SIMPLE_NAV', 'true');
    expect(() => ActionCenterPage()).toThrow('NEXT_REDIRECT /dashboard/action-center/today');
  });
});
