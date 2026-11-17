// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * Competitor types (00542) in the MCP Server's and Chat's competitor reads:
 * each competitor carries its type as the page names it, and a type filter
 * keeps only that type's. The types are read from the brand's own rows,
 * inner-joined on the key's organization.
 */

type Result = { data: unknown; error: { code?: string; message: string } | null };

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Result>,
  rpcs: {} as Record<string, Result>,
  filters: [] as unknown[][],
  selects: [] as string[],
  /** A database without 00542: a read of competitors.type fails as Postgres does. */
  before00542: false,
}));

vi.mock('@/lib/supabase/admin', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    let columns = '';
    for (const name of ['order', 'limit', 'in']) chain[name] = () => chain;
    chain.select = (c = '*') => ((columns = c), db.selects.push(`${table}: ${c}`), chain);
    chain.eq = (...args: unknown[]) => (db.filters.push([table, ...args]), chain);
    const answer = () =>
      db.before00542 && table === 'competitors' && /\btype\b/.test(columns)
        ? {
            data: null,
            error: { code: '42703', message: 'column competitors.type does not exist' },
          }
        : (db.tables[table] ?? { data: [], error: null });
    chain.maybeSingle = async () => answer();
    chain.single = async () => answer();
    chain.then = (resolve: (r: Result) => void) => resolve(answer());
    return chain;
  };
  const rpc = async (fn: string) => db.rpcs[fn] ?? { data: null, error: null };
  return { supabaseAdmin: { from, rpc } };
});

const { getCompetitorComparisonFor, listCompetitorsFor } = await import('./data');
const { createMcpServer } = await import('./server');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const COMPETITORS = [
  { id: 'c1', name: 'Sky Air', domain: 'sky.example', type: 'Airline' },
  { id: 'c2', name: 'Trips', domain: 'trips.example', type: 'marketplace' },
  { id: 'c3', name: 'Blue Ferry', domain: 'ferry.example', type: null },
];

beforeEach(() => {
  db.tables = {
    brands: { data: { id: 'b1', name: 'Acme' }, error: null },
    competitors: { data: COMPETITORS, error: null },
  };
  db.rpcs = {};
  db.filters = [];
  db.selects = [];
  db.before00542 = false;
});

describe('listCompetitorsFor', () => {
  it('gives each competitor its type as the page names it, null for none', async () => {
    expect(await listCompetitorsFor(auth, 'b1')).toEqual([
      { id: 'c1', name: 'Sky Air', domain: 'sky.example', type: 'Airline', aliases: [] },
      {
        id: 'c2',
        name: 'Trips',
        domain: 'trips.example',
        type: 'Marketplace / aggregator',
        aliases: [],
      },
      { id: 'c3', name: 'Blue Ferry', domain: 'ferry.example', type: null, aliases: [] },
    ]);
    expect(db.filters).toContainEqual(['competitors', 'brand_id', 'b1']);
    expect(db.filters).toContainEqual(['competitors', 'brands.organization_id', 'org-1']);
  });

  it('lists one type when asked: by name or key in any case, or none', async () => {
    const ids = async (type: string) =>
      (await listCompetitorsFor(auth, 'b1', { type }))?.map((c) => c.id);
    expect(await ids('airline')).toEqual(['c1']);
    expect(await ids('MARKETPLACE / aggregator')).toEqual(['c2']);
    expect(await ids('marketplace')).toEqual(['c2']);
    expect(await ids('none')).toEqual(['c3']);
    expect(await ids('Ferry')).toEqual([]);
    expect(await ids('')).toEqual(['c1', 'c2', 'c3']);
  });

  it("reads nothing of a brand that isn't the organization's", async () => {
    db.tables.brands = { data: null, error: null };
    expect(await listCompetitorsFor(auth, 'b9', { type: 'airline' })).toBeNull();
  });

  it('lists every competitor untyped on a database without 00542, still scoped', async () => {
    db.before00542 = true;
    db.tables.competitors = {
      data: COMPETITORS.map(({ id, name, domain }) => ({ id, name, domain })),
      error: null,
    };
    expect(await listCompetitorsFor(auth, 'b1')).toEqual([
      { id: 'c1', name: 'Sky Air', domain: 'sky.example', type: null, aliases: [] },
      { id: 'c2', name: 'Trips', domain: 'trips.example', type: null, aliases: [] },
      { id: 'c3', name: 'Blue Ferry', domain: 'ferry.example', type: null, aliases: [] },
    ]);
    expect(db.selects).toContain('competitors: id, name, domain, brands!inner(organization_id)');
    expect(
      db.filters.filter(([table, column]) => table === 'competitors' && column === 'brand_id'),
    ).toEqual([
      ['competitors', 'brand_id', 'b1'],
      ['competitors', 'brand_id', 'b1'],
    ]);
    expect(
      db.filters.filter(
        ([table, column]) => table === 'competitors' && column === 'brands.organization_id',
      ),
    ).toHaveLength(2);
    // No type yet, so a type filter finds none and "none" finds all.
    expect(await listCompetitorsFor(auth, 'b1', { type: 'airline' })).toEqual([]);
    expect((await listCompetitorsFor(auth, 'b1', { type: 'none' }))?.length).toBe(3);
  });

  it('still throws on any other database error', async () => {
    db.tables.competitors = { data: null, error: { code: '57014', message: 'canceled' } };
    await expect(listCompetitorsFor(auth, 'b1')).rejects.toThrow('canceled');
  });
});

