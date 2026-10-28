import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organization's demo brand (00380): created on the first visit, rebuilt
 * in place when DEMO_VERSION moves on or its data grows old, left alone
 * otherwise; hidden or shown by the organization, never deleted.
 */

const state = vi.hoisted(() => ({ brands: [], cleared: [], failInsert: null, onRead: null }));

/** The admin client over `state.brands`, recording each table a rebuild clears. */
vi.mock('../../config/supabase.js', () => {
  const matches = (row, filters) =>
    filters.every(([op, column, value]) =>
      op === 'is' ? (row[column] ?? null) === value : row[column] === value,
    );
  const from = (table) => {
    const q = { op: 'select', filters: [], payload: null, returning: false };
    const run = () => {
      if (table !== 'brands') {
        if (q.op === 'delete') state.cleared.push([table, ...q.filters[0].slice(1)]);
        return { data: null, error: null };
      }
      if (q.op === 'insert') {
        if (state.failInsert) return { data: null, error: state.failInsert };
        const taken = state.brands.some(
          (b) => b.is_demo && b.organization_id === q.payload.organization_id,
        );
        if (taken) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const row = { id: `brand-${state.brands.length + 1}`, demo_hidden_at: null, ...q.payload };
        state.brands.push(row);
        return { data: { ...row }, error: null };
      }
      const rows = state.brands.filter((b) => matches(b, q.filters));
      if (q.op === 'update') {
        for (const row of rows) Object.assign(row, q.payload);
        return { data: q.returning ? rows.map((r) => ({ id: r.id })) : null, error: null };
      }
      state.onRead?.();
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const chain = {
      select: () => ((q.returning = true), chain),
      insert: (payload) => ((q.op = 'insert'), (q.payload = payload), chain),
      update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
      delete: () => ((q.op = 'delete'), chain),
      eq: (column, value) => (q.filters.push(['eq', column, value]), chain),
      is: (column, value) => (q.filters.push(['is', column, value]), chain),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run();
        return { data: Array.isArray(data) ? data[0] : data, error };
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };
  return { default: { from } };
});
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  DEMO_BUILD_LEASE_MS,
  DEMO_MAX_AGE_MS,
  DEMO_VERSION,
  demoState,
  ensureDemoBrand,
  setDemoHidden,
} = await import('./index.js');

const NOW = new Date('2026-10-28T12:00:00Z');
const DAY_MS = 86_400_000;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const build = vi.fn(async () => ({ rows: 1 }));
const modules = [
  { name: 'one', tables: ['a', 'b'], build },
  { name: 'two', tables: ['c'], build },
];
const ensure = (organizationId = 'org-1', now = NOW) =>
  ensureDemoBrand({ organizationId, now, modules });

const demo = (over = {}) => ({
  id: 'demo-1',
  organization_id: 'org-1',
  is_demo: true,
  demo_version: DEMO_VERSION,
  demo_built_at: ago(60_000),
  demo_hidden_at: null,
  ...over,
});

beforeEach(() => {
  state.brands = [{ id: 'real-1', organization_id: 'org-1', is_demo: false }];
  state.cleared = [];
  state.failInsert = null;
  state.onRead = null;
  build.mockReset().mockResolvedValue({ rows: 1 });
});
afterEach(() => vi.useRealTimers());

describe('ensureDemoBrand', () => {
  it('creates the demo brand on the first visit and builds it', async () => {
    expect(await ensure()).toEqual({ brandId: 'brand-2', version: DEMO_VERSION, rebuilt: true });
    const created = state.brands[1];
    expect(created).toMatchObject({
      organization_id: 'org-1',
      name: 'Brewline Coffee',
      is_demo: true,
      demo_version: DEMO_VERSION,
      demo_built_at: NOW.toISOString(),
    });
    expect(build.mock.calls.map(([ctx]) => ctx)).toEqual([
      { brandId: 'brand-2', now: NOW },
      { brandId: 'brand-2', now: NOW },
    ]);
    // Cleared first: the last module's tables, each module's in reverse.
    expect(state.cleared).toEqual([
      ['c', 'brand_id', 'brand-2'],
      ['b', 'brand_id', 'brand-2'],
      ['a', 'brand_id', 'brand-2'],
    ]);
    // The real brand is untouched.
    expect(state.brands[0]).toEqual({ id: 'real-1', organization_id: 'org-1', is_demo: false });
  });

  it('leaves a current demo alone', async () => {
    state.brands.push(demo());
    expect(await ensure()).toEqual({ brandId: 'demo-1', version: DEMO_VERSION, rebuilt: false });
    expect(build).not.toHaveBeenCalled();
    expect(state.cleared).toEqual([]);
  });

  it('rebuilds in place a demo of an older version, or one whose data grew old', async () => {
    state.brands.push(demo({ demo_version: DEMO_VERSION - 1 }));
    expect(await ensure()).toEqual({ brandId: 'demo-1', version: DEMO_VERSION, rebuilt: true });
    expect(state.brands[1]).toMatchObject({
      id: 'demo-1',
      demo_version: DEMO_VERSION,
      demo_built_at: NOW.toISOString(),
    });

    build.mockClear();
    state.brands[1].demo_built_at = ago(DEMO_MAX_AGE_MS + 1);
    expect((await ensure()).rebuilt).toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('keeps the demo hidden or shown as the organization left it', async () => {
    state.brands.push(demo({ demo_version: 0, demo_hidden_at: ago(DAY_MS) }));
    await ensure();
    expect(state.brands[1].demo_hidden_at).toBe(ago(DAY_MS));
  });

  it('builds once for two visits at the same moment', async () => {
    const [first, second] = await Promise.all([ensure(), ensure()]);
    expect(first).toEqual(second);
    expect(state.brands.filter((b) => b.is_demo)).toHaveLength(1);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("reads another server's demo when its insert lost the race", async () => {
    state.onRead = () => {
      // Another server inserts the demo between this one's read and insert.
      if (!state.brands.some((b) => b.is_demo)) state.brands.push(demo());
      state.onRead = null;
    };
    const result = await ensure();
    expect(result).toEqual({ brandId: 'demo-1', version: DEMO_VERSION, rebuilt: false });
    expect(build).not.toHaveBeenCalled();
  });

  it("waits on another server's build, then answers with it", async () => {
    vi.useFakeTimers({ now: NOW });
    state.brands.push(demo({ demo_version: null, demo_built_at: ago(1000) }));
    const pending = ensure();
    // The other server finishes.
    state.brands[1].demo_version = DEMO_VERSION;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ brandId: 'demo-1', version: DEMO_VERSION, rebuilt: false });
    expect(build).not.toHaveBeenCalled();
  });

  it('takes over a build left unfinished past its lease', async () => {
    state.brands.push(demo({ demo_version: null, demo_built_at: ago(DEMO_BUILD_LEASE_MS + 1) }));
    expect((await ensure()).rebuilt).toBe(true);
  });

  it('lets the next visit rebuild at once after a failed build', async () => {
    state.brands.push(demo({ demo_version: 0 }));
    build.mockRejectedValueOnce(new Error('insert failed'));
    await expect(ensure()).rejects.toThrow('insert failed');
    expect(state.brands[1]).toMatchObject({ demo_version: null, demo_built_at: null });
    expect(demoState(state.brands[1], NOW)).toBe('stale');

    expect((await ensure()).rebuilt).toBe(true);
    expect(state.brands[1].demo_version).toBe(DEMO_VERSION);
  });

  it('throws when the brand cannot be created', async () => {
    state.failInsert = { code: '42501', message: 'permission denied' };
    await expect(ensure()).rejects.toThrow('demo brand insert: permission denied');
  });
});

describe('the build order', () => {
  it('builds the first module alone, the others together, each after the one it names', async () => {
    const order = [];
    const step = (name, ms) =>
      vi.fn(async () => {
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        order.push(`${name}:end`);
        return { rows: 1 };
      });
    const staged = [
      { name: 'core', tables: ['a'], build: step('core', 5) },
      { name: 'slow', tables: ['b'], build: step('slow', 20) },
      { name: 'actions', tables: ['c'], build: step('actions', 5) },
      { name: 'drafts', tables: ['d'], after: 'actions', build: step('drafts', 1) },
    ];
    await ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: staged });

    expect(order.slice(0, 2)).toEqual(['core:start', 'core:end']);
    // The others start together; drafts waits for actions only, not the slow one.
    expect(order.indexOf('slow:start')).toBeLessThan(order.indexOf('actions:end'));
    expect(order.indexOf('actions:end')).toBeLessThan(order.indexOf('drafts:start'));
    expect(order.indexOf('drafts:end')).toBeLessThan(order.indexOf('slow:end'));
  });

  it('fails the build when any module fails, after the others settle', async () => {
    const fails = vi.fn(async () => {
      throw new Error('boom');
    });
    const staged = [
      { name: 'core', tables: ['a'], build },
      { name: 'bad', tables: ['b'], build: fails },
      { name: 'good', tables: ['c'], build },
    ];
    await expect(
      ensureDemoBrand({ organizationId: 'org-1', now: NOW, modules: staged }),
    ).rejects.toThrow('boom');
    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe('demoState', () => {
  it('reads fresh, building or stale from the version and when it was built', () => {
    expect(demoState(demo(), NOW)).toBe('fresh');
    // A newer server's demo is left to it.
    expect(
      demoState(demo({ demo_version: DEMO_VERSION + 1, demo_built_at: ago(30 * DAY_MS) }), NOW),
    ).toBe('fresh');
    expect(demoState(demo({ demo_version: DEMO_VERSION - 1 }), NOW)).toBe('stale');
    expect(demoState(demo({ demo_built_at: ago(DEMO_MAX_AGE_MS) }), NOW)).toBe('stale');
    expect(demoState(demo({ demo_version: null, demo_built_at: ago(60_000) }), NOW)).toBe(
      'building',
    );
    expect(demoState(demo({ demo_version: null, demo_built_at: null }), NOW)).toBe('stale');
  });
});

describe('setDemoHidden', () => {
  it("hides and shows the organization's demo brand, never another brand", async () => {
    state.brands.push(demo(), demo({ id: 'demo-2', organization_id: 'org-2' }));
    expect(await setDemoHidden({ organizationId: 'org-1', hidden: true, now: NOW })).toEqual({
      brandId: 'demo-1',
      hidden: true,
    });
    expect(state.brands.map((b) => b.demo_hidden_at ?? null)).toEqual([
      null,
      NOW.toISOString(),
      null,
    ]);

    expect(await setDemoHidden({ organizationId: 'org-1', hidden: false })).toEqual({
      brandId: 'demo-1',
      hidden: false,
    });
    expect(state.brands[1].demo_hidden_at).toBeNull();
  });

  it('answers null when the organization has no demo brand', async () => {
    expect(await setDemoHidden({ organizationId: 'org-1', hidden: true })).toBeNull();
  });
});
