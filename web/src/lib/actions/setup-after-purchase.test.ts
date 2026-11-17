import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * finishSetupAfterPurchase: the end of setup with a plan active already. The
 * brand id comes from the browser, so it must be a brand of the person's own
 * organization and never the demo brand; only admins and managers. It aligns
 * the prompts to the plan, keeps the demo brand hidden, starts the brand's
 * first run once, marks onboarding completed and hands back the run's job.
 */

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  profile: { organization_id: 'org1', role: 'admin' } as Record<string, unknown> | null,
  org: { plan: 'growth', subscription_status: 'trialing' } as Record<string, unknown> | null,
  orgError: null as { message: string } | null,
  // The brands the admin client finds: by id, with their organization and kind.
  brands: [
    { id: 'b1', organization_id: 'org1', is_demo: false },
    { id: 'demo', organization_id: 'org1', is_demo: true },
    { id: 'other', organization_id: 'org2', is_demo: false },
  ],
  profileUpdates: [] as { values: unknown; filters: [string, unknown][] }[],
  profileUpdateError: null as { message: string } | null,
  adminFilters: [] as { table: string; filters: [string, unknown][] }[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
      const filters: [string, unknown][] = [];
      let values: unknown = null;
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => ({ data: state.profile, error: null }),
        update: (next: unknown) => {
          values = next;
          return query;
        },
        then: (resolve: (v: unknown) => unknown) => {
          state.profileUpdates.push({ values, filters });
          return resolve({ error: state.profileUpdateError });
        },
      };
      return query;
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      state.adminFilters.push({ table, filters });
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => {
          if (table === 'organizations') {
            const id = filters.find(([c]) => c === 'id')?.[1];
            return { data: id === 'org1' ? state.org : null, error: state.orgError };
          }
          const found = state.brands.find((brand) =>
            filters.every(([column, value]) => brand[column as keyof typeof brand] === value),
          );
          return { data: found ? { id: found.id } : null, error: null };
        },
      };
      return query;
    },
  },
}));

const guard = vi.hoisted(() => ({ assertWritable: vi.fn(async () => {}) }));
vi.mock('@/lib/subscription-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscription-guard')>()),
  assertWritable: guard.assertWritable,
}));
const align = vi.hoisted(() => ({
  alignPromptsToPlanForOrg: vi.fn(async () => ({ platforms: [], models: [], promptCount: 12 })),
}));
vi.mock('@/lib/plan-engines', () => align);
const demo = vi.hoisted(() => ({ hideDemoBrandAfterPurchase: vi.fn(async () => {}) }));
vi.mock('@/lib/demo/hide-after-purchase', () => demo);
const firstRun = vi.hoisted(() => ({
  startFirstRunForBrand: vi.fn(async (): Promise<string | null> => 'job1'),
}));
vi.mock('@/lib/billing/first-run', () => firstRun);

const { finishSetupAfterPurchase } = await import('./setup-after-purchase');
const { DemoBrandError, SubscriptionInactiveError } = await import('@/lib/subscription-guard');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.user = { id: 'u1' };
  state.profile = { organization_id: 'org1', role: 'admin' };
  state.org = { plan: 'growth', subscription_status: 'trialing' };
  state.orgError = null;
  state.profileUpdates = [];
  state.profileUpdateError = null;
  state.adminFilters = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Nothing was changed or started. */
function expectNothingDone() {
  expect(align.alignPromptsToPlanForOrg).not.toHaveBeenCalled();
  expect(demo.hideDemoBrandAfterPurchase).not.toHaveBeenCalled();
  expect(firstRun.startFirstRunForBrand).not.toHaveBeenCalled();
  expect(state.profileUpdates).toEqual([]);
}

