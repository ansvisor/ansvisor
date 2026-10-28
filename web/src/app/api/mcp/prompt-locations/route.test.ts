// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/prompt-locations: the REST mirror of get_prompt_locations. */

const { getPromptLocationsFor } = vi.hoisted(() => ({ getPromptLocationsFor: vi.fn() }));
vi.mock('@/lib/mcp-auth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
  })),
}));
vi.mock('@/lib/mcp/prompt-locations', () => ({ getPromptLocationsFor }));

const { GET } = await import('./route');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/prompt-locations${query}`));

beforeEach(() => {
  getPromptLocationsFor.mockReset();
});

describe('GET /api/mcp/prompt-locations', () => {
  it('compares the locations listed, over the window asked', async () => {
    getPromptLocationsFor.mockResolvedValue({ locations: [], prompts: [] });
    const res = await get('?brand_id=brand-1&locations=US-CA,TR&days=7&limit=20');
    expect(res.status).toBe(200);
    expect(getPromptLocationsFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      locations: ['US-CA', 'TR'],
      days: 7,
      from: undefined,
      to: undefined,
      limit: 20,
      offset: undefined,
    });
  });

  it('refuses a window it does not offer, and answers 404 for another brand', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?brand_id=brand-1&days=14')).status).toBe(400);
    expect((await get('?brand_id=brand-1&date_from=soon')).status).toBe(400);
    getPromptLocationsFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
  });
});
