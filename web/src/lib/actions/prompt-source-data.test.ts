import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';

/**
 * addPromptToSet keeps where a prompt came from (prompts.source_data, 00525,
 * AC plan P-8) only for a catalog suggestion's prompt, and only in its own
 * shape. Any other add never names the column, and a database that turns it
 * down (no 00525 yet, or its check) still gets the prompt.
 */

/** Rows the prompts insert was sent, in order. */
let inserts: Record<string, unknown>[] = [];
/** The errors the next prompts inserts answer with, in order; none succeed. */
let insertErrors: { code: string; message: string }[] = [];
/** The org's tracked locations used, against the growth plan's. */
let locationsUsed = 0;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/volumes', () => ({ getPromptVolumes: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({
  getPromptVisibilitySummaries: vi.fn(),
  analyzeNewPrompts: vi.fn(async () => ({ started: true })),
}));
vi.mock('@/lib/guards/plan-guard', () => ({
  getOrgPlan: vi.fn(async () => PLANS.growth),
  ORG_PLAN_COLUMNS: 'plan',
  planFromOrgRow: vi.fn(() => PLANS.growth),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async () => ({ data: [{ brand_id: 'b1', locations: locationsUsed }], error: null }),
    from: (table: string) => {
      let inserted: Record<string, unknown> | null = null;
      const read = () => {
        if (table === 'topics') return { data: [{ id: 't1', name: 'Hiking' }], error: null };
        if (table === 'prompt_sets') return { data: { id: 'ps1', brand_id: 'b1' }, error: null };
        if (table === 'brands') {
          return {
            data: { organization_id: 'org-1', region: 'US', shopping_mode_enabled: false },
            error: null,
          };
        }
        if (table === 'prompts' && inserted) {
          const error = insertErrors.shift();
          if (error) return { data: null, error };
          return { data: { id: 'p1', prompt_set_id: 'ps1', ...inserted }, error: null };
        }
        return { data: [], error: null };
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          inserted = row;
          return chain;
        },
        single: async () => read(),
        maybeSingle: async () => {
          const result = read();
          const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return { ...result, data };
        },
        then: (resolve: (value: unknown) => unknown) => resolve(read()),
      };
      return chain;
    },
  })),
}));

const { addPromptToSet } = await import('./prompt');

const fromProduct = {
  kind: 'catalog_product' as const,
  product_ids: ['7a1c2b9e-1111-4c3d-8e9f-000000000001'],
  category_id: '7a1c2b9e-2222-4c3d-8e9f-000000000002',
  category: 'Bags > Hiking backpacks',
  suggested_at: '2026-11-09T08:00:00+00:00',
};

const add = (sourceData?: unknown) =>
  addPromptToSet({
    promptSetId: 'ps1',
    text: 'Best hiking backpack for a week-long trek?',
    category: 'Hiking',
    platforms: ['chatgpt-web'],
    sourceData: sourceData as typeof fromProduct,
  });

beforeEach(() => {
  inserts = [];
  insertErrors = [];
  locationsUsed = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('addPromptToSet and where a prompt came from', () => {
  it('keeps a catalog suggestion’s source with the prompt', async () => {
    expect('prompt' in (await add(fromProduct))).toBe(true);
    expect(inserts).toEqual([expect.objectContaining({ source_data: fromProduct })]);
  });

  it('never names the column for any other prompt', async () => {
    await add();
    await add(null);
    expect(inserts).toHaveLength(2);
    expect(inserts.every((row) => !('source_data' in row))).toBe(true);
  });

  it('drops a source that isn’t in its shape, and adds the prompt', async () => {
    expect('prompt' in (await add({ ...fromProduct, note: 'x'.repeat(5000) }))).toBe(true);
    expect('source_data' in inserts[0]).toBe(false);
  });

  it('adds the prompt without it when the database has no column for it yet', async () => {
    insertErrors = [
      {
        code: 'PGRST204',
        message: "Could not find the 'source_data' column of 'prompts' in the schema cache",
      },
    ];
    expect(await add(fromProduct)).toMatchObject({ prompt: { id: 'p1' } });
    expect(inserts).toHaveLength(2);
    expect('source_data' in inserts[1]).toBe(false);
  });

  it('reports any other failure as before, without a second try', async () => {
    insertErrors = [{ code: '23505', message: 'duplicate key value' }];
    expect(await add(fromProduct)).toEqual({ error: 'duplicate key value' });
    expect(inserts).toHaveLength(1);
  });

  it('waits for a spot at the plan’s limit like any other prompt', async () => {
    locationsUsed = PLANS.growth.limits.maxPrompts;
    expect(await add(fromProduct)).toMatchObject({ waiting: true });
  });
});
