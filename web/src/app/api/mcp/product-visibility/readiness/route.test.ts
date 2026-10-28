// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/product-visibility/readiness: the REST mirror of get_shopping_readiness. */

const { getShoppingReadinessFor } = vi.hoisted(() => ({ getShoppingReadinessFor: vi.fn() }));
vi.mock('@/lib/mcp-auth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
  })),
}));
// The read is the test's; the plan answer and the parameter checks are the module's own.
const PLAN_LOCKED = vi.hoisted(() => ({
  error: 'plan' as const,
  message: 'Needs Product Visibility.',
}));
vi.mock('@/lib/mcp/product-visibility', () => ({
  getShoppingReadinessFor,
  PLAN_LOCKED,
  PV_PERIODS: ['7d', '30d', '90d', 'all'],
  isPlanLocked: (read: unknown) => read === PLAN_LOCKED,
}));

const { GET } = await import('./route');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/product-visibility/readiness${query}`));

beforeEach(() => {
  getShoppingReadinessFor.mockReset();
});

describe('GET /api/mcp/product-visibility/readiness', () => {
  it("gives the brand's readiness", async () => {
    getShoppingReadinessFor.mockResolvedValue({ market: 'us', score: 70, checks: [] });
    const res = await get('?brand_id=brand-1&period=90d&market=us');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ market: 'us', score: 70, checks: [] });
    expect(getShoppingReadinessFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      period: '90d',
      market: 'us',
    });
  });

  it('asks for a brand, answers 404, 403 without Product Visibility, and 500 on a failed read', async () => {
    expect((await get('')).status).toBe(400);
    getShoppingReadinessFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
    getShoppingReadinessFor.mockResolvedValue(PLAN_LOCKED);
    expect((await get('?brand_id=brand-1')).status).toBe(403);
    getShoppingReadinessFor.mockRejectedValue(new Error('timeout'));
    expect((await get('?brand_id=brand-1')).status).toBe(500);
  });
});
