import { describe, expect, it } from 'vitest';
import {
  PAGE_QUERY_KEYS,
  PAGE_QUERY_MAX_KEYS,
  PAGE_QUERY_VALUE_CHARS,
  PAGE_VIEW_LABEL_CHARS,
  PAGE_VIEW_ROWS,
  panelPageView,
  pageQueryOf,
  viewLabel,
  viewPage,
  viewPathId,
  viewRows,
} from './page-view';

// The owner's plan (2026-11-16, item 8): Chat reads what the page shows, its URL's state too.
describe("a page's view, as the browser builds it", () => {
  it('keeps the rows on screen in order, the first 100, each label on one line and cut', () => {
    const items = Array.from({ length: 130 }, (_, i) => ({
      code: `AC-${i + 1}`,
      title: `Row ${i}`,
    }));
    const rows = viewRows(items, (item) => ({ ref: item.code, label: item.title }));
    expect(rows).toHaveLength(PAGE_VIEW_ROWS);
    expect(rows[0]).toEqual({ ref: 'AC-1', label: 'Row 0' });
    expect(rows[99].ref).toBe('AC-100');
    // A row with no ref or no label isn't one.
    expect(
      viewRows(
        [
          { ref: '', label: 'x' },
          { ref: 'S-07', label: '  ' },
          { ref: 'S-08', label: 'Ok' },
        ],
        (r) => r,
      ),
    ).toEqual([{ ref: 'S-08', label: 'Ok' }]);
    const long = viewLabel(`${'a'.repeat(PAGE_VIEW_LABEL_CHARS - 2)}😀😀\nmore`);
    expect(long.length).toBeLessThanOrEqual(PAGE_VIEW_LABEL_CHARS);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toContain('\n');
    // Never half an emoji: a lone surrogate breaks the request body.
    expect(long).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(viewLabel('Two\n  lines ')).toBe('Two lines');
  });

  it("keeps only the URL keys the page itself keeps, each value cut, none of a link's secrets", () => {
    const query = pageQueryOf(
      '/dashboard/action-center/actions/',
      `?sort=priority&status=new&action=a1b2&q=${'x'.repeat(400)}&token=secret&code=abc&next=%2Fdashboard%2Fx&utm_source=mail&access_token=t`,
    );
    expect(query).toEqual({
      sort: 'priority',
      status: 'new',
      action: 'a1b2',
      q: 'x'.repeat(PAGE_QUERY_VALUE_CHARS),
    });
    // A page with no list of keys sends none; one key at most once.
    expect(pageQueryOf('/dashboard/settings/account', '?tab=billing')).toBeUndefined();
    expect(pageQueryOf('/dashboard/traffic', '?range=7d')).toBeUndefined();
    expect(
      pageQueryOf('/dashboard/citations/url', '?u=https%3A%2F%2Fa.example%2Fp&preset=7d'),
    ).toEqual({ u: 'https://a.example/p', preset: '7d' });
    expect(pageQueryOf('/dashboard/mentions', '?sort=oldest&sort=newest')).toEqual({
      sort: 'oldest',
    });
    // Empty values go; values are strings only (a posted object's other values are dropped).
    expect(pageQueryOf('/dashboard/mentions', { q: '', sort: 3, tab: 'mentions' })).toEqual({
      tab: 'mentions',
    });
  });

  it(`keeps at most ${PAGE_QUERY_MAX_KEYS} keys`, () => {
    const keys = PAGE_QUERY_KEYS['/dashboard/prompts/tracked'];
    expect(keys.length).toBeLessThanOrEqual(PAGE_QUERY_MAX_KEYS);
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, 'v']).concat(keys.map((k) => [k, 'v'])),
    );
    expect(Object.keys(pageQueryOf('/dashboard/prompts/tracked', many) ?? {})).toEqual([...keys]);
  });

  it("puts the URL's state in place of any the page set, and sends nothing when there is none", () => {
    expect(
      panelPageView(
        { tab: 'urls', query: { token: 'x' }, rows: [{ ref: 'a.example', label: 'a.example' }] },
        '/dashboard/citations',
        '?scope=own&token=abc',
      ),
    ).toEqual({
      tab: 'urls',
      rows: [{ ref: 'a.example', label: 'a.example' }],
      query: { scope: 'own' },
    });
    expect(panelPageView(null, '/dashboard/insights', '?range=7d&next=/x')).toEqual({
      query: { range: '7d' },
    });
    expect(panelPageView(undefined, '/dashboard/today', '?x=1')).toBeUndefined();
  });
});

