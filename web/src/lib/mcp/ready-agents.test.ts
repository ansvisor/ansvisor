// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * list_ready_agents' read (AGENTS plan §3 #11, §8): the agents setup
 * recommends for the brand's site type and the person's work areas, by
 * Ready to use's own rule, each with its card's name and line, why it fits
 * and the link to its card. Nothing is created or turned on; a brand
 * outside the person's access reads nothing.
 */

const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  filters: [] as { table: string; column: string; value: unknown }[],
  brandAllowed: vi.fn(),
}));

function from(table: string) {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      db.filters.push({ table, column, value });
      return chain;
    },
    maybeSingle: async () => ({ data: db.rows[table] ?? null, error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from } }));
vi.mock('./data', () => ({ brandAllowed: db.brandAllowed }));

const { listReadyAgentsFor } = await import('./ready-agents');

const auth: McpAuthContext = {
  userId: 'u1',
  email: null,
  organizationId: 'org-1',
  role: 'analyst',
  apiKeyId: 'agent-internal',
};

beforeEach(() => {
  db.rows = {};
  db.filters = [];
  db.brandAllowed.mockReset();
  db.brandAllowed.mockResolvedValue(true);
});

describe('listReadyAgentsFor', () => {
  it("recommends the brand's site type's agents and the person's role's, each linked to its card", async () => {
    db.rows.brands = {
      site_type: 'b2b',
      industry: 'B2B Software (SaaS)',
      shopping_mode_enabled: false,
    };
    db.rows.profiles = { work_areas: ['leaders', 'not-an-area'] };
    const read = await listReadyAgentsFor(auth, { brandId: 'brand-1' });
    expect(db.brandAllowed).toHaveBeenCalledWith(auth, 'brand-1');
    expect(db.filters).toEqual([
      { table: 'brands', column: 'id', value: 'brand-1' },
      { table: 'profiles', column: 'id', value: 'u1' },
    ]);
    expect(read).toMatchObject({
      site_type: 'B2B',
      site_type_set: true,
      industry: 'B2B Software (SaaS)',
      work_areas: ['Founders & leaders'],
    });
    expect(read?.agents).toEqual([
      {
        name: 'Alternatives & Comparison Pages',
        does: expect.stringContaining('alternatives pages'),
        fits: 'site_type',
        skills: ['/compare', '/features'],
        href: '/dashboard/agents?tab=ready#preset-alternatives-comparison-pages',
      },
      expect.objectContaining({ name: 'Integration Questions', fits: 'site_type' }),
      expect.objectContaining({
        name: 'CEO Brief',
        fits: 'role',
        for_work_areas: ['Founders & leaders'],
        href: '/dashboard/agents?tab=ready#preset-ceo-brief',
      }),
    ]);
    expect(read?.turn_on).toContain('Never create, turn on or run one');
  });

  it('guesses a site type nobody set, from the industry, and fills up with agents for every brand', async () => {
    db.rows.brands = {
      site_type: null,
      industry: 'Travel & Hospitality',
      shopping_mode_enabled: false,
    };
    const read = await listReadyAgentsFor(auth, { brandId: 'brand-1' });
    expect(read).toMatchObject({ site_type: 'B2C', site_type_set: false, work_areas: [] });
    expect(read?.agents.map((agent) => [agent.name, agent.fits])).toEqual([
      ['Social-proof Pages', 'site_type'],
      ['Visibility Watch', 'every_brand'],
      ['Citation Win-back', 'every_brand'],
    ]);
    // Never itself, never a Soon one.
    expect(read?.agents.map((agent) => agent.name)).not.toContain('Onboarding & Help');
    expect(read?.agents.map((agent) => agent.name)).not.toContain('Reviews & UGC Watch');
  });

  it('reads nothing for a brand outside the person’s access, and nothing for one gone', async () => {
    db.brandAllowed.mockResolvedValue(false);
    expect(await listReadyAgentsFor(auth, { brandId: 'other' })).toBeNull();
    expect(db.filters).toEqual([]);
    db.brandAllowed.mockResolvedValue(true);
    expect(await listReadyAgentsFor(auth, { brandId: 'gone' })).toBeNull();
  });
});
