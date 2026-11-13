import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sources family: cited domains as ae_citation_sources counts them,
 * sorted by who wins them (classify.js), never a tracked competitor's own
 * site, its subdomains (a blog) included.
 */

const db = vi.hoisted(() => ({ rpc: vi.fn(), competitors: [], rules: null, own: [], calls: [] }));

vi.mock('../../../config/supabase.js', () => ({
  default: {
    rpc: (...args) => db.rpc(...args),
    from: (table) => {
      const chain = {
        select: (columns) => (db.calls.push({ table, columns }), chain),
        eq: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: { content_rules: db.rules }, error: null }),
        range: async () => ({
          data: table === 'brand_domains' ? db.own : db.competitors,
          error: null,
        }),
      };
      return chain;
    },
  },
}));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { LIBRARY_FAMILIES } = await import('./detect.js');

const NOW = new Date('2026-11-07T05:00:00Z');
const family = LIBRARY_FAMILIES.find((f) => f.name === 'sources');
const run = () => family.run({ brandId: 'b1', now: NOW });
const cited = (domain) => ({
  domain,
  owned: false,
  results: 50,
  prompts: 5,
  with_brand: 0,
  competitor_only: 40,
});

beforeEach(() => {
  db.calls = [];
  db.rules = null;
  db.own = [];
  db.competitors = [{ domain: 'https://www.Rival-Travel.example/' }, { domain: null }];
  db.rpc.mockReset().mockResolvedValue({
    data: [
      cited('rival-travel.example'),
      cited('blog.rival-travel.example'),
      cited('guidebook.example'),
    ],
    error: null,
  });
});

describe('the sources family', () => {
  it('reads the brand’s competitors with the cited domains', async () => {
    await run();
    expect(db.calls).toContainEqual({ table: 'competitors', columns: 'domain' });
  });

  it('suggests no tracked competitor’s own site, nor its blog, as a source', async () => {
    const found = await run();
    expect(found.map((x) => x.payload.domain)).toEqual(['guidebook.example']);
    expect(JSON.stringify(found)).not.toContain('rival-travel');
  });

  it('drops a blocked domain, its subdomains too', async () => {
    db.rules = { blockedDomains: ['guidebook.example'] };
    db.rpc.mockResolvedValue({
      data: [cited('guidebook.example'), cited('blog.guidebook.example'), cited('other.example')],
      error: null,
    });
    const found = await run();
    expect(found.map((f) => f.payload.domain)).toEqual(['other.example']);
  });

  it('with only-allowed on, keeps the allowed domains and the brand’s own', async () => {
    db.rules = { allowedDomains: ['guidebook.example'], onlyAllowedDomains: true };
    db.own = [{ domain: 'acme.example' }];
    db.rpc.mockResolvedValue({
      data: [cited('guidebook.example'), cited('acme.example'), cited('other.example')],
      error: null,
    });
    const found = await run();
    expect(found.map((f) => f.payload.domain).sort()).toEqual([
      'acme.example',
      'guidebook.example',
    ]);
  });
});
