// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Merging duplicate competitors (00543) through the server actions: the plan
 * first, then the role (admins and managers), then the brand's own
 * competitors; merge_competitors and unmerge_competitor with the person's
 * own client; a merge run twice changes nothing; a merged competitor is
 * never added again.
 */

const BRAND = '11111111-1111-4111-8111-111111111111';
const KEPT = '22222222-2222-4222-8222-222222222222';
const DUP = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const PERSON = '55555555-5555-4555-8555-555555555555';

type Result = { data: unknown; error: { message: string; code?: string } | null };

const db = vi.hoisted(() => ({
  queries: [] as { table: string; calls: unknown[][] }[],
  results: {} as Record<string, Result>,
  rpcs: {} as Record<string, Result>,
  rpcCalls: [] as [string, unknown][],
  inserted: null as Result | null,
  order: [] as string[],
}));

const guard = vi.hoisted(() => ({
  assertWritable: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {
    db.order.push('assertWritable');
  }),
}));
const role = vi.hoisted(() => ({ manager: true }));

vi.mock('@/lib/subscription-guard', () => guard);
vi.mock('@/lib/session-role', () => ({
  isManager: vi.fn(async () => {
    db.order.push('isManager');
    return role.manager;
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/scoped', () => ({ dbClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: unknown) => {
      db.order.push(`rpc:${fn}`);
      db.rpcCalls.push([fn, args]);
      return db.rpcs[fn] ?? { data: null, error: null };
    },
    from: (table: string) => {
      const query = { table, calls: [] as unknown[][] };
      db.queries.push(query);
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'not', 'in', 'update', 'insert', 'order']) {
        chain[name] = (...args: unknown[]) => {
          query.calls.push([name, ...args]);
          return chain;
        };
      }
      const answer = () =>
        (query.calls.some((c) => c[0] === 'insert') ? db.inserted : null) ??
        db.results[table] ?? { data: [], error: null };
      chain.single = async () => answer();
      chain.maybeSingle = async () => {
        const result = answer();
        return {
          ...result,
          data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
        };
      };
      chain.then = (resolve: (r: Result) => void) => resolve(answer());
      return chain;
    },
  }),
}));

const { addCompetitor, addCompetitors, getMergedCompetitors, mergeCompetitors, unmergeCompetitor } =
  await import('./competitor');

const filters = (table: string) =>
  db.queries.filter((q) => q.table === table).flatMap((q) => q.calls.filter((c) => c[0] === 'eq'));

beforeEach(() => {
  db.queries = [];
  db.results = {};
  db.rpcs = {};
  db.rpcCalls = [];
  db.inserted = null;
  db.order = [];
  role.manager = true;
  guard.assertWritable.mockClear();
});

