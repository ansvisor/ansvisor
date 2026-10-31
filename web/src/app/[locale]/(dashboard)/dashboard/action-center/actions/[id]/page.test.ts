import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
}));

import ActionRedirect from './page';

describe("an action's own path", () => {
  beforeEach(() => redirect.mockClear());

  it('opens the Actions page on its drawer', async () => {
    await ActionRedirect({ params: Promise.resolve({ id: 'action-1' }) });
    expect(redirect).toHaveBeenCalledWith('/dashboard/action-center/actions?action=action-1');
  });

  it('keeps an odd id inside the query value', async () => {
    await ActionRedirect({ params: Promise.resolve({ id: 'a&b=c' }) });
    expect(redirect).toHaveBeenCalledWith('/dashboard/action-center/actions?action=a%26b%3Dc');
  });
});
