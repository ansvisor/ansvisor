// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Shopping Feed Advisor's read (get_catalog_feed_gaps): listed for every
 * role and plan, it hands the catalog read the run's person and the brand
 * asked for, whose organization the read checks, and what it answers is the
 * store's words, so the run is tainted after it.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: vi.fn() } }));
const getCatalogFeedGapsFor = vi.hoisted(() => vi.fn(async () => ({ products: 0, gaps: [] })));
vi.mock('@/lib/mcp/catalog', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCatalogFeedGapsFor,
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

beforeEach(() => getCatalogFeedGapsFor.mockClear());

describe('get_catalog_feed_gaps', () => {
  it('is a read for every role and plan, on the brand its input names', () => {
    expect(listedTools().map((tool) => tool.name)).toContain('get_catalog_feed_gaps');
    expect(chatTool('get_catalog_feed_gaps')).toMatchObject({
      class: 'read',
      area: 'product_visibility',
      minRole: 'analyst',
      planGate: null,
      brandOf: { input: 'brand_id' },
      route: '/dashboard/shopping',
      mcpTool: null,
    });
  });

  it("reads the brand's catalog as the run's person, the brand checked by the read", async () => {
    const row = chatTool('get_catalog_feed_gaps')!;
    expect(await row.run(ctx, row.inputSchema.parse({ brand_id: BRAND }))).toEqual({
      products: 0,
      gaps: [],
    });
    expect(getCatalogFeedGapsFor).toHaveBeenCalledWith(ctx, BRAND);
  });

  it('takes a brand id only, never a product or organization of the model’s', () => {
    const row = chatTool('get_catalog_feed_gaps')!;
    expect(() => row.inputSchema.parse({ brand_id: 'not-a-uuid' })).toThrow();
    expect(Object.keys(row.inputSchema.shape)).toEqual(['brand_id']);
  });

  it("taints the run: product titles and pages are the store's words", () => {
    expect(taintsRun('get_catalog_feed_gaps')).toBe(true);
  });
});