describe('mergeCompetitors', () => {
  beforeEach(() => {
    db.results.competitors = { data: [{ id: KEPT }, { id: DUP }], error: null };
    db.results.merged_competitors = { data: [], error: null };
    db.rpcs.merge_competitors = {
      data: {
        kept: { id: KEPT, name: 'Sky Air' },
        merged: [{ id: DUP, name: 'Sky Air Tours' }],
        already: [],
      },
      error: null,
    };
  });

  it('checks the plan first, then the role, then the brand, and merges with the person’s client', async () => {
    const result = await mergeCompetitors(BRAND, KEPT, [DUP, DUP]);
    expect(db.order).toEqual(['assertWritable', 'isManager', 'rpc:merge_competitors']);
    expect(guard.assertWritable).toHaveBeenCalledWith({ brandId: BRAND });
    expect(filters('competitors')).toContainEqual(['eq', 'brand_id', BRAND]);
    expect(filters('merged_competitors')).toContainEqual(['eq', 'brand_id', BRAND]);
    expect(db.rpcCalls).toEqual([
      ['merge_competitors', { p_brand_id: BRAND, p_kept_id: KEPT, p_merged_ids: [DUP] }],
    ]);
    expect(result).toEqual({
      ok: true,
      kept: { id: KEPT, name: 'Sky Air' },
      merged: [{ id: DUP, name: 'Sky Air Tours' }],
      already: [],
    });
  });

  it('refuses an analyst, after the plan and before any read', async () => {
    role.manager = false;
    const result = await mergeCompetitors(BRAND, KEPT, [DUP]);
    expect(result).toMatchObject({ ok: false, reason: 'forbidden_role' });
    expect(db.order).toEqual(['assertWritable', 'isManager']);
    expect(db.rpcCalls).toEqual([]);
  });

  it('stops at the plan check on a read-only workspace', async () => {
    guard.assertWritable.mockRejectedValueOnce(new Error('read-only'));
    await expect(mergeCompetitors(BRAND, KEPT, [DUP])).rejects.toThrow('read-only');
    expect(db.queries).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it('refuses one merged into itself, no competitor, too many and bad ids', async () => {
    expect(await mergeCompetitors(BRAND, KEPT, [KEPT])).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: "A competitor can't be merged into itself.",
    });
    expect(await mergeCompetitors(BRAND, KEPT, [])).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await mergeCompetitors(BRAND, KEPT, ['nope'])).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    const many = Array.from(
      { length: 51 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    expect(await mergeCompetitors(BRAND, KEPT, many)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(db.rpcCalls).toEqual([]);
  });

  it('refuses a competitor of another brand, to keep or to merge', async () => {
    // The brand's reads find only the kept one: the other id is another brand's.
    db.results.competitors = { data: [{ id: KEPT }], error: null };
    expect(await mergeCompetitors(BRAND, KEPT, [OTHER])).toMatchObject({
      ok: false,
      reason: 'not_found',
      message: "One of the competitors to merge isn't one of this brand's.",
    });
    db.results.competitors = { data: [{ id: DUP }], error: null };
    expect(await mergeCompetitors(BRAND, OTHER, [DUP])).toMatchObject({
      ok: false,
      reason: 'not_found',
      message: "The competitor to keep isn't one of this brand's.",
    });
    expect(db.rpcCalls).toEqual([]);
  });

  it('refuses keeping one that is itself merged', async () => {
    db.results.competitors = { data: [{ id: DUP }], error: null };
    db.results.merged_competitors = {
      data: [{ id: KEPT, merged_into_id: OTHER, name: 'Sky Air', domain: '' }],
      error: null,
    };
    expect(await mergeCompetitors(BRAND, KEPT, [DUP])).toMatchObject({
      ok: false,
      message: 'The competitor to keep is itself merged into another one.',
    });
  });

  it('is a no-op for one already merged, and says so', async () => {
    db.results.competitors = { data: [{ id: KEPT }], error: null };
    db.results.merged_competitors = {
      data: [{ id: DUP, merged_into_id: KEPT, name: 'Sky Air Tours', domain: '' }],
      error: null,
    };
    db.rpcs.merge_competitors = {
      data: {
        kept: { id: KEPT, name: 'Sky Air' },
        merged: [],
        already: [{ id: DUP, name: 'Sky Air Tours', merged_into_id: KEPT }],
      },
      error: null,
    };
    expect(await mergeCompetitors(BRAND, KEPT, [DUP])).toEqual({
      ok: true,
      kept: { id: KEPT, name: 'Sky Air' },
      merged: [],
      already: [{ id: DUP, name: 'Sky Air Tours', mergedIntoId: KEPT }],
    });
  });

  it('gives the database’s refusal as a value', async () => {
    db.rpcs.merge_competitors = {
      data: null,
      error: {
        code: '42501',
        message: "Only an admin or a manager can merge this brand's competitors.",
      },
    };
    expect(await mergeCompetitors(BRAND, KEPT, [DUP])).toEqual({
      ok: false,
      reason: 'forbidden_role',
      message: "Only an admin or a manager can merge this brand's competitors.",
    });
  });

  it('says it couldn’t merge, without the database’s words, for any other error', async () => {
    db.rpcs.merge_competitors = {
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.merge_competitors in the schema cache',
      },
    };
    expect(await mergeCompetitors(BRAND, KEPT, [DUP])).toEqual({
      ok: false,
      reason: 'failed',
      message: "The competitors couldn't be merged.",
    });
  });
});

describe('unmergeCompetitor', () => {
  it('checks the plan first, then the role, and unmerges the brand’s own merged one', async () => {
    db.results.merged_competitors = {
      data: [{ id: DUP, name: 'Sky Air Tours', merged_into_id: KEPT }],
      error: null,
    };
    db.rpcs.unmerge_competitor = {
      data: { unmerged: true, id: DUP, merged_into: { id: KEPT, name: 'Sky Air' } },
      error: null,
    };
    const result = await unmergeCompetitor(BRAND, DUP);
    expect(db.order).toEqual(['assertWritable', 'isManager', 'rpc:unmerge_competitor']);
    expect(guard.assertWritable).toHaveBeenCalledWith({ brandId: BRAND });
    expect(filters('merged_competitors')).toEqual([
      ['eq', 'brand_id', BRAND],
      ['eq', 'id', DUP],
    ]);
    expect(db.rpcCalls).toEqual([
      ['unmerge_competitor', { p_brand_id: BRAND, p_competitor_id: DUP }],
    ]);
    expect(result).toEqual({
      ok: true,
      unmerged: true,
      competitor: { id: DUP, name: 'Sky Air Tours' },
      mergedInto: { id: KEPT, name: 'Sky Air' },
    });
  });

  it('refuses an analyst', async () => {
    role.manager = false;
    expect(await unmergeCompetitor(BRAND, DUP)).toMatchObject({
      ok: false,
      reason: 'forbidden_role',
    });
    expect(db.rpcCalls).toEqual([]);
  });

  it('changes nothing for one that isn’t merged, and refuses another brand’s', async () => {
    db.results.merged_competitors = { data: [], error: null };
    db.results.competitors = { data: [{ id: KEPT, name: 'Sky Air' }], error: null };
    expect(await unmergeCompetitor(BRAND, KEPT)).toEqual({
      ok: true,
      unmerged: false,
      competitor: { id: KEPT, name: 'Sky Air' },
      mergedInto: null,
    });
    db.results.competitors = { data: [], error: null };
    expect(await unmergeCompetitor(BRAND, OTHER)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(db.rpcCalls).toEqual([]);
  });
});

describe('getMergedCompetitors', () => {
  it('lists what was merged into what, when and by whom, for the brand', async () => {
    db.results.merged_competitors = {
      data: [
        {
          id: DUP,
          merged_into_id: KEPT,
          name: 'Sky Air Tours',
          domain: 'skyairtours.example',
          type: null,
          merged_at: '2026-11-17T10:00:00Z',
          merged_by: PERSON,
        },
      ],
      error: null,
    };
    db.results.competitors = { data: [{ id: KEPT, name: 'Sky Air' }], error: null };
    db.results.profiles = { data: [{ id: PERSON, full_name: ' Ada ' }], error: null };
    expect(await getMergedCompetitors(BRAND)).toEqual([
      {
        id: DUP,
        name: 'Sky Air Tours',
        domain: 'skyairtours.example',
        type: null,
        mergedIntoId: KEPT,
        mergedIntoName: 'Sky Air',
        mergedAt: '2026-11-17T10:00:00Z',
        mergedBy: 'Ada',
      },
    ]);
    expect(filters('merged_competitors')).toEqual([['eq', 'brand_id', BRAND]]);
    expect(filters('competitors')).toEqual([['eq', 'brand_id', BRAND]]);
  });

  it('is empty before 00543', async () => {
    db.results.merged_competitors = {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.merged_competitors'" },
    };
    expect(await getMergedCompetitors(BRAND)).toEqual([]);
  });
});

describe('a merged competitor is never added again', () => {
  beforeEach(() => {
    db.results.merged_competitors = {
      data: [
        { id: DUP, merged_into_id: KEPT, name: 'Sky Air Tours', domain: 'skyairtours.example' },
      ],
      error: null,
    };
  });

  it("Chat's add_competitors skips it and names the one it counts for", async () => {
    db.results.competitors = {
      data: [{ id: KEPT, brand_id: BRAND, name: 'Sky Air', domain: 'sky.example', type: null }],
      error: null,
    };
    db.inserted = {
      data: { id: OTHER, brand_id: BRAND, name: 'Trips', domain: 'trips.example', type: null },
      error: null,
    };
    const result = await addCompetitors(BRAND, [
      { name: 'SAT', domain: 'https://www.skyairtours.example/' },
      { name: 'Trips', domain: 'trips.example' },
    ]);
    expect(result).toMatchObject({
      ok: true,
      code: 'partial',
      added: [{ id: OTHER, name: 'Trips' }],
      skipped: [
        {
          name: 'SAT',
          reason: 'merged',
          mergedInto: { id: KEPT, name: 'Sky Air' },
        },
      ],
    });
  });

  it('says so when every one asked for is merged', async () => {
    db.results.competitors = {
      data: [{ id: KEPT, brand_id: BRAND, name: 'Sky Air', domain: 'sky.example', type: null }],
      error: null,
    };
    expect(await addCompetitors(BRAND, [{ name: 'Sky Air Tours', domain: '' }])).toEqual({
      ok: false,
      reason: 'duplicate',
      message:
        'The brand already has these competitors. Sky Air Tours is merged into Sky Air: answers naming it already count there.',
    });
    expect(db.queries.some((q) => q.calls.some((c) => c[0] === 'insert'))).toBe(false);
  });

  it('the Competitors page’s add refuses it too', async () => {
    db.results.competitors = { data: [{ name: 'Sky Air' }], error: null };
    await expect(
      addCompetitor(BRAND, { name: 'Anything', domain: 'skyairtours.example' }),
    ).rejects.toThrow('Sky Air Tours is merged into Sky Air');
    expect(db.queries.some((q) => q.calls.some((c) => c[0] === 'insert'))).toBe(false);
  });
});
