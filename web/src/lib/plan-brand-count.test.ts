import { describe, expect, it, vi } from 'vitest';
import { countPlanBrands } from './plan-brand-count';

type Client = Parameters<typeof countPlanBrands>[0];

function client(answer: { data: number | null; error: { message: string } | null }, seen = 0) {
  const filters: unknown[][] = [];
  const rpc = vi.fn(async () => answer);
  const chain = {
    select: () => chain,
    eq: (...filter: unknown[]) => {
      filters.push(filter);
      return chain;
    },
    then: (resolve: (value: { count: number }) => void) => resolve({ count: seen }),
  };
  const from = vi.fn(() => chain);
  return { db: { rpc, from } as unknown as Client, rpc, from, filters };
}

describe('countPlanBrands', () => {
  it('counts every brand of the organization, not only the ones the person sees (00390)', async () => {
    const { db, rpc, from } = client({ data: 3, error: null }, 1);

    expect(await countPlanBrands(db, 'org-1')).toBe(3);
    expect(rpc).toHaveBeenCalledWith('org_brand_count', { p_organization_id: 'org-1' });
    expect(from).not.toHaveBeenCalled();
  });

  it('falls back to the brands the person reads, the demo brand left out, until 00390 is on the database', async () => {
    const { db, from, filters } = client(
      { data: null, error: { message: 'function public.org_brand_count does not exist' } },
      2,
    );

    expect(await countPlanBrands(db, 'org-1')).toBe(2);
    expect(from).toHaveBeenCalledWith('brands');
    expect(filters).toEqual([
      ['organization_id', 'org-1'],
      ['is_demo', false],
    ]);
  });
});
