import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * readMyHome: the person's home by their menu and whether their workspace
 * has answers yet (config/home.ts homeFor).
 */

const menu = vi.hoisted(() => ({ hidden: [] as string[] }));
vi.mock('@/lib/actions/menu-access', () => ({ getMyMenu: async () => menu }));

const results = vi.hoisted(() => ({
  rows: [] as { id: string }[],
  error: null as { message: string } | null,
  reads: 0,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      expect(table).toBe('prompt_results');
      return {
        select: () => ({
          limit: async (n: number) => {
            expect(n).toBe(1);
            results.reads += 1;
            return { data: results.rows, error: results.error };
          },
        }),
      };
    },
  }),
}));

const { readMyHome } = await import('./my-home');

beforeEach(() => {
  menu.hidden = [];
  results.rows = [];
  results.error = null;
  results.reads = 0;
});

describe('readMyHome', () => {
  it('opens Brand Visibility’s Overview once the workspace has an answer', async () => {
    results.rows = [{ id: 'r1' }];
    expect(await readMyHome()).toBe('/dashboard/insights');
  });

  it('opens Tracked Prompts before the first answer, or when the read fails', async () => {
    expect(await readMyHome()).toBe('/dashboard/prompts/tracked');
    results.rows = [{ id: 'r1' }];
    results.error = { message: 'timeout' };
    expect(await readMyHome()).toBe('/dashboard/prompts/tracked');
  });

  it('opens Tracked Prompts for a first run under way, without reading answers', async () => {
    results.rows = [{ id: 'r1' }];
    expect(await readMyHome({ firstRun: true })).toBe('/dashboard/prompts/tracked');
    expect(results.reads).toBe(0);
  });

  it('never opens a page off the person’s menu', async () => {
    results.rows = [{ id: 'r1' }];
    menu.hidden = ['insights'];
    expect(await readMyHome()).toBe('/dashboard/prompts/tracked');
    menu.hidden = ['insights', 'prompts'];
    expect(await readMyHome()).toBe('/dashboard/action-center/today');
  });
});
