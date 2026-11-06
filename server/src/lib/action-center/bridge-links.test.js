import { describe, expect, it } from 'vitest';
import { resolve } from '../../config/action-engine.js';
import { anchorFor, chooseBridgeLinks, pathKey, salesPageType } from './bridge-links.js';
import bridgeLinks from './definitions/g20-bridge-links.js';

/**
 * Bridge links (AC plan P-10, spec §8): pages AI sends readers to that
 * rarely convert, each paired with a page that converts, by the words of
 * their titles.
 */

const { library: t } = resolve();
const NOW = new Date('2026-11-07T00:00:00Z');
const SITE = 'https://www.acme.example';

/** An AI Traffic pages row (ai_traffic_pages, 'all'). */
const row = (page, over = {}) => ({
  page,
  ai_visits: 0,
  citations: 0,
  sessions: 0,
  key_events: 0,
  transactions: 0,
  revenue: 0,
  ...over,
});
const sitePage = (path, title, over = {}) => ({
  url: `${SITE}${path}`,
  title: `${title} | Acme`,
  h1: title,
  lastmod: null,
  ...over,
});

/** A site whose titles all carry its name, and its key-event rate at 2%. */
function site({ pages = [], sitePages = [] } = {}) {
  const filler = Array.from({ length: 6 }, (_, i) => `/about/team-${i}`);
  return {
    pages: [...pages, ...filler.map((p) => row(p, { sessions: 500, key_events: 10 }))],
    sitePages: [...sitePages, ...filler.map((p, i) => sitePage(p, `Team member ${i}`))],
    now: NOW,
  };
}

describe('pages and their kinds', () => {
  it('keys a page as the AI Traffic list does: its path, lower case, no slash, query or fragment', () => {
    expect(pathKey('https://www.Acme.example/Blog/Cold-Brew/?utm=x#top')).toBe('/blog/cold-brew');
    expect(pathKey('/guides/espresso%20beans/')).toBe('/guides/espresso beans');
    expect(pathKey('https://acme.example')).toBe('/');
  });

  it('reads a sales page from its address', () => {
    expect(salesPageType('/pricing')).toBe('pricing');
    expect(salesPageType('https://acme.example/en/book-a-demo/')).toBe('demo');
    expect(salesPageType('/collections/grinders')).toBe('category');
    expect(salesPageType('/products/burr-grinder')).toBe('product');
    expect(salesPageType('/features/reports')).toBe('feature');
    expect(salesPageType('/blog/pricing-a-coffee-shop')).toBeNull();
  });

  it('suggests the heading as the anchor, else the title without the site’s name', () => {
    expect(anchorFor({ title: 'Burr grinders | Acme', h1: 'Burr grinders' })).toBe('Burr grinders');
    expect(anchorFor({ title: 'Burr grinders – Acme Coffee', h1: '' })).toBe('Burr grinders');
    const long = 'The complete guide to choosing a burr grinder for every brewing method you use';
    expect(anchorFor({ title: long, h1: null }).length).toBeLessThanOrEqual(70);
    expect(anchorFor({ title: long, h1: null })).toMatch(/^The complete guide.*\w$/);
  });
});

