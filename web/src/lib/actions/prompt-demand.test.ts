import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AC-003: the Affected tab's volumes come from prompt_volumes, a server-only
 * table. Only prompts of the brand the caller can see are read.
 */

let visible: { id: string }[];
let volumeReads: string[][];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        then: (resolve: (value: unknown) => unknown) => resolve({ data: visible, error: null }),
      };
      return chain;
    },
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      let ids: string[] = [];
      const chain = {
        select: () => chain,
        in: (_column: string, values: string[]) => {
          ids = values;
          volumeReads.push(values);
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            data: ids.map((id) => ({ prompt_id: id, est_ai_volume: id === 'p2' ? 0 : 1200 })),
            error: null,
          }),
      };
      return chain;
    },
  },
}));

const { getPromptDemand } = await import('./action-center');

beforeEach(() => {
  visible = [{ id: 'p1' }, { id: 'p2' }];
  volumeReads = [];
});

describe('getPromptDemand', () => {
  it("reads the volumes of the brand's prompts the caller can see, and only those", async () => {
    visible = [{ id: 'p1' }];
    const demand = await getPromptDemand('b1', ['p1', 'other-brand']);
    expect(volumeReads).toEqual([['p1']]);
    expect(demand).toEqual({ p1: 1200 });
  });

  it('leaves out a prompt without demand', async () => {
    await expect(getPromptDemand('b1', ['p1', 'p2'])).resolves.toEqual({ p1: 1200 });
  });

  it('reads nothing for no prompts', async () => {
    await expect(getPromptDemand('b1', [])).resolves.toEqual({});
    expect(volumeReads).toEqual([]);
  });
});
