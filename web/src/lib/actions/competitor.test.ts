// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Competitor types (00542) through the server actions: a type is set by an
 * admin or a manager, after the plan check, on the brand's own competitors
 * only; a typed label joins one of the brand's labels in any case.
 */

const BRAND = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

type Result = { data: unknown; error: { message: string } | null };

const db = vi.hoisted(() => ({
  /** Each query: its table and every call on it, in order. */
  queries: [] as { table: string; calls: unknown[][] }[],
  /** What each table's reads, updates and inserts answer. */
  results: {} as Record<string, Result>,
  /** What an insert answers, when it differs from the table's reads. */
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
      chain.maybeSingle = async () => answer();
      chain.then = (resolve: (r: Result) => void) => resolve(answer());
      return chain;
    },
  }),
}));

const { addCompetitor, setCompetitorTypes } = await import('./competitor');

const calls = (name: string) =>
  db.queries.flatMap((q) => q.calls.filter((c) => c[0] === name).map((c) => [q.table, ...c]));

beforeEach(() => {
  db.queries = [];
  db.results = {};
  db.inserted = null;
  db.order = [];
  role.manager = true;
  guard.assertWritable.mockClear();
});

describe('setCompetitorTypes', () => {
  it("checks the plan first, then the role, and changes only the brand's own competitors", async () => {
    db.results.competitors = {
      data: [{ id: C1, brand_id: BRAND, name: 'Rival', domain: 'rival.com', type: 'direct' }],
      error: null,
    };
    const changed = await setCompetitorTypes(BRAND, [C1, C1], 'Direct competitor');

    expect(db.order).toEqual(['assertWritable', 'isManager']);
    expect(guard.assertWritable).toHaveBeenCalledWith({ brandId: BRAND });
    expect(calls('update')).toEqual([['competitors', 'update', { type: 'direct' }]]);
    expect(calls('eq')).toContainEqual(['competitors', 'eq', 'brand_id', BRAND]);
    expect(calls('in')).toEqual([['competitors', 'in', 'id', [C1]]]);
    expect(changed).toEqual([
      { id: C1, brandId: BRAND, name: 'Rival', domain: 'rival.com', type: 'direct' },
    ]);
  });

  it("joins one of the brand's labels in any case, but not the competitors being changed", async () => {
    // The brand's labels: C2's "Tour operator", and C1's own "airline".
    db.results.competitors = {
      data: [
        { id: C1, type: 'airline' },
        { id: C2, type: 'Tour operator' },
      ],
      error: null,
    };
    await setCompetitorTypes(BRAND, [C1], 'TOUR OPERATOR');
    expect(calls('update')).toEqual([['competitors', 'update', { type: 'Tour operator' }]]);

    db.queries = [];
    // C1 fixes its own label's case.
    await setCompetitorTypes(BRAND, [C1], 'Airline');
    expect(calls('update')).toEqual([['competitors', 'update', { type: 'Airline' }]]);
    // Read on the brand only.
    expect(calls('eq')[0]).toEqual(['competitors', 'eq', 'brand_id', BRAND]);
  });

  it('clears the type with null, without reading the brand labels', async () => {
    db.results.competitors = { data: [{ id: C1, type: null }], error: null };
    await setCompetitorTypes(BRAND, [C1, C2], null);
    expect(calls('update')).toEqual([['competitors', 'update', { type: null }]]);
    expect(calls('in')).toEqual([['competitors', 'in', 'id', [C1, C2]]]);
    expect(db.queries).toHaveLength(1);
  });

  it('refuses a member who is not an admin or a manager, and changes nothing', async () => {
    role.manager = false;
    await expect(setCompetitorTypes(BRAND, [C1], 'direct')).rejects.toThrow(
      'Only an admin or a manager can change competitor types.',
    );
    expect(calls('update')).toEqual([]);
  });

  it('refuses a read-only workspace before anything else', async () => {
    guard.assertWritable.mockRejectedValueOnce(new Error('read-only'));
    await expect(setCompetitorTypes(BRAND, [C1], 'direct')).rejects.toThrow('read-only');
    expect(db.queries).toEqual([]);
  });

  it('refuses bad ids, no ids and a type past 40 characters', async () => {
    await expect(setCompetitorTypes(BRAND, ['nope'], 'direct')).rejects.toThrow('invalid');
    await expect(setCompetitorTypes(BRAND, [], 'direct')).rejects.toThrow('invalid');
    await expect(setCompetitorTypes('nope', [C1], 'direct')).rejects.toThrow('invalid');
    await expect(setCompetitorTypes(BRAND, [C1], 'x'.repeat(41))).rejects.toThrow(
      'at most 40 characters',
    );
    expect(calls('update')).toEqual([]);
  });

  it("says so when none of them is the brand's", async () => {
    db.results.competitors = { data: [], error: null };
    await expect(setCompetitorTypes(BRAND, [C1], 'direct')).rejects.toThrow(
      "The competitors' type couldn't be changed.",
    );
  });
});

describe('addCompetitor with a type', () => {
  it("stores the type cleaned against the brand's labels", async () => {
    // The brand's labels, then the row it added.
    db.results.competitors = { data: [{ id: C1, type: 'Airline' }], error: null };
    db.inserted = {
      data: { id: C2, brand_id: BRAND, name: 'Sky', domain: 'sky.example', type: 'Airline' },
      error: null,
    };
    const added = await addCompetitor(BRAND, {
      name: ' Sky ',
      domain: 'https://sky.example/',
      type: ' airline ',
    });
    expect(guard.assertWritable).toHaveBeenCalledWith({ onboarding: true, brandId: BRAND });
    expect(calls('eq')[0]).toEqual(['competitors', 'eq', 'brand_id', BRAND]);
    expect(calls('insert')).toEqual([
      [
        'competitors',
        'insert',
        { brand_id: BRAND, name: 'Sky', domain: 'sky.example', type: 'Airline' },
      ],
    ]);
    expect(added).toEqual({
      id: C2,
      brandId: BRAND,
      name: 'Sky',
      domain: 'sky.example',
      type: 'Airline',
    });
  });

  it('refuses a type past 40 characters, adding nothing', async () => {
    await expect(
      addCompetitor(BRAND, { name: 'Sky', domain: '', type: 'x'.repeat(41) }),
    ).rejects.toThrow('at most 40 characters');
    expect(calls('insert')).toEqual([]);
  });

  it('stores a generic type by its key, and adds without one as before', async () => {
    db.inserted = {
      data: { id: C2, brand_id: BRAND, name: 'Sky', domain: '', type: null },
      error: null,
    };
    await addCompetitor(BRAND, { name: 'Sky', domain: '', type: 'Publisher / review site' });
    await addCompetitor(BRAND, { name: 'Sky', domain: '' });
    expect(calls('insert')).toEqual([
      ['competitors', 'insert', { brand_id: BRAND, name: 'Sky', domain: '', type: 'publisher' }],
      ['competitors', 'insert', { brand_id: BRAND, name: 'Sky', domain: '' }],
    ]);
  });
});
