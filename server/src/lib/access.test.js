import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who reaches a brand (BRAND-ACCESS spec §5.2, 00388's can_access_brand):
 * the organization's people, and with Selected brands only the brands
 * granted to them, an Admin and the demo brand always. With All brands, the
 * default, every answer is the organization check's; a self-hosted install
 * without an organization still gets in. The caller is read once a request.
 */

// The database's answers: the brand (or brands), the caller's profile, their grants, the prompts.
const state = vi.hoisted(() => ({
  brand: null,
  brands: [],
  profile: null,
  profileError: null,
  grants: [],
  opps: [],
  prompts: [],
  reads: [],
}));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: (columns) => (state.reads.push([table, columns]), chain),
        eq: () => chain,
        in: () => chain,
        single: async () =>
          table === 'brands'
            ? { data: state.brand, error: null }
            : { data: state.opps[0] ?? null, error: null },
        maybeSingle: async () => ({ data: state.profile, error: state.profileError }),
        then: (resolve) =>
          resolve(
            table === 'member_brands'
              ? { data: state.grants.map((brand_id) => ({ brand_id })), error: null }
              : table === 'brands'
                ? { data: state.brands, error: null }
                : table === 'content_opportunities'
                  ? { data: state.opps, error: null }
                  : { data: state.prompts, error: null },
          ),
      };
      return chain;
    },
  },
}));

const {
  assertAllBrands,
  assertBrandAccess,
  assertOpportunitiesAccess,
  assertPromptAccess,
  assertRole,
  MANAGER_ROLES,
  NOT_IN_WORKSPACE,
  NO_BRAND_ACCESS,
} = await import('./access.js');
const { requestScope } = await import('./request-scope.js');

/** Runs `fn` inside one request's store, as server.js mounts it on /api. */
const inRequest = (fn) =>
  new Promise((resolve, reject) => requestScope({}, {}, () => fn().then(resolve, reject)));

const profileReads = () => state.reads.filter(([table]) => table === 'profiles').length;

beforeEach(() => {
  state.brand = { id: 'b1', organization_id: 'org-1', is_demo: false };
  state.brands = [];
  state.profile = { organization_id: 'org-1', role: 'manager', brand_scope: 'all' };
  state.profileError = null;
  state.grants = [];
  state.opps = [];
  state.prompts = [];
  state.reads = [];
});

describe('assertBrandAccess', () => {
  it('lets a brand of the caller’s organization through, with their role', async () => {
    await expect(assertBrandAccess('b1', 'u1')).resolves.toMatchObject({
      orgId: 'org-1',
      role: 'manager',
      brand: { id: 'b1' },
    });
    // All brands reads no grants.
    expect(state.reads.some(([table]) => table === 'member_brands')).toBe(false);
  });

  // BUG-001: a bare "Unauthorized" read as a session problem, with no reason.
  it('says in plain words that another organization’s brand isn’t in the workspace, as a 403', async () => {
    state.profile.organization_id = 'org-2';
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({
      message: NOT_IN_WORKSPACE,
      status: 403,
      code: 'not_in_workspace',
    });
  });

  it('says a brand that is gone is not found', async () => {
    state.brand = null;
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({ status: 404 });
  });

  it('lets a self-hosted install without an organization through', async () => {
    state.brand.organization_id = null;
    state.profile.organization_id = null;
    await expect(assertBrandAccess('b1', 'u1')).resolves.toMatchObject({ orgId: null });
  });

  it('lets Selected brands reach only the brands granted, and the demo brand', async () => {
    state.profile.brand_scope = 'selected';
    state.grants = ['b2'];
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({
      message: NO_BRAND_ACCESS,
      status: 403,
      code: 'no_brand_access',
    });
    state.brand = { id: 'b2', organization_id: 'org-1', is_demo: false };
    await expect(assertBrandAccess('b2', 'u1')).resolves.toMatchObject({ brand: { id: 'b2' } });
    state.brand = { id: 'demo', organization_id: 'org-1', is_demo: true };
    await expect(assertBrandAccess('demo', 'u1')).resolves.toMatchObject({ brand: { id: 'demo' } });
    // Another organization's brand, granted or not, is still not in the workspace.
    state.brand = { id: 'b2', organization_id: 'org-2', is_demo: false };
    await expect(assertBrandAccess('b2', 'u1')).rejects.toMatchObject({
      code: 'not_in_workspace',
    });
  });

  it('lets an Admin reach every brand of the organization, whatever the scope says', async () => {
    state.profile = { organization_id: 'org-1', role: 'admin', brand_scope: 'selected' };
    await expect(assertBrandAccess('b1', 'u1')).resolves.toMatchObject({ role: 'admin' });
    expect(state.reads.some(([table]) => table === 'member_brands')).toBe(false);
  });

  it('returns the brand’s other columns when asked', async () => {
    await assertBrandAccess('b1', 'u1', { columns: 'name, is_active' });
    expect(state.reads).toContainEqual(['brands', 'id, organization_id, is_demo, name, is_active']);
  });

  it('fails, not refuses, when the caller cannot be read', async () => {
    state.profileError = { message: 'connection reset' };
    await expect(assertBrandAccess('b1', 'u1')).rejects.toThrow('connection reset');
  });

  it('reads the caller once a request, and again in the next', async () => {
    await inRequest(async () => {
      await assertBrandAccess('b1', 'u1');
      await assertBrandAccess('b1', 'u1');
      await assertAllBrands('u1');
    });
    expect(profileReads()).toBe(1);
    await inRequest(() => assertBrandAccess('b1', 'u1'));
    expect(profileReads()).toBe(2);
    // Outside a request (a job, a socket), every check reads afresh.
    await assertBrandAccess('b1', 'u1');
    await assertBrandAccess('b1', 'u1');
    expect(profileReads()).toBe(4);
  });
});

