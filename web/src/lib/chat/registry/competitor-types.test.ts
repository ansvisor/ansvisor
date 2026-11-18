// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat's competitor rows and competitor types (00542): the reads that list or
 * compare competitors take a type filter and hand it to the MCP data
 * function they share with the MCP Server; add_competitors takes a type per
 * competitor; the descriptions say so.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
const reads = vi.hoisted(() => ({
  listCompetitorsFor: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  getCompetitorComparisonFor: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
  getMentionCompetitorsFor: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
  addCompetitors: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true })),
}));
vi.mock('@/lib/mcp/data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listCompetitorsFor: reads.listCompetitorsFor,
  getCompetitorComparisonFor: reads.getCompetitorComparisonFor,
}));
vi.mock('@/lib/mcp/mentions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMentionCompetitorsFor: reads.getMentionCompetitorsFor,
}));
vi.mock('@/lib/actions/competitor', () => ({
  addCompetitors: reads.addCompetitors,
  removeBrandCompetitor: vi.fn(),
}));

const { chatTool } = await import('./tools');
const { FIXTURE_IDS } = await import('./define-tool');

const ctx = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'agent-internal',
  brandAccess: 'all' as const,
  role: 'admin' as const,
} as never;
const BRAND = FIXTURE_IDS.brand;

const run = (name: string, input: Record<string, unknown>) => {
  const tool = chatTool(name)!;
  return tool.run(ctx, tool.inputSchema.parse(input));
};

beforeEach(() => vi.clearAllMocks());

describe("Chat's competitor reads and types", () => {
  it('list_competitors hands its type filter on, and none without one', async () => {
    await run('list_competitors', { brand_id: BRAND, type: ' Airline ' });
    expect(reads.listCompetitorsFor).toHaveBeenLastCalledWith(ctx, BRAND, { type: 'Airline' });
    await run('list_competitors', { brand_id: BRAND });
    expect(reads.listCompetitorsFor).toHaveBeenLastCalledWith(ctx, BRAND, { type: undefined });
  });

  it('get_competitor_comparison and get_mention_competitors hand the type on', async () => {
    await run('get_competitor_comparison', { brand_id: BRAND, type: 'none' });
    expect(reads.getCompetitorComparisonFor).toHaveBeenLastCalledWith(
      ctx,
      expect.objectContaining({ brandId: BRAND, type: 'none' }),
    );
    await run('get_mention_competitors', { brand_id: BRAND, type: 'Marketplace / aggregator' });
    expect(reads.getMentionCompetitorsFor).toHaveBeenLastCalledWith(
      ctx,
      expect.objectContaining({ brandId: BRAND }),
      { type: 'Marketplace / aggregator' },
    );
  });

  it('says in each description that competitors carry a type and can be filtered by it', () => {
    for (const name of [
      'list_competitors',
      'get_competitor_comparison',
      'get_mention_competitors',
    ]) {
      const { description } = chatTool(name)!;
      expect(description, name).toMatch(/type/);
      expect(description, name).toMatch(/with type, only/i);
    }
    expect(chatTool('list_competitors')!.description).toContain('"Direct competitor"');
  });

  it("add_competitors takes each competitor's type, up to 40 characters", async () => {
    const add = chatTool('add_competitors')!;
    await run('add_competitors', {
      brand_id: BRAND,
      competitors: [
        { name: 'Sky Air', domain: 'sky.example', type: 'Airline' },
        { name: 'Trips', domain: 'trips.example' },
      ],
    });
    expect(reads.addCompetitors).toHaveBeenCalledWith(BRAND, [
      { name: 'Sky Air', domain: 'sky.example', type: 'Airline' },
      { name: 'Trips', domain: 'trips.example' },
    ]);
    expect(
      add.inputSchema.safeParse({
        brand_id: BRAND,
        competitors: [{ name: 'Sky Air', type: 'x'.repeat(41) }],
      }).success,
    ).toBe(false);
    expect(add.description).toContain('"Marketplace / aggregator"');
  });
});