describe('chooseBridgeLinks', () => {
  it('pairs a cited guide that rarely converts with the selling page it shares words with', () => {
    const { pairs, siteKeyRate } = chooseBridgeLinks(
      site({
        pages: [
          row('/blog/cold-brew-guide', { ai_visits: 120, citations: 30, sessions: 400 }),
          row('/products/cold-brew-maker', {
            ai_visits: 2,
            sessions: 80,
            transactions: 6,
            revenue: 540,
          }),
          row('/products/espresso-machine', { ai_visits: 1, sessions: 90, transactions: 9 }),
        ],
        sitePages: [
          sitePage('/blog/cold-brew-guide', 'How to make cold brew at home'),
          sitePage('/products/cold-brew-maker', 'Cold brew maker'),
          sitePage('/products/espresso-machine', 'Espresso machine'),
        ],
      }),
      t,
    );
    expect(siteKeyRate).toBeCloseTo(60 / 3570, 5);
    expect(pairs).toEqual([
      {
        from: `${SITE}/blog/cold-brew-guide`,
        to: `${SITE}/products/cold-brew-maker`,
        anchor: 'Cold brew maker',
        reason: 'sells',
        salesPage: 'product',
        shared: ['cold', 'brew'],
        aiVisits: 120,
        citations: 30,
        toSessions: 80,
        toKeyEvents: 0,
        toTransactions: 6,
      },
    ]);
  });

  it('takes a page converting well above the site, a sales page, or a new one as a target', () => {
    const { pairs } = chooseBridgeLinks(
      site({
        pages: [
          row('/blog/crm-reporting', { ai_visits: 50, sessions: 300, key_events: 1 }),
          row('/solutions/reporting-dashboards', { ai_visits: 3, sessions: 40, key_events: 4 }),
          row('/blog/what-is-a-crm', { citations: 25, sessions: 200 }),
          row('/pricing', { ai_visits: 4, sessions: 10 }),
          row('/guides/crm-migration', { ai_visits: 15, sessions: 60 }),
          row('/blog/crm-migration-checklist'),
        ],
        sitePages: [
          sitePage('/blog/crm-reporting', 'CRM reporting explained'),
          // Converts at 10%, five times the site's 2%.
          sitePage('/solutions/reporting-dashboards', 'Reporting dashboards'),
          sitePage('/blog/what-is-a-crm', 'What is a CRM, and its pricing'),
          sitePage('/pricing', 'Pricing'),
          sitePage('/guides/crm-migration', 'CRM migration guide'),
          sitePage('/blog/crm-migration-checklist', 'CRM migration checklist', {
            lastmod: '2026-10-20T00:00:00Z',
          }),
        ],
      }),
      t,
    );
    expect(pairs.map((p) => [pathKey(p.from), pathKey(p.to), p.reason])).toEqual([
      ['/blog/crm-reporting', '/solutions/reporting-dashboards', 'converts'],
      ['/blog/what-is-a-crm', '/pricing', 'sales_page'],
      ['/guides/crm-migration', '/blog/crm-migration-checklist', 'new_page'],
    ]);
  });

  it('leaves out a source that converts or sells, words the whole site shares, and targets AI already favours', () => {
    const { pairs } = chooseBridgeLinks(
      site({
        pages: [
          // Converts at 5%, above half the site's rate: not a source.
          row('/blog/grinder-guide', { ai_visits: 80, sessions: 200, key_events: 10 }),
          // Few AI visits and citations: not a source.
          row('/blog/grinder-care', { ai_visits: 3, citations: 2, sessions: 50 }),
          // Shares only the site's name ("Acme") with the product.
          row('/blog/company-story', { ai_visits: 40, sessions: 200 }),
          // A target AI sends more readers to than its source.
          row('/blog/burr-basics', { ai_visits: 20, sessions: 100 }),
          row('/products/burr-grinder', { ai_visits: 90, sessions: 100, transactions: 4 }),
        ],
        sitePages: [
          sitePage('/blog/grinder-guide', 'Grinder guide'),
          sitePage('/blog/grinder-care', 'Grinder care'),
          sitePage('/blog/company-story', 'The Acme story', { h1: 'The Acme story' }),
          sitePage('/blog/burr-basics', 'Burr basics'),
          sitePage('/products/burr-grinder', 'Burr grinder by Acme'),
        ],
      }),
      t,
    );
    expect(pairs).toEqual([]);
  });

  it('keeps five pairs at most, each target linked from two sources at most', () => {
    const guides = [
      ['/blog/tip-0', 'Grinder tip zero'],
      ['/blog/tip-1', 'Grinder tip one'],
      // Its grinder is linked twice already: the kettle it names too.
      ['/blog/tip-2', 'Grinder and kettle tip two'],
      ['/blog/tip-3', 'Kettle tip three'],
      ['/blog/tip-4', 'Scale tip four'],
      ['/blog/tip-5', 'Scale tip five'],
      ['/blog/tip-6', 'Scale tip six'],
    ];
    const { pairs } = chooseBridgeLinks(
      site({
        pages: [
          ...guides.map(([p], i) => row(p, { ai_visits: 100 - i, sessions: 100 })),
          row('/products/grinder', { ai_visits: 1, transactions: 3, sessions: 30 }),
          row('/products/kettle', { ai_visits: 1, transactions: 1, sessions: 30 }),
          row('/collections/scales', { ai_visits: 1, sessions: 30 }),
        ],
        sitePages: [
          ...guides.map(([p, title]) => sitePage(p, title)),
          sitePage('/products/grinder', 'Grinder'),
          sitePage('/products/kettle', 'Kettle'),
          sitePage('/collections/scales', 'Scale'),
        ],
      }),
      t,
    );
    expect(pairs.map((p) => [pathKey(p.from), pathKey(p.to)])).toEqual([
      ['/blog/tip-0', '/products/grinder'],
      ['/blog/tip-1', '/products/grinder'],
      ['/blog/tip-2', '/products/kettle'],
      ['/blog/tip-3', '/products/kettle'],
      ['/blog/tip-4', '/collections/scales'],
    ]);
  });

  it('pairs only pages read from the site, with their whole addresses', () => {
    const { pairs } = chooseBridgeLinks(
      {
        pages: [
          row('/blog/cold-brew-guide', { ai_visits: 120, sessions: 400 }),
          row('/products/cold-brew-maker', { transactions: 2, sessions: 20 }),
        ],
        // A row without an address read from the site isn't one.
        sitePages: [
          sitePage('/blog/cold-brew-guide', 'Cold brew guide'),
          { url: '/products/cold-brew-maker', title: 'Cold brew maker' },
        ],
        now: NOW,
      },
      t,
    );
    expect(pairs).toEqual([]);
  });
});

