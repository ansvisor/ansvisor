// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server actions on a read-only workspace (Ansvisor Cloud, plan not active):
 * one that writes refuses before it writes anything, and writes once the
 * plan is active; setup's writes stay open to an organization that never
 * subscribed; the person's own profile and a page-opened trace stay open.
 */

let org: { subscription_status: string | null; stripe_subscription_id: string | null };
let writes: string[];

/** A query builder whose every call chains; records a write, resolves to `row`. */
function query(table: string): unknown {
  const row =
    table === 'profiles'
      ? { organization_id: 'org-1' }
      : table === 'organizations'
        ? org
        : { id: 'row-1', brand_id: 'brand-1', prompt_id: 'prompt-1', name: 'Acme', domain: '' };
  const result = { data: row, error: null };
  const builder: unknown = new Proxy(
    {},
    {
      get: (_, prop) => {
        if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(result);
        return () => {
          if (['insert', 'update', 'upsert', 'delete'].includes(prop as string)) {
            writes.push(`${table}.${String(prop)}`);
          }
          return builder;
        };
      },
    },
  );
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
      updateUser: async () => {
        writes.push('auth.updateUser');
        return { error: null };
      },
    },
    from: (table: string) => query(table),
    rpc: async (fn: string) => {
      writes.push(`rpc.${fn}`);
      return { data: true, error: null };
    },
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { SubscriptionInactiveError } = await import('@/lib/subscription-guard');
const { addCompetitor, deleteCompetitor } = await import('./competitor');
const { addPromptNote } = await import('./prompt-workflow');
const { markGettingStartedPageOpened } = await import('./getting-started');
const { updateAccountName } = await import('./organization');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  org = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
  writes = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('server actions on a read-only workspace', () => {
  it('refuse before writing anything', async () => {
    await expect(addCompetitor('brand-1', { name: 'Acme', domain: 'acme.com' })).rejects.toThrow(
      SubscriptionInactiveError,
    );
    await expect(deleteCompetitor('row-1')).rejects.toThrow(SubscriptionInactiveError);
    await expect(addPromptNote('prompt-1', 'Check the answer')).rejects.toThrow(
      SubscriptionInactiveError,
    );
    expect(writes).toEqual([]);
  });

  it('write once the plan is active', async () => {
    org = { subscription_status: 'active', stripe_subscription_id: 'sub_1' };
    await addCompetitor('brand-1', { name: 'Acme', domain: 'acme.com' });
    await deleteCompetitor('row-1');
    await addPromptNote('prompt-1', 'Check the answer');
    expect(writes).toEqual(['competitors.insert', 'competitors.delete', 'prompt_notes.insert']);
  });

  it("let setup's writes through for an organization that never subscribed, and only those", async () => {
    org = { subscription_status: null, stripe_subscription_id: null };
    await addCompetitor('brand-1', { name: 'Acme', domain: 'acme.com' });
    await expect(deleteCompetitor('row-1')).rejects.toThrow(SubscriptionInactiveError);
    expect(writes).toEqual(['competitors.insert']);
  });

  it("keep the person's own profile and a page-opened trace open", async () => {
    await updateAccountName('Ada');
    await markGettingStartedPageOpened('brand-1', 'visibility');
    expect(writes).toEqual([
      'profiles.update',
      'auth.updateUser',
      'rpc.getting_started_page_opened',
    ]);
  });

  it('never gate self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await addPromptNote('prompt-1', 'Check the answer');
    expect(writes).toEqual(['prompt_notes.insert']);
  });
});
