// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/ads/connections (ADS-01 §3.5): Google Analytics as Chat's
 * Connections has it, from the one read of a brand's connections, for a
 * brand the person reaches; nothing while Ads is off.
 */

const BRAND = 'bbbbbbbb-0000-4000-8000-000000000001';
const state = vi.hoisted(() => ({
  user: true,
  reached: true,
  property: null as string | null,
  signIn: 'connected',
  admin: [] as unknown[][],
}));

/** A query that answers `data` whatever it is asked, keeping its filters in `seen`. */
const query = (data: unknown, seen: unknown[][] = [], table = '') => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
  };
  chain.in = chain.eq = (...filter: unknown[]) => (seen.push([table, ...filter]), chain);
  return chain;
};
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user ? { id: 'u1' } : null } }) },
    from: () => query(state.reached ? { id: BRAND, organization_id: 'org-1' } : null),
  }),
}));
// The service role: the brand's property, and the workspace's Analytics sign-in.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) =>
      query(
        table === 'brands'
          ? [{ id: BRAND, gsc_property: null, ga_property_id: state.property }]
          : table === 'integration_connections'
            ? [{ provider: 'google-analytics', status: state.signIn }]
            : [],
        state.admin,
        table,
      ),
  },
}));

const { GET } = await import('./route');
const get = async (brandId: string = BRAND) => {
  const res = await GET(new Request(`https://app.example/api/ads/connections?brandId=${brandId}`));
  return [res.status, await res.json()];
};

beforeEach(() => {
  vi.stubEnv('ADS_ENABLED', 'true');
  Object.assign(state, { user: true, reached: true, property: null, signIn: 'connected' });
  state.admin = [];
});

describe('GET /api/ads/connections', () => {
  it('shows Google Analytics connected when the brand has a property, and not otherwise', async () => {
    expect(await get()).toEqual([200, { analytics: { status: 'not_connected' } }]);
    state.property = '123456789';
    expect(await get()).toEqual([200, { analytics: { status: 'connected' } }]);
    // Read for that brand and its workspace only.
    expect(state.admin).toContainEqual(['brands', 'id', [BRAND]]);
    expect(state.admin).toContainEqual(['integration_connections', 'organization_id', 'org-1']);
    // A property whose sign-in is gone fails, as Chat's Connections says.
    state.signIn = 'expired';
    expect((await get())[1].analytics.status).toBe('failing');
  });

  it('answers nothing while Ads is off, without a session, or for a brand the person does not reach', async () => {
    expect(await get('nope')).toEqual([400, { error: 'invalid', code: 'invalid' }]);
    state.reached = false;
    expect((await get())[0]).toBe(404);
    state.user = false;
    expect((await get())[0]).toBe(401);
    vi.stubEnv('ADS_ENABLED', '');
    expect(await get()).toEqual([404, { error: 'off', code: 'off' }]);
    expect(state.admin).toEqual([]);
  });
});
