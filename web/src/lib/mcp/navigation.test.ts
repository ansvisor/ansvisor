// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/** open_page (CHAT-19 §2): a page the plan opens, its filters, and no AI usage. */

const tables = vi.hoisted(() => [] as string[]);
const org = vi.hoisted(() => ({ row: {} as unknown }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      tables.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: org.row, error: null }),
      };
      return chain;
    },
  },
}));

const { openPageFor } = await import('./navigation');

const auth: McpAuthContext = {
  userId: 'u1',
  email: null,
  organizationId: 'org-1',
  role: 'analyst',
  apiKeyId: 'agent-internal',
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  tables.length = 0;
  org.row = { plan: 'growth', subscription_status: 'active', plan_overrides: null };
});
afterEach(() => vi.unstubAllEnvs());

describe('openPageFor', () => {
  it('opens a page with the filters it keeps, reading only the plan: no AI usage', async () => {
    expect(
      await openPageFor(auth, { route: 'insights', range: '30d', platform: 'perplexity-web' }),
    ).toEqual({
      found: true,
      title: 'Brand Visibility',
      section: null,
      locked: false,
      href: '/dashboard/insights?range=30d&model=perplexity-web',
      filters: [
        { key: 'range', value: '30d' },
        { key: 'platform', value: 'perplexity-web' },
      ],
      navigation_only: true,
    });
    expect(tables).toEqual(['organizations']);
  });

  it("leaves out a platform the plan doesn't read, and says so", async () => {
    org.row = { plan: 'starter', subscription_status: 'active', plan_overrides: null };
    expect(
      await openPageFor(auth, { route: 'citations', platform: 'perplexity-web' }),
    ).toMatchObject({
      href: '/dashboard/citations',
      filters: [],
      platform_not_in_plan: 'perplexity-web',
    });
  });

  it("doesn't open a page the plan doesn't include, and names the plan that does", async () => {
    org.row = { plan: 'starter', subscription_status: 'active', plan_overrides: null };
    const shopping = await openPageFor(auth, { route: 'shopping' });
    expect(shopping).toMatchObject({ found: true, locked: true, needs: 'growth' });
    expect(shopping).not.toHaveProperty('href');
  });

  it('says when there is no such page, and reads nothing without an organization', async () => {
    expect(await openPageFor(auth, { route: 'nowhere' })).toEqual({ found: false });
    expect(await openPageFor({ ...auth, organizationId: null }, { route: 'insights' })).toBeNull();
  });
});
