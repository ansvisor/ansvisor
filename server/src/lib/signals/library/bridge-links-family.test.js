import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bridge links family (AC plan P-10, spec §8): the AI Traffic pages
 * list and the site's pages read, the pairs chosen (bridge-links.js), and
 * one signal written with them.
 */

const db = vi.hoisted(() => ({ rpc: vi.fn(), sitePages: [], calls: [] }));

vi.mock('../../../config/supabase.js', () => ({
  default: {
    rpc: (...args) => db.rpc(...args),
    from: (table) => {
      const chain = {
        select: (columns) => (db.calls.push({ table, columns }), chain),
        eq: () => chain,
        order: () => chain,
        range: async () => ({ data: db.sitePages, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { LIBRARY_FAMILIES } = await import('./detect.js');

const NOW = new Date('2026-11-07T05:00:00Z');
const family = LIBRARY_FAMILIES.find((f) => f.name === 'bridgeLinks');
const run = () => family.run({ brandId: 'b1', now: NOW });

beforeEach(() => {
  db.calls = [];
  db.sitePages = [
    { url: 'https://acme.example/blog/cold-brew', title: 'Cold brew guide | Acme', h1: null },
    { url: 'https://acme.example/products/cold-brew-maker', title: 'Cold brew maker | Acme' },
  ];
  db.rpc.mockReset().mockResolvedValue({
    data: {
      rows: [
        { page: '/blog/cold-brew', ai_visits: 60, citations: 4, sessions: 200, key_events: 0 },
        { page: '/products/cold-brew-maker', ai_visits: 2, sessions: 40, transactions: 3 },
      ],
    },
    error: null,
  });
});

describe('the bridge links family', () => {
  it('needs AI traffic and Analytics', () => {
    expect(family.requires).toEqual(['ai_traffic', 'analytics']);
    expect(family.kinds).toEqual(['bridge_link_gap']);
  });

  it('reads every page of the AI Traffic list over its window, and the site’s pages', async () => {
    await run();
    expect(db.rpc).toHaveBeenCalledWith('ai_traffic_pages', {
      p_brand_id: 'b1',
      p_from: '2026-10-10T00:00:00.000Z',
      p_to: NOW.toISOString(),
      p_tab: 'all',
      p_limit: 1000,
      p_offset: 0,
    });
    expect(db.calls).toContainEqual({ table: 'site_pages', columns: 'url, title, h1, lastmod' });
  });

  it('writes one signal with the pairs, its source page as each target', async () => {
    const [found, ...rest] = await run();
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      kind: 'bridge_link_gap',
      dedupKey: 'bridge_link_gap',
      source: ['ga4'],
      currentValue: 1,
      payload: {
        entity: 'pages',
        siteKeyRate: 0,
        targets: [
          {
            id: 'https://acme.example/blog/cold-brew',
            label: 'https://acme.example/blog/cold-brew',
            to: 'https://acme.example/products/cold-brew-maker',
            anchor: 'Cold brew maker',
            reason: 'sells',
            aiVisits: 60,
            citations: 4,
          },
        ],
      },
    });
  });

  it('writes nothing without a pair', async () => {
    db.sitePages = db.sitePages.slice(0, 1);
    expect(await run()).toEqual([]);
  });
});
