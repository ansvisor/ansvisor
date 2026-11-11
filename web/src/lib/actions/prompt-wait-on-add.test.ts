// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Prompts added over the plan's limit (Simplify PR 15): with SIMPLE_NAV on,
 * every add path saves the ones past the limit "Waiting for a spot"
 * (inactive, waiting_since set; 00535) instead of refusing them, and says
 * how many wait. Off, a full plan is refused as before. The limit is the
 * organization's, across its brands, counted in prompt locations.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  maxPrompts: 3,
  overLimit: [] as unknown[],
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(fake.db, {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { access_token: 't' } } }),
      },
    }),
}));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/tracking', () => ({
  analyzeNewPrompts: vi.fn(async () => ({ started: true })),
  getPromptVisibilitySummaries: vi.fn(),
}));
vi.mock('@/lib/guards/plan-guard', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/guards/plan-guard')>();
  const { PLANS } = await import('@/config/plans');
  return {
    ...real,
    getOrgPlan: vi.fn(async () => ({
      ...PLANS.starter,
      limits: { ...PLANS.starter.limits, maxPrompts: fake.maxPrompts },
    })),
  };
});

const { createFakeSupabase } = await import('@/lib/chat/testing/fake-supabase');
const { analyzeNewPrompts } = await import('@/lib/actions/tracking');
const { addPromptToSet, addTopicPrompts, importPrompts, savePromptSet } = await import('./prompt');

const BRAND = '11111111-1111-4111-8111-111111111111';
/** The organization's second brand. */
const SECOND = '22222222-2222-4222-8222-222222222222';
const TOPIC = '33333333-3333-4333-8333-333333333331';

type Row = Record<string, unknown>;
const prompts = () => fake.db.tables.prompts as Row[];
const regionsOf = (row: Row) => (row.regions as string[] | null) ?? [];
const cost = (regions: string[]) => Math.max(regions.length, 1);

/** A tracked prompt on a brand's set, taking `locations` of the plan. */
const tracked = (set: string, locations: string[] = ['US']): Row => ({
  prompt_set_id: set,
  text: `tracked ${Math.random()}`,
  is_active: true,
  platforms: ['chatgpt-web'],
  models: [],
  regions: locations,
  created_at: '2026-01-02T00:00:00Z',
});

beforeEach(() => {
  vi.unstubAllEnvs();
  fake.maxPrompts = 3;
  fake.overLimit = [];
  fake.db = createFakeSupabase();
  Object.assign(fake.db.tables, {
    profiles: [{ id: 'u1', role: 'manager' }],
    brands: [
      {
        id: BRAND,
        organization_id: 'org',
        region: 'US',
        state: null,
        shopping_mode_enabled: false,
      },
      {
        id: SECOND,
        organization_id: 'org',
        region: 'US',
        state: null,
        shopping_mode_enabled: false,
      },
    ],
    topics: [
      { id: TOPIC, brand_id: BRAND, name: 'Pricing', is_active: true },
      { id: 'topic-2', brand_id: SECOND, name: 'Pricing', is_active: true },
    ],
    prompt_sets: [
      { id: 'set-1', brand_id: BRAND, created_at: '2026-01-01T00:00:00Z' },
      { id: 'set-2', brand_id: SECOND, created_at: '2026-01-01T00:00:00Z' },
    ],
    prompts: [] as Row[],
  });
  const setBrand = (set: unknown) =>
    (fake.db.tables.prompt_sets as Row[]).find((s) => s.id === set)?.brand_id as string;
  /** Active locations per brand, as org_prompt_location_usage counts them (00128). */
  const usage = () => {
    const byBrand = new Map<string, number>();
    for (const p of prompts().filter((p) => p.is_active)) {
      const brand = setBrand(p.prompt_set_id);
      byBrand.set(brand, (byBrand.get(brand) ?? 0) + cost(regionsOf(p)));
    }
    return [...byBrand].map(([brand_id, locations]) => ({ brand_id, locations }));
  };
  fake.db.rpcs = {
    org_prompt_location_usage: usage,
    // import_prompts as 00535 runs it: in order, once one doesn't fit the
    // rest are past the limit, skipped or saved waiting.
    import_prompts: (args) => {
      fake.overLimit.push(args.p_over_limit);
      const max = args.p_max_locations as number;
      let used = usage().reduce((sum, row) => sum + row.locations, 0);
      let over = false;
      const out: Row[] = [];
      for (const row of args.p_rows as Row[]) {
        const c = cost(regionsOf(row));
        over = over || (max !== -1 && used + c > max);
        if (over && args.p_over_limit === 'skip') break;
        const id = `new-${prompts().length + 1}`;
        prompts().push({
          id,
          prompt_set_id: args.p_prompt_set_id,
          text: row.text,
          regions: regionsOf(row),
          is_active: !over,
          waiting_since: over ? '2026-11-11T10:00:00Z' : null,
        });
        if (!over) used += c;
        out.push({ idx: row.idx, id, waiting: over });
      }
      return out;
    },
  };
});

