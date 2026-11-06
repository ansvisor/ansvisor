// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATE_PRESETS, DEFAULT_CITATIONS_FILTERS } from '@/components/citations/filter-bar';
import { DEFAULT_MENTIONS_FILTERS, readMentionsState } from '@/lib/mentions-filters';
import {
  BRAND_VISIBILITY_TABS,
  brandVisibilityTabHref,
  brandVisibilityTabOf,
  hasProductVisibilityTab,
  isEcommerceBrand,
  mentionsPlatformOf,
  OVERVIEW_DEFAULT_RANGE,
  readSharedFilters,
  sharedFilterQuery,
} from './brand-visibility';

/**
 * Brand Visibility (the owner's mockup): one page, its tabs on the routes
 * their pages always had (Product Visibility for brands that sell online),
 * and the filters Overview, Mentions and Citations share kept from tab to
 * tab.
 */

const GROUP = path.resolve(__dirname, '../app/[locale]/(dashboard)/dashboard/(brand-visibility)');

describe('the tabs and their routes', () => {
  it('are Overview, Mentions, Citations and Product Visibility, on the old pages’ addresses', () => {
    expect(BRAND_VISIBILITY_TABS).toEqual([
      { id: 'overview', href: '/dashboard/insights' },
      { id: 'mentions', href: '/dashboard/mentions' },
      { id: 'citations', href: '/dashboard/citations' },
      { id: 'products', href: '/dashboard/shopping' },
    ]);
  });

  it('each has its own route under the shared layout, with its own loading and error states', () => {
    expect(existsSync(path.join(GROUP, 'layout.tsx'))).toBe(true);
    for (const folder of ['insights', 'mentions', 'citations', 'shopping']) {
      for (const file of ['page.tsx', 'loading.tsx', 'error.tsx']) {
        expect(existsSync(path.join(GROUP, folder, file)), `${folder}/${file}`).toBe(true);
      }
    }
    // A result's page and a cited URL's keep their own headers, outside the tabs.
    const dashboard = path.dirname(GROUP);
    expect(existsSync(path.join(dashboard, 'insights/[id]/page.tsx'))).toBe(true);
    expect(existsSync(path.join(dashboard, 'citations/url/page.tsx'))).toBe(true);
    // So does a product's page, under Product Visibility's address.
    expect(existsSync(path.join(dashboard, 'shopping/products/[productId]/page.tsx'))).toBe(true);
    expect(existsSync(path.join(dashboard, 'shopping/page.tsx'))).toBe(false);
  });

  it('knows the tab an address opens, and nothing else', () => {
    expect(brandVisibilityTabOf('/dashboard/insights')).toBe('overview');
    expect(brandVisibilityTabOf('/dashboard/mentions/')).toBe('mentions');
    expect(brandVisibilityTabOf('/dashboard/citations')).toBe('citations');
    expect(brandVisibilityTabOf('/dashboard/shopping')).toBe('products');
    expect(brandVisibilityTabOf('/dashboard/shopping/products/p1')).toBeNull();
    expect(brandVisibilityTabOf('/dashboard/insights/r1')).toBeNull();
    expect(brandVisibilityTabOf('/dashboard/citations/url')).toBeNull();
    expect(brandVisibilityTabOf('/dashboard/prompts/insights')).toBeNull();
  });
});

describe('the filters the tabs share', () => {
  it('reads each tab’s own names, and a range only when one was picked', () => {
    // A tab's default isn't taken to the next tab: each opens on its own.
    expect(TAB_DEFAULTS).toEqual({ overview: '', mentions: '', citations: '' });
    expect(readSharedFilters('overview', new URLSearchParams('range=24h')).range).toBe('');
    expect(readSharedFilters('mentions', new URLSearchParams('range=30d')).range).toBe('');
    expect(
      readSharedFilters(
        'overview',
        new URLSearchParams('range=7d&model=chatgpt-web,gpt-5-chat-latest&region=us&topic=t1'),
      ),
    ).toEqual({
      range: '7d',
      from: '',
      to: '',
      engine: 'chatgpt-web,gpt-5-chat-latest',
      region: 'us',
      topic: 't1',
    });
    expect(
      readSharedFilters(
        'citations',
        new URLSearchParams('preset=custom&from=2026-10-01&to=2026-10-07&platform=gemini-web'),
      ),
    ).toMatchObject({
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-07',
      engine: 'gemini-web',
    });
    // An unknown range is the tab's default; Mentions has no All time.
    expect(readSharedFilters('mentions', new URLSearchParams('range=all')).range).toBe('');
    expect(readSharedFilters('mentions', new URLSearchParams('range=24h')).range).toBe('24h');
  });

  it('match the pages’ own presets and defaults', () => {
    expect(OVERVIEW_DEFAULT_RANGE).toBe('24h');
    expect(DEFAULT_CITATIONS_FILTERS.datePreset).toBe('24h');
    expect(DATE_PRESETS).toEqual(['24h', '7d', '30d', '90d', 'all', 'custom']);
    expect(DEFAULT_MENTIONS_FILTERS.range).toBe('30d');
  });

  it('names an engine as Mentions does: one of its platforms', () => {
    expect(mentionsPlatformOf('chatgpt-web,gpt-5-chat-latest')).toBe('chatgpt-web');
    expect(mentionsPlatformOf('gemini-web')).toBe('gemini-web');
    // An engine no longer tracked (#2181) isn't one of its platforms: no filter.
    expect(mentionsPlatformOf('perplexity-web')).toBe('');
    // Claude's API models answer under the "claude" platform there.
    expect(mentionsPlatformOf('claude-sonnet-5')).toBe('claude');
    expect(mentionsPlatformOf('')).toBe('');
    expect(mentionsPlatformOf('made-up-model')).toBe('');
  });

  it('writes a tab’s query in its own names, its defaults left out', () => {
    const filters = {
      range: '7d',
      from: '',
      to: '',
      engine: 'chatgpt-web,gpt-5-chat-latest',
      region: 'us',
      topic: 't1',
    };
    expect(sharedFilterQuery('overview', filters)).toBe(
      '?range=7d&model=chatgpt-web%2Cgpt-5-chat-latest&region=us&topic=t1',
    );
    expect(sharedFilterQuery('citations', filters)).toBe(
      '?preset=7d&platform=chatgpt-web%2Cgpt-5-chat-latest&region=us&topic=t1',
    );
    expect(sharedFilterQuery('mentions', filters)).toBe(
      '?range=7d&platform=chatgpt-web&region=us&topic=t1',
    );
    expect(
      sharedFilterQuery('overview', {
        ...filters,
        range: '24h',
        engine: '',
        region: '',
        topic: '',
      }),
    ).toBe('');
  });
});