describe('finishSetupAfterPurchase', () => {
  it("aligns the prompts, starts the brand's first run once and marks onboarding completed", async () => {
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: true, jobId: 'job1' });
    // The plan and the demo brand checked first, with the brand.
    expect(guard.assertWritable).toHaveBeenCalledWith({ brandId: 'b1' });
    expect(align.alignPromptsToPlanForOrg).toHaveBeenCalledWith('org1', 'growth');
    expect(demo.hideDemoBrandAfterPurchase).toHaveBeenCalledWith(
      'org1',
      'trialing',
      expect.any(String),
    );
    expect(firstRun.startFirstRunForBrand).toHaveBeenCalledTimes(1);
    expect(firstRun.startFirstRunForBrand).toHaveBeenCalledWith({
      orgId: 'org1',
      brandId: 'b1',
      subscriptionStatus: 'trialing',
      ctx: expect.any(String),
    });
    // The prompts are aligned before the run, so it tracks the plan's engines.
    expect(align.alignPromptsToPlanForOrg.mock.invocationCallOrder[0]).toBeLessThan(
      firstRun.startFirstRunForBrand.mock.invocationCallOrder[0],
    );
    expect(state.profileUpdates).toEqual([
      { values: { onboarding_completed: true }, filters: [['id', 'u1']] },
    ]);
    // Every service-role read is the person's organization's.
    expect(state.adminFilters).toEqual([
      { table: 'organizations', filters: [['id', 'org1']] },
      {
        table: 'brands',
        filters: [
          ['id', 'b1'],
          ['organization_id', 'org1'],
          ['is_demo', false],
        ],
      },
    ]);
  });

  it('lets a manager finish too', async () => {
    state.profile = { organization_id: 'org1', role: 'manager' };
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: true, jobId: 'job1' });
  });

  it('hands back no job when no run could be started, and still finishes', async () => {
    firstRun.startFirstRunForBrand.mockResolvedValueOnce(null);
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: true, jobId: null });
    expect(state.profileUpdates).toHaveLength(1);
  });

  it("refuses another organization's brand", async () => {
    expect(await finishSetupAfterPurchase('other')).toEqual({ ok: false, reason: 'not_found' });
    expectNothingDone();
  });

  it('refuses the demo brand, and never starts its run', async () => {
    guard.assertWritable.mockRejectedValueOnce(new DemoBrandError());
    expect(await finishSetupAfterPurchase('demo')).toEqual({ ok: false, reason: 'not_found' });
    expectNothingDone();
    // Even past the check: the brand read leaves the demo brand out.
    expect(await finishSetupAfterPurchase('demo')).toEqual({ ok: false, reason: 'not_found' });
    expectNothingDone();
  });

  it.each(['analyst', 'agency_partner', null])('refuses a %s', async (role) => {
    state.profile = { organization_id: 'org1', role };
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: false, reason: 'forbidden' });
    expectNothingDone();
    expect(state.adminFilters).toEqual([]);
  });

  it('refuses someone with no organization, or no one signed in', async () => {
    state.profile = { organization_id: null, role: 'admin' };
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: false, reason: 'forbidden' });
    state.user = null;
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: false, reason: 'forbidden' });
    expectNothingDone();
  });

  it('answers no_plan when the plan is not active, for the plan step', async () => {
    guard.assertWritable.mockRejectedValueOnce(new SubscriptionInactiveError());
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: false, reason: 'no_plan' });
    expectNothingDone();

    state.org = { plan: 'starter', subscription_status: 'canceled' };
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: false, reason: 'no_plan' });
    expectNothingDone();
  });

  it('answers no_plan on a self-hosted install, whose setup starts its own run', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: false, reason: 'no_plan' });
    expectNothingDone();
  });

  it('fails without changing anything when the organization could not be read', async () => {
    state.orgError = { message: 'timeout' };
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: false, reason: 'failed' });
    expectNothingDone();
  });

  it('fails, to be pressed again, when onboarding could not be marked completed', async () => {
    state.profileUpdateError = { message: 'denied' };
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: false, reason: 'failed' });
    // Pressed again, it asks for the run again: the API hands back the same one.
    state.profileUpdateError = null;
    expect(await finishSetupAfterPurchase('b1')).toEqual({ ok: true, jobId: 'job1' });
    expect(firstRun.startFirstRunForBrand).toHaveBeenCalledTimes(2);
  });

  it('lets an unread plan throw, as every gated action', async () => {
    guard.assertWritable.mockRejectedValueOnce(new Error('Could not read the plan'));
    await expect(finishSetupAfterPurchase('b1')).rejects.toThrow('Could not read the plan');
    expectNothingDone();
  });
});
