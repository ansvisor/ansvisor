// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Crawler & Technical Fixer's read (get_crawler_access_issues): listed
 * for every role and plan, it hands the read the run's person and the brand
 * asked for, whose organization the read checks; page addresses are
 * outside text, so the run is tainted after it.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: vi.fn() } }));
const getCrawlerAccessFor = vi.hoisted(() => vi.fn(async () => ({ pages: 0, issues: [] })));
vi.mock('@/lib/mcp/crawler-access', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCrawlerAccessFor,
}));

const { chatTool, listedTools } = await import('./tools');
const { taintsRun } = await import('../untrusted');

const BRAND = '11111111-1111-4111-8111-111111111111';
const ctx = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'agent-internal',
  brandAccess: 'all' as const,
  role: 'analyst' as const,
};

beforeEach(() => getCrawlerAccessFor.mockClear());

describe('get_crawler_access_issues', () => {
  it('is a read for every role and plan, on the brand its input names', () => {
    expect(listedTools().map((tool) => tool.name)).toContain('get_crawler_access_issues');
    expect(chatTool('get_crawler_access_issues')).toMatchObject({
      class: 'read',
      area: 'site_audit',
      minRole: 'analyst',
      planGate: null,
      brandOf: { input: 'brand_id' },
      route: '/dashboard/audit',
      mcpTool: null,
    });
  });

  it("reads the brand's audits as the run's person, the brand checked by the read", async () => {
    const row = chatTool('get_crawler_access_issues')!;
    expect(await row.run(ctx, row.inputSchema.parse({ brand_id: BRAND }))).toEqual({
      pages: 0,
      issues: [],
    });
    expect(getCrawlerAccessFor).toHaveBeenCalledWith(ctx, BRAND);
  });

  it('takes a brand id only', () => {
    const row = chatTool('get_crawler_access_issues')!;
    expect(() => row.inputSchema.parse({ brand_id: 'not-a-uuid' })).toThrow();
    expect(Object.keys(row.inputSchema.shape)).toEqual(['brand_id']);
  });

  it('taints the run: page addresses are outside text', () => {
    expect(taintsRun('get_crawler_access_issues')).toBe(true);
  });
});
