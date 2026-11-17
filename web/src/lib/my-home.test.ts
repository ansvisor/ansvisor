import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMyMenu = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/menu-access', () => ({ getMyMenu }));

const { readMyHome } = await import('./my-home');

/** The signed-in person's home, by their menu as the sidebar reads it (getMyMenu). */
describe('readMyHome', () => {
  const menu = (hidden: string[]) => ({
    hidden,
    hiddenByAdmin: hidden,
    workAreas: [],
    canManageMenus: false,
  });

  beforeEach(() => {
    getMyMenu.mockReset();
  });

  it('is Tracked Prompts with Prompts on the person’s menu', async () => {
    getMyMenu.mockResolvedValue(menu(['mentions']));
    expect(await readMyHome()).toBe('/dashboard/prompts/tracked');
  });

  it('is Action Center › Today with Prompts off it, by the role, an exception or work areas', async () => {
    getMyMenu.mockResolvedValue(menu(['prompts', 'content']));
    expect(await readMyHome()).toBe('/dashboard/action-center/today');
  });

  it('is the default home when there is no menu to read', async () => {
    getMyMenu.mockRejectedValue(new Error('No organization'));
    expect(await readMyHome()).toBe('/dashboard/prompts/tracked');
  });
});
