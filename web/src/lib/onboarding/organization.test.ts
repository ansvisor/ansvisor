import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import {
  ensureOrganization,
  nameWorkspaceFromBrand,
  resetEnsureOrganization,
} from './organization';

/**
 * The organization a new admin's choice screen makes with their own session
 * (row-level security), and the name it takes from its first brand.
 */

type Row = Record<string, unknown>;

function client({
  orgId = null as string | null,
  joinFails = false,
  joinedMeanwhile = null as string | null,
  orgName = 'My workspace' as string | null,
  renameFails = false,
} = {}) {
  const state = { orgId };
  const writes: [string, string, Row][] = [];
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () =>
      table === 'profiles'
        ? { data: { organization_id: state.orgId }, error: null }
        : { data: orgName === null ? null : { name: orgName }, error: null };
    q.insert = async (row: Row) => {
      writes.push([table, 'insert', row]);
      return { error: null };
    };
    q.update = (row: Row) => ({
      eq: async () => {
        writes.push([table, 'update', row]);
        if (table === 'profiles' && joinFails) {
          state.orgId = joinedMeanwhile;
          return { error: { message: 'profile organization is managed server-side' } };
        }
        if (table === 'organizations' && renameFails) return { error: { message: 'denied' } };
        if (table === 'profiles') state.orgId = row.organization_id as string;
        return { error: null };
      },
    });
    return q;
  });
  return { supabase: { from } as unknown as SupabaseClient<Database>, writes };
}

beforeEach(() => {
  resetEnsureOrganization();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ensureOrganization', () => {
  it('makes the organization and puts the person in it', async () => {
    const { supabase, writes } = client();
    const made = await ensureOrganization(supabase, 'u1', 'My workspace');
    expect(made.created).toBe(true);
    expect(writes).toEqual([
      ['organizations', 'insert', { id: made.id, name: 'My workspace', slug: 'my-workspace' }],
      ['profiles', 'update', { organization_id: made.id }],
    ]);
  });

  it('reuses the one the person is in, and makes none', async () => {
    const { supabase, writes } = client({ orgId: 'org-1' });
    expect(await ensureOrganization(supabase, 'u1', 'Acme')).toEqual({
      id: 'org-1',
      created: false,
    });
    expect(writes).toEqual([]);
  });

  it('makes one for two asks at once', async () => {
    const { supabase, writes } = client();
    const [a, b] = await Promise.all([
      ensureOrganization(supabase, 'u1', 'My workspace'),
      ensureOrganization(supabase, 'u1', 'My workspace'),
    ]);
    expect(b).toBe(a);
    expect(writes.filter(([, op]) => op === 'insert')).toHaveLength(1);
  });

  it('returns the one joined meanwhile, in another tab', async () => {
    const { supabase } = client({ joinFails: true, joinedMeanwhile: 'org-other' });
    expect(await ensureOrganization(supabase, 'u1', 'My workspace')).toEqual({
      id: 'org-other',
      created: false,
    });
  });

  it('fails when the person could not be put in it, and asks again next time', async () => {
    const { supabase } = client({ joinFails: true });
    await expect(ensureOrganization(supabase, 'u1', 'My workspace')).rejects.toThrow(
      'profile organization is managed server-side',
    );
    const again = client();
    expect((await ensureOrganization(again.supabase, 'u1', 'My workspace')).created).toBe(true);
  });
});

describe('nameWorkspaceFromBrand', () => {
  it('names a workspace still named as it was made after its first brand', async () => {
    const { supabase, writes } = client();
    await nameWorkspaceFromBrand(supabase, 'org-1', {
      placeholder: 'My workspace',
      brandName: 'Acme',
    });
    expect(writes).toEqual([['organizations', 'update', { name: 'Acme' }]]);
  });

  it('leaves a workspace renamed since, or unread, as it is', async () => {
    for (const orgName of ['Acme Group', null]) {
      const { supabase, writes } = client({ orgName });
      await nameWorkspaceFromBrand(supabase, 'org-1', {
        placeholder: 'My workspace',
        brandName: 'Acme',
      });
      expect(writes).toEqual([]);
    }
  });

  it('never throws when the rename is refused', async () => {
    const { supabase } = client({ renameFails: true });
    await expect(
      nameWorkspaceFromBrand(supabase, 'org-1', { placeholder: 'My workspace', brandName: 'Acme' }),
    ).resolves.toBeUndefined();
  });
});
