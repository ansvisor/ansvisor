import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the pages AI answers cite have (learning C1): which pages are read,
 * what Site Audit's checks find on them, what the brand's page lacks, and
 * the daily cap on reads.
 */

let tables;
let writes;
let todayReads;

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const op = { table, head: false };
      const chain = {
        select: (_cols, opts) => ((op.head = opts?.head ?? false), chain),
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        upsert: async (row) => (writes.push(row), { error: null }),
        then: (resolve) =>
          resolve(
            op.head
              ? { count: todayReads, error: null }
              : { data: tables[table] ?? [], error: null },
          ),
      };
      return chain;
    },
  },
}));

const {
  FEATURE_CHECKS,
  ReadLaterError,
  analyzeCompetitorPages,
  citedPages,
  featureGaps,
  pageFeatures,
} = await import('./competitor-pages.js');
const { signalRegistry } = await import('../audit/signals/index.js');

const NOW = new Date('2026-10-28T03:00:00Z');

const FAQ_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question' }, { '@type': 'Question' }],
})}</script></head><body><h1>Best kettles</h1><h2>Which kettle?</h2><p>Text.</p>
<table><thead><tr><th>Kettle</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table></body></html>`;
const PLAIN_PAGE = '<html><body><h1>Kettles</h1><p>Some text about kettles.</p></body></html>';

beforeEach(() => {
  writes = [];
  todayReads = 0;
  tables = {
    prompt_results: [
      {
        mention_count: 0,
        citations: [
          { url: 'https://rival.com/kettles' },
          { url: 'https://rival.com/kettles' },
          { url: 'https://blog.example/best' },
          { url: 'https://acme.com/kettles' },
        ],
      },
      {
        mention_count: 2,
        citations: [{ url: 'https://rival.com/kettles' }, { url: 'https://news.example/x' }],
      },
    ],
    brand_domains: [{ domain: 'acme.com' }],
    competitors: [{ domain: 'www.rival.com' }],
    cited_page_features: [],
  };
});

describe('FEATURE_CHECKS', () => {
  it("are Site Audit checks, none of them reading the site's robots.txt or llms.txt", () => {
    const keys = new Set(signalRegistry.map((signal) => signal.key));
    expect(FEATURE_CHECKS.filter((key) => !keys.has(key))).toEqual([]);
    expect(FEATURE_CHECKS).not.toContain('ai-bot-access');
    expect(FEATURE_CHECKS).not.toContain('llms-txt-presence');
  });
});

describe('pageFeatures', () => {
  it("runs Site Audit's checks over a page read here", async () => {
    const { words, checks } = await pageFeatures('https://rival.com/kettles', FAQ_PAGE);
    expect(words).toBeGreaterThan(0);
    expect(checks['faq-schema']).toBe('pass');
    expect(checks.tables).toBe('pass');
    expect(Object.keys(checks).sort()).toEqual([...FEATURE_CHECKS].sort());
  });
});

describe('citedPages', () => {
  it("takes the competitors' pages first, then pages cited where the brand isn't named, and the brand's own", () => {
    const { competitors, yours } = citedPages(tables.prompt_results, {
      ownDomains: ['acme.com'],
      competitorDomains: ['www.rival.com'],
    });
    // A page cited twice in one answer counts once; news.example was cited
    // in an answer that names the brand, so it isn't a page it loses to.
    expect(competitors.map((page) => [page.url, page.count])).toEqual([
      ['https://rival.com/kettles', 2],
      ['https://blog.example/best', 1],
    ]);
    expect(yours).toMatchObject({ url: 'https://acme.com/kettles', count: 1 });
  });

  it('reads at most a few pages an action', () => {
    expect(
      citedPages(tables.prompt_results, {
        ownDomains: [],
        competitorDomains: ['rival.com'],
        perAction: 1,
      }).competitors,
    ).toHaveLength(1);
  });
});

describe('featureGaps', () => {
  const page = (passing) => ({
    checks: Object.fromEntries(
      FEATURE_CHECKS.map((key) => [key, passing.includes(key) ? 'pass' : 'fail']),
    ),
  });

  it("names the checks half the competitor pages pass that the brand's page doesn't", () => {
    const gaps = featureGaps(
      [page(['faq-schema', 'tables']), page(['faq-schema']), page(['lists'])],
      page(['tables']),
    );
    expect(gaps.map((gap) => [gap.key, gap.competitors, gap.of])).toEqual([['faq-schema', 2, 3]]);
    expect(gaps[0].label).toEqual(expect.any(String));
  });

  it('names every check most competitor pages pass when no page of the brand was cited', () => {
    expect(featureGaps([page(['tables'])], null).map((gap) => gap.key)).toEqual(['tables']);
    expect(featureGaps([], null)).toEqual([]);
  });
});

describe('analyzeCompetitorPages', () => {
  const payload = { promptIds: ['p1'] };
  const read = vi.fn(async (url) => ({
    url,
    html: url.startsWith('https://acme.com') ? PLAIN_PAGE : FAQ_PAGE,
  }));

  beforeEach(() => {
    read.mockClear();
  });

  it("reads the cited pages, keeps their features only, and says what the brand's page lacks", async () => {
    const result = await analyzeCompetitorPages({ brandId: 'b1', payload, now: NOW, read });

    expect(read.mock.calls.map(([url]) => url)).toEqual([
      'https://rival.com/kettles',
      'https://blog.example/best',
      'https://acme.com/kettles',
    ]);
    expect(writes.map((row) => [row.page_key, row.own])).toEqual([
      ['rival.com/kettles', false],
      ['blog.example/best', false],
      ['acme.com/kettles', true],
    ]);
    // Features, never the page's text.
    expect(JSON.stringify(writes)).not.toContain('Which kettle?');
    expect(result.competitorPages.map((page) => page.url)).toEqual([
      'https://rival.com/kettles',
      'https://blog.example/best',
    ]);
    expect(result.competitorPages[0].passes).toContain('faq-schema');
    expect(result.yourPage.passes).not.toContain('faq-schema');
    expect(result.gaps.map((gap) => gap.key)).toEqual(expect.arrayContaining(['faq-schema']));
    expect(result).toMatchObject({ capped: 0, unreadable: 0 });
  });

  it('reuses a page read lately rather than reading it again', async () => {
    tables.cited_page_features = [
      {
        page_key: 'rival.com/kettles',
        read_at: '2026-10-20T00:00:00Z',
        features: { words: 900, checks: { 'faq-schema': 'pass' } },
      },
    ];
    const result = await analyzeCompetitorPages({ brandId: 'b1', payload, now: NOW, read });
    expect(read.mock.calls.map(([url]) => url)).not.toContain('https://rival.com/kettles');
    expect(result.competitorPages[0]).toMatchObject({ words: 900, passes: ['faq-schema'] });
  });

  it("stops at the brand's reads for the day, and waits for tomorrow when it read none", async () => {
    todayReads = 11;
    const capped = await analyzeCompetitorPages({ brandId: 'b1', payload, now: NOW, read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(capped.capped).toBe(2);

    todayReads = 12;
    await expect(
      analyzeCompetitorPages({ brandId: 'b1', payload, now: NOW, read }),
    ).rejects.toBeInstanceOf(ReadLaterError);
  });

  it('counts a page it could not read, and says when nothing was cited', async () => {
    const failing = vi.fn(async () => {
      throw new Error('blocked');
    });
    const result = await analyzeCompetitorPages({
      brandId: 'b1',
      payload,
      now: NOW,
      read: failing,
    });
    expect(result).toMatchObject({ competitorPages: [], unreadable: 3, reason: 'unreadable' });

    tables.prompt_results = [];
    expect(await analyzeCompetitorPages({ brandId: 'b1', payload, now: NOW, read })).toMatchObject({
      reason: 'none_cited',
    });
    expect(
      await analyzeCompetitorPages({ brandId: 'b1', payload: {}, now: NOW, read }),
    ).toMatchObject({ reason: 'no_prompts' });
  });
});