describe('assertAllBrands', () => {
  it('lets All brands and Admins through, and refuses Selected brands', async () => {
    await expect(assertAllBrands('u1')).resolves.toMatchObject({ orgId: 'org-1' });
    state.profile.brand_scope = 'selected';
    await expect(assertAllBrands('u1')).rejects.toMatchObject({
      status: 403,
      code: 'no_brand_access',
    });
    state.profile.role = 'admin';
    await expect(assertAllBrands('u1')).resolves.toMatchObject({ role: 'admin' });
  });
});

describe('assertOpportunitiesAccess and assertPromptAccess', () => {
  const brandRow = (id, org = 'org-1') => ({ id, organization_id: org, is_demo: false });

  it('lets opportunities of reachable brands through, and refuses one not granted', async () => {
    state.opps = [
      { id: 'o1', brand_id: 'b1' },
      { id: 'o2', brand_id: 'b2' },
    ];
    state.brands = [brandRow('b1'), brandRow('b2')];
    await expect(assertOpportunitiesAccess(['o1', 'o2'], 'u1')).resolves.toHaveLength(2);
    state.profile.brand_scope = 'selected';
    state.grants = ['b1'];
    await expect(assertOpportunitiesAccess(['o1', 'o2'], 'u1')).rejects.toMatchObject({
      code: 'no_brand_access',
    });
    // Another organization's comes first.
    state.brands = [brandRow('b1', 'org-2'), brandRow('b2')];
    await expect(assertOpportunitiesAccess(['o1', 'o2'], 'u1')).rejects.toMatchObject({
      code: 'not_in_workspace',
    });
  });

  it('lets prompts of reachable brands through, and refuses one not granted', async () => {
    const prompt = (id, brandId, org = 'org-1') => ({
      id,
      prompt_sets: { brand_id: brandId, brands: { organization_id: org, is_demo: false } },
    });
    state.prompts = [prompt('p1', 'b1'), prompt('p2', 'b2')];
    await expect(assertPromptAccess(['p1', 'p2'], 'u1')).resolves.toHaveLength(2);
    state.profile.brand_scope = 'selected';
    state.grants = ['b1', 'b2'];
    await expect(assertPromptAccess(['p1', 'p2'], 'u1')).resolves.toHaveLength(2);
    state.grants = ['b1'];
    await expect(assertPromptAccess(['p1', 'p2'], 'u1')).rejects.toMatchObject({
      code: 'no_brand_access',
    });
    state.prompts = [prompt('p1', 'b1', 'org-2')];
    await expect(assertPromptAccess('p1', 'u1')).rejects.toMatchObject({
      code: 'not_in_workspace',
    });
  });
});

describe('assertRole', () => {
  it('lets a role on the list through, and says which it is', async () => {
    await expect(assertRole('u1', MANAGER_ROLES, 'No.')).resolves.toBe('manager');
  });

  it('refuses any other role with the message, as a 403', async () => {
    state.profile = { role: 'analyst' };
    await expect(
      assertRole('u1', MANAGER_ROLES, 'Only admins and managers can delete opportunities.'),
    ).rejects.toMatchObject({
      message: 'Only admins and managers can delete opportunities.',
      status: 403,
      code: 'forbidden',
    });
  });

  it('refuses a caller without a profile', async () => {
    state.profile = null;
    await expect(assertRole('u1', MANAGER_ROLES, 'No.')).rejects.toMatchObject({ status: 403 });
  });

  it('fails, not refuses, when the profile cannot be read', async () => {
    state.profileError = { message: 'connection reset' };
    await expect(assertRole('u1', MANAGER_ROLES, 'No.')).rejects.toThrow('connection reset');
  });
});