describe('a tab’s link', () => {
  it('keeps the date range, engine, country and topic from tab to tab', () => {
    // Overview → Mentions: Mentions reads the same days, engine and topic.
    const fromOverview = '?range=90d&model=chatgpt-web%2Cgpt-5-chat-latest&topic=t1&region=de';
    const mentions = brandVisibilityTabHref('mentions', 'overview', fromOverview);
    expect(mentions).toBe('/dashboard/mentions?range=90d&platform=chatgpt-web&region=de&topic=t1');
    const { filters } = readMentionsState(new URLSearchParams(mentions.split('?')[1]));
    expect(filters).toMatchObject({
      range: '90d',
      platform: 'chatgpt-web',
      region: 'de',
      topic: 't1',
    });

    // Mentions → Citations: Mentions' own tab and search stay behind.
    expect(
      brandVisibilityTabHref(
        'citations',
        'mentions',
        '?range=7d&platform=claude&tab=perception&q=latte',
      ),
    ).toBe('/dashboard/citations?preset=7d&platform=claude');

    // Citations → Overview: a custom range and its days.
    expect(
      brandVisibilityTabHref(
        'overview',
        'citations',
        '?preset=custom&from=2026-10-01&to=2026-10-07&scope=all&prompt=p1',
      ),
    ).toBe('/dashboard/insights?range=custom&from=2026-10-01&to=2026-10-07');

    // A default isn't carried: the Overview's 24h is the latest run, Mentions'
    // the last 24 hours, which a brand whose last run is older (the demo's
    // run every 3 days) would find empty. Each tab opens on its own default.
    expect(brandVisibilityTabHref('mentions', 'overview', '')).toBe('/dashboard/mentions');
    expect(brandVisibilityTabHref('citations', 'mentions', '?platform=claude')).toBe(
      '/dashboard/citations?platform=claude',
    );
    // All time, which Mentions doesn't offer, opens its default too.
    expect(brandVisibilityTabHref('mentions', 'overview', '?range=all')).toBe(
      '/dashboard/mentions',
    );
  });

  it('keeps a tab’s own filters on its own link, and opens a tab plainly from elsewhere', () => {
    expect(brandVisibilityTabHref('mentions', 'mentions', '?tab=perception&q=latte')).toBe(
      '/dashboard/mentions?tab=perception&q=latte',
    );
    expect(brandVisibilityTabHref('citations', null, '?range=7d')).toBe('/dashboard/citations');
  });

  it('carries no filter to Product Visibility or from it, and keeps its own view', () => {
    expect(brandVisibilityTabHref('products', 'overview', '?range=7d&region=us')).toBe(
      '/dashboard/shopping',
    );
    expect(brandVisibilityTabHref('overview', 'products', '?tab=categories')).toBe(
      '/dashboard/insights',
    );
    expect(brandVisibilityTabHref('products', 'products', '?tab=readiness')).toBe(
      '/dashboard/shopping?tab=readiness',
    );
  });
});

describe('Product Visibility as the fourth tab', () => {
  const plan = (has: boolean) => (feature: string) => has && feature === 'shopping_analytics';

  it('counts a brand as selling online by its Shopping mode or its e-commerce site type', () => {
    expect(isEcommerceBrand({ shoppingModeEnabled: true })).toBe(true);
    expect(isEcommerceBrand({ shoppingModeEnabled: false, siteType: 'ecommerce' })).toBe(true);
    expect(isEcommerceBrand({ shoppingModeEnabled: false, siteType: 'b2b' })).toBe(false);
    expect(isEcommerceBrand({ shoppingModeEnabled: false })).toBe(false);
    expect(isEcommerceBrand(null)).toBe(false);
  });

  it('shows for an e-commerce brand on a plan with Product Visibility, and for no other', () => {
    const shop = { shoppingModeEnabled: true };
    const store = { shoppingModeEnabled: false, siteType: 'ecommerce' };
    const saas = { shoppingModeEnabled: false, siteType: 'b2b' };
    expect(hasProductVisibilityTab(shop, plan(true))).toBe(true);
    expect(hasProductVisibilityTab(store, plan(true))).toBe(true);
    expect(hasProductVisibilityTab(saas, plan(true))).toBe(false);
    expect(hasProductVisibilityTab(shop, plan(false))).toBe(false);
    expect(hasProductVisibilityTab(store, plan(false))).toBe(false);
    expect(hasProductVisibilityTab(undefined, plan(true))).toBe(false);
  });
});

const TAB_DEFAULTS = Object.fromEntries(
  (['overview', 'mentions', 'citations'] as const).map((id) => [
    id,
    readSharedFilters(id, new URLSearchParams()).range,
  ]),
);
