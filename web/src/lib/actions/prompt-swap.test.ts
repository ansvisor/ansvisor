// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * The Prompt-limit dialog's server side (Simplify PR 16, SIMPLE_NAV): the
 * prompts someone could pause, from every brand of the workspace they can
 * see, the least useful first; and the swap, which pauses the picks first,
 * then tracks the waiting prompt through the metered activation, and tracks
 * the picks again when that fails. A prompt in several locations needs that
 * many spots.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  maxPrompts: 4,
  activate: null as null | ((id: string) => unknown),
  demand: {} as Record<string, number>,
  answers: {} as Record<string, { runs: number; mentionAnswers: number }>,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(fake.db, {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    }),
}));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/guards/plan-guard', async () => {
  const { PLANS } = await import('@/config/plans');
  return {
    getOrgPlan: vi.fn(async () => ({
      ...PLANS.starter,
      limits: { ...PLANS.starter.limits, maxPrompts: fake.maxPrompts },
    })),
  };
});
const setPromptActive = vi.hoisted(() =>
  vi.fn(async (...args: [id: string, active: boolean]) => fake.activate!(args[0])),
);
vi.mock('@/lib/actions/prompt', () => ({ setPromptActive }));
vi.mock('@/lib/action-center/prompt-demand', () => ({
  readPromptDemand: vi.fn(
    async (_client: unknown, _brand: string, ids: string[]) =>
      new Map(ids.filter((id) => id in fake.demand).map((id) => [id, { value: fake.demand[id] }])),
  ),
}));
vi.mock('@/lib/actions/tracking', () => ({
  getPromptVisibilitySummaries: vi.fn(async () => fake.answers),
}));

const { createFakeSupabase } = await import('@/lib/chat/testing/fake-supabase');
const { getSwapOptions, swapPrompts } = await import('./prompt-swap');

type Row = Record<string, unknown>;
const BRANDS: Record<string, { name: string; org: string; demo?: boolean }> = {
  b1: { name: 'Brewline', org: 'org' },
  b2: { name: 'Brewline Tea', org: 'org' },
  demo: { name: 'Demo', org: 'org', demo: true },
  elsewhere: { name: 'Other workspace', org: 'org-2' },
};

/** A prompt on a brand, joined to its set and brand as the reads select it. */
const prompt = (id: string, brand: string, over: Row = {}): Row => ({
  id,
  text: `Prompt ${id}`,
  regions: ['US'],
  is_active: true,
  waiting_since: null,
  prompt_sets: {
    brand_id: brand,
    brands: { organization_id: BRANDS[brand].org, is_demo: BRANDS[brand].demo === true },
  },
  'prompt_sets.brand_id': brand,
  ...over,
});
const waiting = (id: string, regions = ['US']) =>
  prompt(id, 'b1', { is_active: false, waiting_since: '2026-11-10T09:00:00Z', regions });
const rows = () => fake.db.tables.prompts as Row[];
const row = (id: string) => rows().find((r) => r.id === id)!;
const updates = () =>
  fake.db.log.filter(([table, kind]) => table === 'prompts' && kind === 'update');

