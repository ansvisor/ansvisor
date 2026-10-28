// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/content-plan: the REST mirror of get_content_plan. */

const { getContentPlanFor } = vi.hoisted(() => ({ getContentPlanFor: vi.fn() }));
vi.mock('@/lib/mcp-auth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
  })),
}));
vi.mock('@/lib/mcp/content-plan', () => ({ getContentPlanFor }));

const { GET } = await import('./route');

const get = (query: string) => GET(new Request(`http://localhost/api/mcp/content-plan${query}`));

beforeEach(() => {
  getContentPlanFor.mockReset();
});

describe('GET /api/mcp/content-plan', () => {
  it("answers the brand's plan over the days and card asked", async () => {
    getContentPlanFor.mockResolvedValue({ days: 7, rows: [] });
    const res = await get('?brand_id=brand-1&days=7&card=protect');
    expect(await res.json()).toEqual({ plan: { days: 7, rows: [] } });
    expect(getContentPlanFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      days: 7,
      card: 'protect',
    });
  });

  it('reads 30 days without a period, and refuses one it does not offer', async () => {
    getContentPlanFor.mockResolvedValue({ days: 30, rows: [] });
    await get('?brand_id=brand-1');
    expect(getContentPlanFor.mock.calls[0][1]).toMatchObject({ days: 30 });
    expect((await get('?brand_id=brand-1&days=14')).status).toBe(400);
    expect((await get('?brand_id=brand-1&card=later')).status).toBe(400);
    expect((await get('')).status).toBe(400);
  });

  it("answers 404 for another organization's brand", async () => {
    getContentPlanFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
  });
});
