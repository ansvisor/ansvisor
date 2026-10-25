import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings › Content (CE-051): a brand's Content settings, read and written.
 * RLS decides who may change a brand; no row back is a refusal.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const ACME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface Call {
  table: string;
  op: string;
  row?: unknown;
  filters: [string, unknown][];
}
let calls: Call[] = [];
/** What a write or read of each table answers. */
let answers: Record<
  string,
  { data: unknown; count?: number; error: null | { message: string; code?: string } }
> = {};

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  calls.push(call);
  const answer = () => answers[`${table}.${call.op}`] ?? { data: null, error: null };
  const chain = {
    select: () => chain,
    insert: (row: unknown) => Object.assign(call, { op: 'insert', row }) && chain,
    update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
    upsert: (row: unknown) => Object.assign(call, { op: 'upsert', row }) && chain,
    delete: () => Object.assign(call, { op: 'delete' }) && chain,
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return chain;
    },
    is: (column: string, value: unknown) => {
      call.filters.push([`is ${column}`, value]);
      return chain;
    },
    order: () => chain,
    single: async () => answer(),
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    from: builder,
  })),
}));

const { getContentSettings, setBrandQualityHandoff } = await import('./content-settings');

const writes = () => calls.filter((c) => c.op !== 'select');

beforeEach(() => {
  calls = [];
  answers = {
    'profiles.select': { data: { organization_id: ORG, role: 'manager' }, error: null },
    'brands.select': {
      data: [{ id: ACME, name: 'Acme', content_quality_handoff: true }],
      error: null,
    },
  };
});

describe('getContentSettings', () => {
  it("reads the organization's brands with their hand-off, and whether the member may change it", async () => {
    await expect(getContentSettings()).resolves.toEqual({
      brands: [{ id: ACME, name: 'Acme', qualityHandoff: true }],
      canManage: true,
    });
    expect(calls.find((c) => c.table === 'brands')!.filters).toEqual([['organization_id', ORG]]);
    answers['profiles.select'] = { data: { organization_id: ORG, role: 'analyst' }, error: null };
    await expect(getContentSettings()).resolves.toMatchObject({ canManage: false });
    answers['profiles.select'] = { data: null, error: null };
    await expect(getContentSettings()).resolves.toBeNull();
  });
});

describe('setBrandQualityHandoff', () => {
  it("turns a brand's hand-off on or off, and fails when RLS lets no row through", async () => {
    answers['brands.update'] = { data: [{ id: ACME }], error: null };
    await setBrandQualityHandoff(ACME, true);
    expect(writes()).toEqual([
      {
        table: 'brands',
        op: 'update',
        row: { content_quality_handoff: true },
        filters: [['id', ACME]],
      },
    ]);
    answers['brands.update'] = { data: [], error: null };
    await expect(setBrandQualityHandoff(ACME, false)).rejects.toThrow('forbidden');
    await expect(setBrandQualityHandoff('acme', true)).rejects.toThrow('invalid');
  });
});
