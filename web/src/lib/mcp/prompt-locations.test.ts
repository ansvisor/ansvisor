// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * get_prompt_locations (B7): the Locations view's matrix, read as the view
 * reads it (getPromptLocationMatrix) under the service role once the brand
 * is the key's, with its averages and cards, paged by prompt.
 */

const brandInOrg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mcp/data', () => ({ brandInOrg }));

const getPromptLocationMatrix = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/prompt', () => ({ getPromptLocationMatrix }));

const scoped = vi.hoisted(() => ({ clients: [] as unknown[] }));
vi.mock('@/lib/supabase/scoped', () => ({
  withDbClient: (client: unknown, fn: () => unknown) => (scoped.clients.push(client), fn()),
}));

let promptRows: Record<string, unknown>[] = [];
const adminClient = vi.hoisted(() => ({ marker: 'service role' }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: Object.assign(adminClient, {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async (start: number, end: number) => ({
          data: promptRows.slice(start, end + 1),
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

const { getPromptLocationsFor } = await import('./prompt-locations');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
};

const cell = (score: number | null, over: Record<string, unknown> = {}) => ({
  score,
  mentions: 3,
  citations: 1,
  position: 2,
  runs: 6,
  ...over,
});

beforeEach(() => {
  brandInOrg.mockReset().mockResolvedValue(true);
  scoped.clients.length = 0;
  promptRows = [
    { id: 'p1', text: 'Best cold brew', regions: ['US', 'DE'], is_active: true },
    { id: 'p2', text: 'Cold brew ratio', regions: ['US'], is_active: false },
  ];
  getPromptLocationMatrix.mockReset().mockResolvedValue({
    p1: { US: cell(60), DE: cell(20) },
    p2: { US: cell(40) },
  });
});

describe('getPromptLocationsFor', () => {
  it('reads the view’s matrix under the service role, the most tracked location first', async () => {
    const view = (await getPromptLocationsFor(auth, { brandId: 'brand-1' }))!;
    expect(scoped.clients).toEqual([adminClient]);
    expect(getPromptLocationMatrix).toHaveBeenCalledWith('brand-1', {
      days: 30,
      from: undefined,
      to: undefined,
      regions: ['US', 'DE'],
    });
    expect(view.locations).toEqual([
      { code: 'US', name: 'United States' },
      { code: 'DE', name: 'Germany' },
    ]);
    expect(view.averages.visibility).toEqual([50, 20]);
    expect(view.insights).toMatchObject({
      weakest: { region: 'DE', average: 20, untracked: 1 },
      strongest: { region: 'US', average: 50 },
      widest: { promptId: 'p1', low: 20, lowAt: 'DE', high: 60, highAt: 'US' },
    });
    expect(view.prompts).toEqual([
      {
        id: 'p1',
        text: 'Best cold brew',
        is_active: true,
        tracked_in: ['US', 'DE'],
        cells: {
          US: { visibility: 60, mentions: 3, citations: 1, position: 2, runs: 6 },
          DE: { visibility: 20, mentions: 3, citations: 1, position: 2, runs: 6 },
        },
        visibility_gap: 40,
      },
      {
        id: 'p2',
        text: 'Cold brew ratio',
        is_active: false,
        tracked_in: ['US'],
        cells: { US: { visibility: 40, mentions: 3, citations: 1, position: 2, runs: 6 } },
        visibility_gap: null,
      },
    ]);
    expect(view.total).toBe(2);
    expect(view.next_offset).toBeNull();
  });

  it('compares the locations asked, valid ones only, at most twelve', async () => {
    await getPromptLocationsFor(auth, {
      brandId: 'brand-1',
      locations: ['US-CA', 'nowhere', 'US-CA', 'TR'],
      days: 7,
    });
    expect(getPromptLocationMatrix.mock.calls[0][1]).toMatchObject({
      days: 7,
      regions: ['US-CA', 'TR'],
    });
  });

  it('pages the prompts, every location’s averages still over all of them', async () => {
    const view = (await getPromptLocationsFor(auth, { brandId: 'brand-1', limit: 1 }))!;
    expect(view.prompts.map((p) => p.id)).toEqual(['p1']);
    expect(view.next_offset).toBe(1);
    expect(view.averages.visibility).toEqual([50, 20]);
  });

  it("answers null for another organization's brand, without reading it", async () => {
    brandInOrg.mockResolvedValue(false);
    expect(await getPromptLocationsFor(auth, { brandId: 'brand-2' })).toBeNull();
    expect(getPromptLocationMatrix).not.toHaveBeenCalled();
  });
});
