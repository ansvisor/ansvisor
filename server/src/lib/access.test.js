import { beforeEach, describe, expect, it, vi } from 'vitest';

// The brand, the caller's organization and profile, as the database answers them.
const state = vi.hoisted(() => ({ brand: null, orgId: null, profile: null, profileError: null }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: state.brand, error: null }),
        maybeSingle: async () => ({ data: state.profile, error: state.profileError }),
      };
      return chain;
    },
  },
}));
vi.mock('./plan-guard.js', () => ({ getOrgIdForUser: async () => state.orgId }));

const { assertBrandAccess, assertRole, MANAGER_ROLES, NOT_IN_WORKSPACE } =
  await import('./access.js');

beforeEach(() => {
  state.brand = { id: 'b1', organization_id: 'org-1' };
  state.orgId = 'org-1';
  state.profile = { role: 'manager' };
  state.profileError = null;
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
