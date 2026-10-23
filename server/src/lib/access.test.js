import { beforeEach, describe, expect, it, vi } from 'vitest';

// The brand and the caller's organization, as the database answers them.
const state = vi.hoisted(() => ({ brand: null, orgId: null }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: state.brand, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('./plan-guard.js', () => ({ getOrgIdForUser: async () => state.orgId }));

const { assertBrandAccess, NOT_IN_WORKSPACE } = await import('./access.js');

beforeEach(() => {
  state.brand = { id: 'b1', organization_id: 'org-1' };
  state.orgId = 'org-1';
});

describe('assertBrandAccess', () => {
  it('lets a brand of the caller’s organization through', async () => {
    await expect(assertBrandAccess('b1', 'u1')).resolves.toMatchObject({ orgId: 'org-1' });
  });

  // BUG-001: a bare "Unauthorized" read as a session problem, with no reason.
  it('says in plain words that another organization’s brand isn’t in the workspace, as a 403', async () => {
    state.orgId = 'org-2';
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
});