beforeEach(() => {
  fake.maxPrompts = 4;
  fake.demand = {};
  fake.answers = {};
  fake.db = createFakeSupabase();
  Object.assign(fake.db.tables, {
    profiles: [{ id: 'u1', role: 'manager' }],
    brands: Object.entries(BRANDS).map(([id, b]) => ({
      id,
      name: b.name,
      organization_id: b.org,
      is_demo: b.demo === true,
    })),
    prompts: [
      prompt('a', 'b1'),
      prompt('b', 'b1'),
      prompt('c', 'b2'),
      prompt('d', 'b2'),
      waiting('w'),
    ],
  });
  // Active locations per brand, as org_prompt_location_usage counts them.
  fake.db.rpcs = {
    org_prompt_location_usage: () => {
      const byBrand = new Map<string, number>();
      for (const p of rows().filter((r) => r.is_active)) {
        const brand = p['prompt_sets.brand_id'] as string;
        const cost = Math.max((p.regions as string[]).length, 1);
        byBrand.set(brand, (byBrand.get(brand) ?? 0) + cost);
      }
      return [...byBrand].map(([brand_id, locations]) => ({ brand_id, locations }));
    },
  };
  // The metered activation, as setPromptActive does it: refused past the limit.
  fake.activate = (id) => {
    const used = rows()
      .filter((r) => r.is_active)
      .reduce((sum, r) => sum + Math.max((r.regions as string[]).length, 1), 0);
    if (used + Math.max((row(id).regions as string[]).length, 1) > fake.maxPrompts) {
      return { error: 'Your Starter plan allows up to …', code: 'plan_limit' };
    }
    Object.assign(row(id), { is_active: true, waiting_since: null });
    return { prompt: { id, isActive: true } };
  };
  setPromptActive.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe('getSwapOptions', () => {
  it("lists this brand's prompts first, then the other brands', each the least useful first", async () => {
    fake.demand = { a: 900, b: 10, c: 500, d: 20 };
    fake.answers = {
      a: { runs: 30, mentionAnswers: 0 },
      b: { runs: 30, mentionAnswers: 6 },
      c: { runs: 30, mentionAnswers: 1 },
      d: { runs: 30, mentionAnswers: 9 },
    };
    const options = await getSwapOptions('w');
    if ('error' in options) throw new Error(options.error);
    expect(options.prompt).toEqual({
      id: 'w',
      text: 'Prompt w',
      brandId: 'b1',
      locations: 1,
      waiting: true,
    });
    expect(options.plan).toEqual({ id: 'starter', name: 'Starter', max: 4, used: 4 });
    expect(options.growthPrompts).toBe(200);
    // Demand in thirds of each brand's own (as Today's first day reads it):
    // of two, the higher is high and the lower medium.
    expect(options.candidates.map((c) => [c.id, c.current, c.demand, c.mentions])).toEqual([
      ['b', true, 'medium', 6],
      ['a', true, 'high', 0],
      ['d', false, 'medium', 9],
      ['c', false, 'high', 1],
    ]);
    expect(options.candidates[2]).toMatchObject({ brandName: 'Brewline Tea', answers: 30 });
  });

  it('leaves out the demo brand, paused prompts and an unlimited plan’s', async () => {
    rows().push(prompt('demo-1', 'demo'), prompt('paused', 'b1', { is_active: false }));
    const options = await getSwapOptions('w');
    if ('error' in options) throw new Error(options.error);
    expect(options.candidates.map((c) => c.id).sort()).toEqual(['a', 'b', 'c', 'd']);

    fake.maxPrompts = -1;
    const unlimited = await getSwapOptions('w');
    if ('error' in unlimited) throw new Error(unlimited.error);
    expect(unlimited.candidates).toEqual([]);
  });

  it('says so for a prompt that is tracked already or not found', async () => {
    expect(await getSwapOptions('a')).toEqual({ error: 'Already tracked' });
    expect(await getSwapOptions('nope')).toEqual({ error: 'Prompt not found' });
  });
});

describe('swapPrompts', () => {
  it('pauses the pick first, then tracks the waiting prompt through the metered activation', async () => {
    const result = await swapPrompts('w', ['b']);
    expect(result).toEqual({ ok: true, prompt: { id: 'w', isActive: true }, paused: 1 });
    expect(row('b').is_active).toBe(false);
    expect(row('w')).toMatchObject({ is_active: true, waiting_since: null });
    expect(setPromptActive).toHaveBeenCalledWith('w', true);
    expect(updates()).toHaveLength(1);
  });

  it('tracks it without a pick when a spot is free', async () => {
    row('a').is_active = false;
    expect(await swapPrompts('w', [])).toMatchObject({ ok: true, paused: 0 });
    expect(row('w').is_active).toBe(true);
    expect(updates()).toHaveLength(0);
  });

  it('tracks the picks again when tracking the waiting prompt fails', async () => {
    fake.activate = () => ({ error: 'Failed to update the prompt' });
    const result = await swapPrompts('w', ['b', 'c']);
    expect(result).toEqual({
      ok: false,
      code: 'failed',
      error: 'Failed to update the prompt',
      restored: true,
    });
    expect(row('b')).toMatchObject({ is_active: true, waiting_since: null });
    expect(row('c').is_active).toBe(true);
    expect(row('w').is_active).toBe(false);
    expect(updates()).toHaveLength(2);
  });

  it('needs a spot for each location: refuses picks that free too few, before changing anything', async () => {
    rows().push(waiting('wide', ['US', 'GB', 'DE']));
    const short = await swapPrompts('wide', ['a', 'c']);
    expect(short).toMatchObject({ ok: false, code: 'not_enough' });
    expect(updates()).toHaveLength(0);
    expect(row('a').is_active).toBe(true);

    expect(await swapPrompts('wide', ['a', 'b', 'c'])).toMatchObject({ ok: true, paused: 3 });
    expect(row('wide').is_active).toBe(true);
  });

  it('counts a pick tracked in several locations for each of them', async () => {
    row('a').regions = ['US', 'GB'];
    fake.maxPrompts = 5;
    rows().push(waiting('wide', ['US', 'GB']));
    expect(await swapPrompts('wide', ['a'])).toMatchObject({ ok: true, paused: 1 });
  });

  it('refuses picks that are paused, on another workspace or the demo brand, or the prompt itself', async () => {
    rows().push(
      prompt('paused', 'b1', { is_active: false }),
      prompt('theirs', 'elsewhere'),
      prompt('demo-1', 'demo'),
    );
    for (const picks of [['paused'], ['theirs'], ['demo-1'], ['w'], ['missing']]) {
      expect(await swapPrompts('w', picks)).toMatchObject({ ok: false, code: 'not_found' });
    }
    expect(await swapPrompts('a', ['b'])).toMatchObject({ ok: false, code: 'not_found' });
    expect(updates()).toHaveLength(0);
  });

  it('is for admins and managers', async () => {
    (fake.db.tables.profiles as Row[])[0].role = 'analyst';
    expect(await swapPrompts('w', ['b'])).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(updates()).toHaveLength(0);
  });
});