afterEach(() => vi.unstubAllEnvs());

const simpleNav = () => vi.stubEnv('SIMPLE_NAV', 'true');
const add = () =>
  addPromptToSet({
    promptSetId: 'set-1',
    text: 'best crm',
    category: 'Pricing',
    platforms: ['chatgpt-web'],
  });
const added = () => prompts().find((p) => p.text === 'best crm');

describe('addPromptToSet (Add prompt, suggestions, Track N, traffic, page prompts)', () => {
  it('tracks the prompt while the plan has room', async () => {
    prompts().push(tracked('set-1'), tracked('set-1'));
    simpleNav();

    const result = await add();

    expect(result).toEqual({ prompt: expect.objectContaining({ isActive: true }) });
    expect(added()).toMatchObject({ is_active: true });
    expect(added()?.waiting_since).toBeUndefined();
  });

  it('without SIMPLE_NAV, refuses it at the limit and saves nothing', async () => {
    prompts().push(tracked('set-1'), tracked('set-1'), tracked('set-1'));

    expect(await add()).toMatchObject({ code: 'plan_limit' });
    expect(added()).toBeUndefined();
  });

  it('with SIMPLE_NAV, saves it waiting for a spot at the limit', async () => {
    prompts().push(tracked('set-1'), tracked('set-1'), tracked('set-1'));
    simpleNav();

    const result = await add();

    expect(result).toMatchObject({ prompt: { isActive: false }, waiting: true });
    expect(added()).toMatchObject({ is_active: false, waiting_since: expect.any(String) });
  });

  it('counts multi-location prompts once per location', async () => {
    // One prompt in three places fills a plan of three.
    prompts().push(tracked('set-1', ['US', 'DE', 'TR']));
    simpleNav();

    expect(await add()).toMatchObject({ waiting: true });
  });

  it('counts the whole organization: a second brand waits once the first used the plan', async () => {
    prompts().push(tracked('set-2'), tracked('set-2'), tracked('set-2'));
    simpleNav();

    expect(await add()).toMatchObject({ waiting: true });
  });

  it('never makes a prompt wait on an unlimited plan', async () => {
    fake.maxPrompts = -1;
    prompts().push(tracked('set-2'), tracked('set-1'), tracked('set-1'), tracked('set-1'));
    simpleNav();

    expect(await add()).toEqual({ prompt: expect.objectContaining({ isActive: true }) });
  });
});

