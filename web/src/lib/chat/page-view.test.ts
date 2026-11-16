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
