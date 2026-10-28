// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/product-visibility/ai-says: the REST mirror of get_product_ai_says. */

const { getProductAiSaysFor } = vi.hoisted(() => ({ getProductAiSaysFor: vi.fn() }));
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
  getProductAiSaysFor,
  PLAN_LOCKED,
  PV_PERIODS: ['7d', '30d', '90d', 'all'],
  isPlanLocked: (read: unknown) => read === PLAN_LOCKED,
}));

const { GET } = await import('./route');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/product-visibility/ai-says${query}`));

beforeEach(() => {
  getProductAiSaysFor.mockReset();
});

const PRODUCT = '22222222-2222-2222-2222-222222222222';

describe('GET /api/mcp/product-visibility/ai-says', () => {
  it('gives what AI says about the product', async () => {
    getProductAiSaysFor.mockResolvedValue({ product_id: PRODUCT, answers: 2, quotes: [] });
    const res = await get(`?brand_id=brand-1&product_id=${PRODUCT}&period=all`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ product_id: PRODUCT, answers: 2, quotes: [] });
    expect(getProductAiSaysFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      productId: PRODUCT,
      period: 'all',
    });
  });

  it('asks for a brand and a product UUID, answers 404, 403 and 500', async () => {
    expect((await get('?brand_id=brand-1')).status).toBe(400);
    expect((await get('?brand_id=brand-1&product_id=p1')).status).toBe(400);
    expect(getProductAiSaysFor).not.toHaveBeenCalled();
    getProductAiSaysFor.mockResolvedValue(null);
    const missing = await get(`?brand_id=brand-1&product_id=${PRODUCT}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Brand or product not found' });
    getProductAiSaysFor.mockResolvedValue(PLAN_LOCKED);
    expect((await get(`?brand_id=brand-1&product_id=${PRODUCT}`)).status).toBe(403);
    getProductAiSaysFor.mockRejectedValue(new Error('timeout'));
    expect((await get(`?brand_id=brand-1&product_id=${PRODUCT}`)).status).toBe(500);
  });
});
