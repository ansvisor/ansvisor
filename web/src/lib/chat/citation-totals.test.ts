// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * Citations as its page shows them (the owner's decision, 2026-11-16): the
 * lists follow the page's Sources, as its table does, and the citations and
 * their average per answer count every source, as its cards do. One
 * fixture, read the way Chat reads it (one citations read, filtered, that
 * counts every source in the same scan) and the way the page reads it
 * (getCitationsOverview, from the database's aggregates of the same answers).
 */

const BRAND = '11111111-1111-4111-8111-111111111111';
const OWN = 'brewline.example';
const RIVAL = 'northbound.example';

/** The window's answers: three cite, one doesn't; the brand's own pages, a rival's, the press. */
const ANSWERS = [
  {
    id: 'r1',
    platform: 'chatgpt-web',
    model_used: 'chatgpt-web',
    citations: [
      { url: `https://${OWN}/subscriptions`, title: 'Subscriptions' },
      { url: `https://${RIVAL}/guide`, title: 'Guide' },
      { url: 'https://beanbulletin.example/best', title: 'Best' },
    ],
  },
  {
    id: 'r2',
    platform: 'chatgpt-web',
    model_used: 'chatgpt-web',
    citations: [
      { url: `https://www.${OWN}/subscriptions`, title: 'Subscriptions' },
      { url: `https://${OWN}/blog/fresh`, title: 'Fresh' },
    ],
  },
  {
    id: 'r3',
    platform: 'chatgpt-web',
    model_used: 'chatgpt-web',
    citations: [{ url: 'https://beanbulletin.example/pour-over', title: 'Pour over' }],
  },
  { id: 'r4', platform: 'chatgpt-web', model_used: 'chatgpt-web', citations: [] },
];

/** A chain that answers a table's rows, whatever it is filtered by. */
function table(rows: unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'order', 'limit', 'not']) {
    chain[name] = () => chain;
  }
  // A page of the rows (the citations scan reads its answers a page at a time).
  chain.range = (from: number, to: number) =>
    table(Array.isArray(rows) ? rows.slice(from, to + 1) : rows);
  chain.maybeSingle = async () => ({ data: Array.isArray(rows) ? rows[0] : rows, error: null });
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
  return chain;
}

const TABLES: Record<string, unknown> = {
  brands: { id: BRAND },
  brand_domains: [{ domain: OWN }],
  competitors: [{ domain: RIVAL }],
  prompt_results: ANSWERS,
};

/** What the database's aggregates (citations_domains_daily, its window stats) say of them. */
function pageRpc(fn: string) {
  if (fn === 'citations_window_stats_daily') {
    return { data: [{ results: ANSWERS.length, regions: [] }], error: null };
  }
  if (fn === 'citations_domains_daily') {
    const domains = new Map<string, { total: number; results: Set<string> }>();
    for (const answer of ANSWERS) {
      for (const cite of answer.citations) {
        const domain = new URL(cite.url).hostname.replace(/^www\./, '');
        const row = domains.get(domain) ?? { total: 0, results: new Set<string>() };
        row.total += 1;
        row.results.add(answer.id);
        domains.set(domain, row);
      }
    }
    return {
      data: [...domains].map(([domain, row]) => ({
        domain,
        total_citations: row.total,
        results_citing: row.results.size,
        models: ['chatgpt-web'],
      })),
      error: null,
    };
  }
  return { data: [], error: null };
}

/** The tables the service role read, one entry a query: how many scans a read took. */
const scans = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (name: string) => {
      scans.push(name);
      return table(TABLES[name] ?? []);
    },
    // The page's daily functions read their rollups by brand: the service role runs them too.
    rpc: async (fn: string) => pageRpc(fn),
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (name: string) => table(TABLES[name] ?? []),
    rpc: async (fn: string) => pageRpc(fn),
  }),
}));

const { needsAllSources } = await import('./citation-totals');
const { CHAT_TOOLS } = await import('./registry/tools');
const { getCitationsOverview } = await import('@/lib/actions/citations');

const AUTH: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'analyst',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};

describe('when a citations read needs the totals of every source', () => {
  it('only when it took Sources from the page, and they narrow it', () => {
    const page = { page: ['period', 'sources'] };
    expect(needsAllSources('list_citations', { source_filter: 'owned' }, page)).toBe(true);
    // The person's own Sources: their totals are what they asked for.
    expect(needsAllSources('list_citations', { source_filter: 'owned' }, {})).toBe(false);
    expect(needsAllSources('list_citations', { source_filter: 'all' }, page)).toBe(false);
    expect(needsAllSources('list_mentions', { source_filter: 'owned' }, page)).toBe(false);
  });
});

describe("Chat's citations and the Citations page, on one fixture", () => {
  const tool = CHAT_TOOLS.find((t) => t.name === 'list_citations')!;
  const input = {
    brand_id: BRAND,
    date_from: '2026-10-24',
    date_to: '2026-10-30',
    source_filter: 'owned' as const,
    limit: 50,
  };
  type Read = {
    totals: { domains: number; citations: number };
    top_domains: { domain: string; category: string; total_citations: number }[];
    all_sources_totals?: { citations: number; avg_citations_per_result: number };
  };

  it('lists the Brand rows of the table, and counts every source as the cards do, in one read and one scan', async () => {
    scans.length = 0;
    // Sources from the page: the engine asks the read for the cards' totals too.
    const chat = (await tool.run(
      { ...AUTH, allSourcesTotals: true } as never,
      input as never,
    )) as Read;
    // One read, one scan of the window's answers: the totals come from the pass that built the lists.
    expect(scans.filter((name) => name === 'prompt_results')).toHaveLength(1);

    const page = await getCitationsOverview(BRAND, {
      datePreset: 'custom',
      dateFrom: '2026-10-24',
      dateTo: '2026-10-30',
      sourceScope: 'own',
    });
    const table = page.rows.filter((row) => row.category === 'you');

    // The lists: the table's rows on Brand.
    expect(chat.top_domains.map((d) => [d.domain, d.total_citations])).toEqual(
      table.map((row) => [row.domain, row.totalCitations]),
    );
    expect(chat.top_domains.every((d) => d.category === 'you')).toBe(true);
    // Unique Domains on the card counts the table's rows.
    expect(chat.totals.domains).toBe(table.length);
    // Total Citations and the average per answer: every source, as the cards.
    expect(chat.all_sources_totals).toEqual({
      citations: page.totals.citations,
      avg_citations_per_result: page.totals.avgCitationsPerResult,
    });
    expect(chat.all_sources_totals).toEqual({ citations: 6, avg_citations_per_result: 1.5 });
    // The filtered totals alone would have said 3.
    expect(chat.totals.citations).toBe(3);
  });

  it('adds no totals of every source when nobody asked, or when the read is over every source', async () => {
    // Sources the person named (or the MCP tool): the read's own totals, as before.
    const own = (await tool.run(AUTH as never, input as never)) as Read;
    expect(own).not.toHaveProperty('all_sources_totals');
    expect(own.totals.citations).toBe(3);
    // Over every source its own totals are the cards'.
    const every = (await tool.run(
      { ...AUTH, allSourcesTotals: true } as never,
      {
        ...input,
        source_filter: 'all',
      } as never,
    )) as Read;
    expect(every).not.toHaveProperty('all_sources_totals');
    expect(every.totals.citations).toBe(6);
  });
});
