// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const user = vi.hoisted(() => ({
  manager: true,
  report: { id: 'r1', brand_id: 'b1' } as { id: string; brand_id: string } | null,
  access: true,
}));
const writable = vi.hoisted(() => vi.fn(async (_opts?: unknown) => undefined));
const adminWrites = vi.hoisted(() => ({ calls: [] as unknown[][], rows: [{ id: 'r1' }] }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: user.report, error: null }),
      };
      return chain;
    },
    rpc: async () => ({ data: user.access, error: null }),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        update: (values: unknown) => (adminWrites.calls.push([table, 'update', values]), chain),
        eq: (column: string, value: unknown) => (
          adminWrites.calls.push([table, 'eq', column, value]),
          chain
        ),
        select: async () => ({ data: adminWrites.rows, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('@/lib/session-role', () => ({ isManager: async () => user.manager }));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: writable }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { renameReport } = await import('./reports');

beforeEach(() => {
  user.manager = true;
  user.report = { id: 'r1', brand_id: 'b1' };
  user.access = true;
  writable.mockReset().mockResolvedValue(undefined);
  adminWrites.calls = [];
});

describe('renameReport (UX audit RP-11)', () => {
  it('renames the title alone, held to the report and its brand, after every check', async () => {
    expect(await renameReport('r1', '  Board   review ')).toBe(true);
    expect(writable).toHaveBeenNthCalledWith(1);
    // The brand's own plan check too (a demo brand changes nothing).
    expect(writable).toHaveBeenNthCalledWith(2, { brandId: 'b1' });
    expect(adminWrites.calls).toEqual([
      ['reports', 'update', { title: 'Board review' }],
      ['reports', 'eq', 'id', 'r1'],
      ['reports', 'eq', 'brand_id', 'b1'],
    ]);
  });

  it('writes nothing for an Analyst, a report the person can’t read, or a brand they can’t see', async () => {
    user.manager = false;
    expect(await renameReport('r1', 'Board review')).toBe(false);
    user.manager = true;
    user.report = null;
    expect(await renameReport('r9', 'Board review')).toBe(false);
    user.report = { id: 'r1', brand_id: 'b1' };
    user.access = false;
    expect(await renameReport('r1', 'Board review')).toBe(false);
    expect(adminWrites.calls).toEqual([]);
  });

  it('writes nothing for a blank or over-long name, or a workspace that can’t write', async () => {
    expect(await renameReport('r1', '   ')).toBe(false);
    expect(await renameReport('r1', 'x'.repeat(201))).toBe(false);
    writable.mockRejectedValueOnce(new Error('read only'));
    await expect(renameReport('r1', 'Board review')).rejects.toThrow('read only');
    expect(adminWrites.calls).toEqual([]);
  });
});