describe('the bridge links definition (G20)', () => {
  const signal = {
    kind: 'bridge_link_gap',
    payload: {
      entity: 'pages',
      siteKeyRate: 0.02,
      targets: [
        {
          id: `${SITE}/blog/cold-brew-guide`,
          label: `${SITE}/blog/cold-brew-guide`,
          to: `${SITE}/products/cold-brew-maker`,
          anchor: 'Cold brew maker',
          reason: 'sells',
          salesPage: 'product',
          aiVisits: 120,
          citations: 30,
          toSessions: 80,
          toKeyEvents: 0,
          toTransactions: 6,
        },
        // Not a whole address: left out.
        { id: '/blog/espresso', label: '/blog/espresso', to: `${SITE}/products/espresso` },
      ],
    },
  };

  it('keeps its pairs, and its sources as the pages the work is on', () => {
    const payload = bridgeLinks.payload(new Map([['bridge_link_gap', [signal]]]));
    expect(payload).toMatchObject({
      targetEntity: 'pages',
      pages: [`${SITE}/blog/cold-brew-guide`],
      siteKeyRate: 0.02,
      linkPairs: [
        {
          from: `${SITE}/blog/cold-brew-guide`,
          to: `${SITE}/products/cold-brew-maker`,
          anchor: 'Cold brew maker',
          reason: 'sells',
          salesPage: 'product',
          aiVisits: 120,
          citations: 30,
          toSessions: 80,
          toKeyEvents: 0,
          toTransactions: 6,
        },
      ],
    });
  });

  it('plans the review, the editor and the check, for brands with AI traffic and Analytics', () => {
    expect(bridgeLinks).toMatchObject({
      id: 'bridge_links',
      code: 'G20',
      category: 'growth',
      requires: ['ai_traffic', 'analytics'],
    });
    expect(bridgeLinks.tasks.slice(0, 3)).toEqual([
      'review_link_plan',
      'optimize_content',
      'add_internal_links',
    ]);
  });
});
