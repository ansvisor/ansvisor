import { describe, expect, it, vi } from 'vitest';

/** /dashboard/action-center opens its first tab, Today. */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const { default: ActionCenterPage } = await import('./page');

describe('the Action Center’s own address', () => {
  it('opens Today', () => {
    expect(() => ActionCenterPage()).toThrow('NEXT_REDIRECT /dashboard/action-center/today');
  });
});