describe('the URL state of the pages that send their context since step 9', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const SECRETS = 'token=t&code=c&next=%2Fx&utm_source=mail';

  it.each([
    [
      '/dashboard/action-center/signals',
      `range=7d&category=citation&impact=high&status=new&source=gsc&platform=openai&q=S-07&signal=${ID}`,
      {
        range: '7d',
        category: 'citation',
        impact: 'high',
        status: 'new',
        source: 'gsc',
        platform: 'openai',
        q: 'S-07',
        signal: ID,
      },
    ],
    [
      '/dashboard/action-center/history',
      'view=scorecard&range=90d&status=completed&type=recover&priority=high&source=gsc&sort=oldest&by=play&q=AC-12',
      {
        view: 'scorecard',
        range: '90d',
        status: 'completed',
        type: 'recover',
        priority: 'high',
        source: 'gsc',
        sort: 'oldest',
        by: 'play',
        q: 'AC-12',
      },
    ],
    [
      '/dashboard/competitors',
      `preset=custom&from=2026-10-01&to=2026-10-31&competitor=${ID}`,
      { preset: 'custom', from: '2026-10-01', to: '2026-10-31', competitor: ID },
    ],
    ['/dashboard/shopping', 'tab=products', { tab: 'products' }],
    ['/dashboard/audit', 'tab=opportunities', { tab: 'opportunities' }],
    [
      '/dashboard/content/library',
      `tab=in_review&created=30d&madeIn=agent&sent=failed&shopping=attention&action=${ID}`,
      {
        tab: 'in_review',
        created: '30d',
        madeIn: 'agent',
        sent: 'failed',
        shopping: 'attention',
        action: ID,
      },
    ],
    ['/dashboard/content/plan', 'days=7&start=create', { days: '7' }],
  ])('keeps only the keys %s keeps', (route, query, kept) => {
    expect(pageQueryOf(route, `${query}&${SECRETS}`)).toEqual(kept);
  });

  it('keeps none on a page that keeps its state elsewhere (Today, KPIs, Review, Agents, Reports)', () => {
    for (const route of [
      '/dashboard/action-center/today',
      '/dashboard/action-center/kpis',
      '/dashboard/action-center/review',
      '/dashboard/agents',
      '/dashboard/reports',
    ]) {
      expect(PAGE_QUERY_KEYS[route], route).toBeUndefined();
      expect(pageQueryOf(route, 'tab=paused&q=x'), route).toBeUndefined();
    }
  });

  it("tells a page whose path holds an id by its pattern, and only an agent's", () => {
    expect(viewPage(`/dashboard/agents/${ID}`)).toBe('/dashboard/agents/[id]');
    expect(viewPage(`/dashboard/agents/${ID}/`)).toBe('/dashboard/agents/[id]');
    expect(viewPage('/dashboard/agents/new')).toBe('/dashboard/agents/new');
    expect(viewPage('/dashboard/agents')).toBe('/dashboard/agents');
    expect(viewPage(null)).toBeNull();
    // A key that only an object's prototype has is no page's.
    expect(pageQueryOf('constructor', 'tab=x')).toBeUndefined();
  });
});

// Step 9's detail pages: an item's own page, its id in the path.
describe('the pages of one item, by the id in their path', () => {
  const ID = '0b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d';
  it.each([
    [`/dashboard/prompts/topics/${ID}`, '/dashboard/prompts/topics/[id]'],
    [`/dashboard/prompts/${ID}`, '/dashboard/prompts/[id]'],
    [`/dashboard/reports/${ID}`, '/dashboard/reports/[id]'],
    [`/dashboard/audit/${ID}`, '/dashboard/audit/[id]'],
    [`/dashboard/shopping/products/${ID}`, '/dashboard/shopping/products/[productId]'],
    [`/dashboard/content/${ID}`, '/dashboard/content/[id]'],
    [`/dashboard/insights/${ID}`, '/dashboard/insights/[id]'],
    [`/dashboard/agents/${ID}/`, '/dashboard/agents/[id]'],
  ])('%s is %s, and its id the path’s', (route, page) => {
    expect(viewPage(route)).toBe(page);
    expect(viewPathId(route)).toBe(ID);
  });

  it('is no item’s page for a list, a word, a deeper path or the Content Editor', () => {
    for (const route of [
      '/dashboard/prompts/topics',
      '/dashboard/prompts/tracked',
      '/dashboard/reports/impact',
      `/dashboard/content/editor/${ID}`,
      `/dashboard/agents/${ID}/edit`,
      `/dashboard/brands/${ID}/topics`,
      `/dashboard/prompts/${ID}x`,
      null,
    ]) {
      expect(viewPathId(route), String(route)).toBeNull();
      expect(viewPage(route), String(route)).toBe(route);
    }
  });

  it("keeps a product's page's shelf (?prompt=, ?platform=); the other items' pages keep none", () => {
    expect(
      pageQueryOf(
        `/dashboard/shopping/products/${ID}`,
        `prompt=${ID}&platform=chatgpt-shopping&token=x&utm_source=mail`,
      ),
    ).toEqual({ prompt: ID, platform: 'chatgpt-shopping' });
    for (const route of [
      `/dashboard/prompts/topics/${ID}`,
      `/dashboard/prompts/${ID}`,
      `/dashboard/reports/${ID}`,
      `/dashboard/audit/${ID}`,
      `/dashboard/content/${ID}`,
      `/dashboard/insights/${ID}`,
    ]) {
      expect(pageQueryOf(route, 'tab=x&prompt=y&q=z'), route).toBeUndefined();
    }
  });
});
