// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * Merged competitors (00543) in the MCP Server's and Chat's list_competitors:
 * a merged competitor is never listed on its own (it is out of the
 * competitors table), and the one it was merged into carries its name and
 * domain as aliases, read for the brand within the key's organization.
 */

type Result = { data: unknown; error: { message: string } | null };

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Result>,
  filters: [] as unknown[][],
}));

vi.mock('@/lib/supabase/admin', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'order', 'limit', 'in']) chain[name] = () => chain;
    chain.eq = (...args: unknown[]) => (db.filters.push([table, ...args]), chain);
    const answer = () => db.tables[table] ?? { data: [], error: null };
    chain.maybeSingle = async () => answer();
    chain.single = async () => answer();
    chain.then = (resolve: (r: Result) => void) => resolve(answer());
    return chain;
  };
  return { supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } };
});

const { listCompetitorsFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

beforeEach(() => {
  db.filters = [];
  db.tables = {
    brands: { data: { id: 'b1', name: 'Acme' }, error: null },
    // The tracked ones only: Sky Air Tours, merged into Sky Air, is out of this table.
    competitors: {
      data: [
        { id: 'c1', name: 'Sky Air', domain: 'sky.example', type: null },
        { id: 'c2', name: 'Trips', domain: 'trips.example', type: null },
      ],
      error: null,
    },
    merged_competitors: {
      data: [
        { id: 'm1', merged_into_id: 'c1', name: 'Sky Air Tours', domain: 'skyairtours.example' },
        { id: 'm2', merged_into_id: 'c1', name: 'SkyAir', domain: '' },
      ],
      error: null,
    },
  };
});

describe('listCompetitorsFor with merged competitors', () => {
  it('lists the kept one with its aliases, and never a merged one on its own', async () => {
    const listed = await listCompetitorsFor(auth, 'b1');
    expect(listed).toEqual([
      {
        id: 'c1',
        name: 'Sky Air',
        domain: 'sky.example',
        type: null,
        aliases: [
          { name: 'Sky Air Tours', domain: 'skyairtours.example' },
          { name: 'SkyAir', domain: '' },
        ],
      },
      { id: 'c2', name: 'Trips', domain: 'trips.example', type: null, aliases: [] },
    ]);
    expect(listed?.map((c) => c.id)).not.toContain('m1');
  });

  it('reads the merged ones for the brand within the key’s organization', async () => {
    await listCompetitorsFor(auth, 'b1');
    expect(db.filters).toContainEqual(['merged_competitors', 'brand_id', 'b1']);
    expect(db.filters).toContainEqual(['merged_competitors', 'brands.organization_id', 'org-1']);
  });

  it('lists the competitors without aliases when the merged ones can’t be read', async () => {
    db.tables.merged_competitors = { data: null, error: { message: 'relation does not exist' } };
    expect((await listCompetitorsFor(auth, 'b1'))?.map((c) => c.aliases)).toEqual([[], []]);
  });

  it("reads nothing of a brand that isn't the organization's", async () => {
    db.tables.brands = { data: null, error: null };
    expect(await listCompetitorsFor(auth, 'b9')).toBeNull();
    expect(db.filters.some(([table]) => table === 'merged_competitors')).toBe(false);
  });
});