describe('getCompetitorComparisonFor', () => {
  const competitor = (id: string, name: string, mentions: number) => ({
    competitor_id: id,
    name,
    sum_visibility: 100,
    row_count: 10,
    total_mentions: mentions,
    total_citations: 1,
    visible_prompts: 2,
  });

  beforeEach(() => {
    db.rpcs = {
      competitor_aggregates: {
        data: {
          brand_row_count: 10,
          brand_sum_visibility: 400,
          brand_total_mentions: 30,
          brand_total_citations: 4,
          brand_prompt_count: 5,
          brand_visible_prompts: 3,
          by_competitor: [
            competitor('c1', 'Sky Air', 10),
            competitor('c2', 'Trips', 20),
            competitor('c3', 'Blue Ferry', 50),
          ],
        },
        error: null,
      },
      share_of_voice_aggregates: {
        data: { total_brand_mentions: 30, total_competitor_mentions: 80, by_platform: [] },
        error: null,
      },
      ai_visibility_aggregates: { data: { answers: 10, by_competitor: [] }, error: null },
    };
  });

  it('gives each competitor its type, and keeps share of voice over every competitor', async () => {
    const result = await getCompetitorComparisonFor(auth, { brandId: 'b1' });
    expect(result?.competitors.map((c) => [c.competitor_id, c.type])).toEqual([
      ['c1', 'Airline'],
      ['c2', 'Marketplace / aggregator'],
      ['c3', null],
    ]);
    expect(result?.share_of_voice.of_type).toBeUndefined();
    expect(result?.share_of_voice.total_competitor_mentions).toBe(80);
    expect(db.filters).toContainEqual(['competitors', 'brands.organization_id', 'org-1']);
  });

  it("lists one type's competitors, with the brand's share of voice against just them", async () => {
    const result = await getCompetitorComparisonFor(auth, { brandId: 'b1', type: 'Airline' });
    expect(result?.competitors.map((c) => c.competitor_id)).toEqual(['c1']);
    expect(result?.share_of_voice.of_type).toEqual({
      type: 'Airline',
      overall_sov_pct: 75,
      total_brand_mentions: 30,
      total_competitor_mentions: 10,
    });
    // The overall figures still count every competitor.
    expect(result?.share_of_voice.overall_sov_pct).toBe(27.3);

    const untyped = await getCompetitorComparisonFor(auth, { brandId: 'b1', type: 'none' });
    expect(untyped?.competitors.map((c) => c.competitor_id)).toEqual(['c3']);
  });

  it('reads every competitor untyped on a database without 00542', async () => {
    db.before00542 = true;
    const result = await getCompetitorComparisonFor(auth, { brandId: 'b1' });
    expect(result?.competitors.map((c) => [c.competitor_id, c.type])).toEqual([
      ['c1', null],
      ['c2', null],
      ['c3', null],
    ]);
    expect(result?.share_of_voice.total_competitor_mentions).toBe(80);
  });
});

describe("the MCP Server's competitor tools", () => {
  it('take a type filter and say the competitors carry their type', async () => {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    for (const name of [
      'list_competitors',
      'get_competitor_comparison',
      'get_mention_competitors',
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      const properties = tool.inputSchema.properties as Record<string, { description?: string }>;
      expect(properties.type?.description, name).toContain('"none"');
      expect(tool.description, name).toMatch(/type/);
    }
    expect(tools.find((t) => t.name === 'list_competitors')!.description).toContain(
      '"Publisher / review site"',
    );

    const listed = await client.callTool({
      name: 'list_competitors',
      arguments: { brand_id: '11111111-1111-4111-8111-111111111111', type: 'airline' },
    });
    const [content] = listed.content as { text: string }[];
    expect(JSON.parse(content.text)).toEqual([
      { id: 'c1', name: 'Sky Air', domain: 'sky.example', type: 'Airline', aliases: [] },
    ]);
    await client.close();
  });
});
