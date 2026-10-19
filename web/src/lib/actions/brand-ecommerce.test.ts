import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * markBrandAsEcommerce: setup found the brand sells online, so its industry
 * becomes E-commerce & Retail when it has none and Shopping mode goes on
 * (ChatGPT Shopping on every prompt, the brand_platforms row), which shows
 * Product Visibility in the menu.
 */

let brand: { industry: string | null; shopping_mode_enabled: boolean };
let prompts: { id: string; platforms: string[] }[];
let writes: { table: string; op: string; value: unknown }[];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/guards/plan-guard', () => ({ getOrgPlan: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      let op = 'select';
      let value: unknown = null;
      const settle = async () => {
        if (op !== 'select') {
          writes.push({ table, op, value });
          return { error: null };
        }
        return { data: table === 'prompts' ? prompts : brand, error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: settle,
        update: (patch: unknown) => {
          op = 'update';
          value = patch;
          return chain;
        },
        upsert: (row: unknown) => {
          op = 'upsert';
          value = row;
          return settle();
        },
        then: (resolve: (v: unknown) => unknown) => settle().then(resolve),
      };
      return chain;
    },
  })),
}));

const { markBrandAsEcommerce } = await import('./brand');

beforeEach(() => {
  brand = { industry: null, shopping_mode_enabled: false };
  prompts = [
    { id: 'p1', platforms: ['chatgpt-web'] },
    { id: 'p2', platforms: ['chatgpt-web', 'chatgpt-shopping'] },
  ];
  writes = [];
});

describe('markBrandAsEcommerce', () => {
  it('sets the industry and turns Shopping mode on', async () => {
    expect(await markBrandAsEcommerce('b1')).toEqual({
      industry: 'E-commerce & Retail',
      promptsUpdated: 1,
    });
    expect(writes).toEqual([
      { table: 'brands', op: 'update', value: { industry: 'E-commerce & Retail' } },
      { table: 'brands', op: 'update', value: { shopping_mode_enabled: true } },
      { table: 'prompts', op: 'update', value: { platforms: ['chatgpt-web', 'chatgpt-shopping'] } },
      {
        table: 'brand_platforms',
        op: 'upsert',
        value: { brand_id: 'b1', platform: 'chatgpt-shopping', is_enabled: true },
      },
    ]);
  });

  it('keeps an industry the brand already has', async () => {
    brand.industry = 'Food & Beverage';
    expect(await markBrandAsEcommerce('b1')).toMatchObject({ industry: 'Food & Beverage' });
    expect(writes.some((w) => (w.value as { industry?: string })?.industry)).toBe(false);
  });

  it('leaves a brand already in Shopping mode as it is', async () => {
    brand = { industry: 'Fashion & Apparel', shopping_mode_enabled: true };
    expect(await markBrandAsEcommerce('b1')).toEqual({
      industry: 'Fashion & Apparel',
      promptsUpdated: 0,
    });
    expect(writes).toEqual([]);
  });
});
