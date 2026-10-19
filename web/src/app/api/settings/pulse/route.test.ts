import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/settings/pulse: the Daily Pulse's delivery per brand, and whether the
 * AI Traffic weekly digest (AT-013) is on — on unless an admin or manager
 * turned it off.
 */

const state = vi.hoisted(() => ({
  role: 'admin',
  settings: [] as Record<string, unknown>[],
  upserts: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: 'u1', role: state.role, organization_id: 'o1' },
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'pulse_settings') {
        return {
          select: () => ({ in: async () => ({ data: state.settings }) }),
          upsert: async (row: Record<string, unknown>) => {
            state.upserts.push(row);
            return { error: null };
          },
        };
      }
      // brands: the org's active list, or one brand by id.
      const list = { data: [{ id: 'b1', name: 'Acme' }], error: null };
      const chain = {
        eq: () => chain,
        order: async () => list,
        single: async () => ({ data: { id: 'b1', organization_id: 'o1' } }),
      };
      return { select: () => chain };
    },
  },
}));

const { GET, PUT } = await import('./route');

const put = (body: Record<string, unknown>) =>
  PUT(
    new Request('http://localhost/api/settings/pulse', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  state.role = 'admin';
  state.settings = [];
  state.upserts = [];
});

describe('GET /api/settings/pulse', () => {
  it('has the weekly digest on for a brand nobody configured, and as saved otherwise', async () => {
    expect((await (await GET()).json()).brands).toEqual([
      { brandId: 'b1', brandName: 'Acme', frequency: 'daily', recipients: [], trafficDigest: true },
    ]);
    state.settings = [
      {
        brand_id: 'b1',
        frequency: 'weekly',
        recipients: ['a@acme.example'],
        traffic_digest: false,
      },
    ];
    expect((await (await GET()).json()).brands[0]).toMatchObject({
      frequency: 'weekly',
      trafficDigest: false,
    });
  });
});

describe('PUT /api/settings/pulse', () => {
  it('saves the digest switch with the pulse, and leaves it alone when not sent', async () => {
    expect((await put({ brandId: 'b1', frequency: 'off', trafficDigest: false })).status).toBe(200);
    expect(state.upserts[0]).toMatchObject({
      brand_id: 'b1',
      frequency: 'off',
      traffic_digest: false,
    });

    await put({ brandId: 'b1', frequency: 'daily' });
    expect(state.upserts[1]).not.toHaveProperty('traffic_digest');
  });

  it('refuses a switch that is not true or false, and members who are not admins or managers', async () => {
    expect((await put({ brandId: 'b1', frequency: 'daily', trafficDigest: 'no' })).status).toBe(
      400,
    );
    state.role = 'analyst';
    expect((await put({ brandId: 'b1', frequency: 'daily', trafficDigest: true })).status).toBe(
      403,
    );
    expect(state.upserts).toEqual([]);
  });
});