describe('savePromptSet (onboarding, a new brand)', () => {
  const save = (count: number, paused = 0) =>
    savePromptSet({
      brandId: SECOND,
      name: 'Brand Setup Prompts',
      prompts: [
        ...Array.from({ length: count }, (_, i) => ({
          text: `prompt ${i + 1}`,
          category: 'Pricing',
          platforms: ['chatgpt-web'],
        })),
        ...Array.from({ length: paused }, (_, i) => ({
          text: `paused ${i + 1}`,
          platforms: ['chatgpt-web'],
          isActive: false,
        })),
      ],
    });
  const byText = (text: string) => prompts().find((p) => p.text === text);

  it('without SIMPLE_NAV, refuses the whole save past the limit', async () => {
    prompts().push(tracked('set-1'));

    expect(await save(3)).toMatchObject({ code: 'plan_limit' });
    expect(byText('prompt 1')).toBeUndefined();
  });

  it('with SIMPLE_NAV, tracks the ones that fit and keeps the rest waiting, in order', async () => {
    // The first brand already uses one of the organization's three locations.
    prompts().push(tracked('set-1'));
    simpleNav();

    const result = await save(4, 1);

    expect(result).toMatchObject({ waiting: 2 });
    expect(byText('prompt 1')).toMatchObject({ is_active: true });
    expect(byText('prompt 2')).toMatchObject({ is_active: true });
    expect(byText('prompt 3')).toMatchObject({
      is_active: false,
      waiting_since: expect.any(String),
    });
    expect(byText('prompt 4')).toMatchObject({
      is_active: false,
      waiting_since: expect.any(String),
    });
    // A prompt saved paused stays paused: it isn't waiting.
    expect(byText('paused 1')).toMatchObject({ is_active: false });
    expect(byText('paused 1')?.waiting_since).toBeUndefined();
  });

  it('says nothing waits when every prompt fits', async () => {
    simpleNav();

    const result = await save(3);

    expect(result).toHaveProperty('promptSet');
    expect(result).not.toHaveProperty('waiting');
  });
});

describe('importPrompts (Add prompt dialog, Bulk import)', () => {
  const rows = (regions: string[][]) =>
    regions.map((r, idx) => ({
      idx,
      text: `imported ${idx}`,
      topic: 'Pricing',
      platforms: ['chatgpt-web'],
      models: [],
      regions: r,
    }));

  it('without SIMPLE_NAV, skips the rows past the limit', async () => {
    const result = await importPrompts(BRAND, rows([['US'], ['US'], ['US'], ['US']]));

    expect(fake.overLimit).toEqual(['skip']);
    expect(result).toMatchObject({ importedIdx: [0, 1, 2] });
    expect(result).not.toHaveProperty('waitingIdx');
  });

  it('with SIMPLE_NAV, saves them waiting and starts the first run for the tracked ones only', async () => {
    simpleNav();
    // The second brand holds one location; a two-location row then doesn't fit.
    prompts().push(tracked('set-2'));

    const result = await importPrompts(BRAND, rows([['US'], ['US', 'DE'], ['US']]));

    expect(fake.overLimit).toEqual(['wait']);
    expect(result).toMatchObject({ importedIdx: [0, 1, 2], waitingIdx: [1, 2] });
    const ids = 'promptIds' in result ? result.promptIds : [];
    expect(vi.mocked(analyzeNewPrompts)).toHaveBeenLastCalledWith(BRAND, [ids[0]]);
  });
});

describe('addTopicPrompts (Chat add_prompts)', () => {
  it('with SIMPLE_NAV, returns the added and the waiting ones apart', async () => {
    prompts().push(tracked('set-2'));
    simpleNav();

    const result = await addTopicPrompts(BRAND, TOPIC, ['one', 'two', 'three']);

    expect(result).toEqual({
      analysisStarted: true,
      ok: true,
      code: 'ok',
      added: [
        { id: expect.any(String), text: 'one' },
        { id: expect.any(String), text: 'two' },
      ],
      waiting: [{ id: expect.any(String), text: 'three' }],
      skipped: [],
    });
  });

  it('with SIMPLE_NAV, a full plan saves them all waiting instead of refusing', async () => {
    prompts().push(tracked('set-2'), tracked('set-2'), tracked('set-2'));
    simpleNav();

    const result = await addTopicPrompts(BRAND, TOPIC, ['one', 'two']);

    expect(result).toMatchObject({
      ok: true,
      added: [],
      waiting: [{ text: 'one' }, { text: 'two' }],
    });
  });

  it('without SIMPLE_NAV, a full plan is refused as before', async () => {
    prompts().push(tracked('set-2'), tracked('set-2'), tracked('set-2'));

    expect(await addTopicPrompts(BRAND, TOPIC, ['one'])).toMatchObject({
      ok: false,
      reason: 'quota_exceeded',
    });
  });
});
