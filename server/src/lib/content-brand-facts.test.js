import { describe, expect, it, vi } from 'vitest';

/**
 * The brand's own facts reach the content writers (content test
 * 2026-11-19): drafts about the brand wrote "see your pricing page" in place
 * of its approved prices.
 */

const tables = vi.hoisted(() => ({
  brand_facts: [],
  fail: null,
}));

vi.mock('../config/supabase.js', () => {
  const query = (table) => {
    const filters = [];
    const builder = {
      select: () => builder,
      eq: (col, val) => (filters.push([col, val]), builder),
      in: (col, vals) => (filters.push([col, vals]), builder),
      is: () => builder,
      limit: () => builder,
      then: (resolve) =>
        resolve(
          tables.fail === table
            ? { data: null, error: { message: 'down' } }
            : { data: tables[table], error: null },
        ),
    };
    return builder;
  };
  return { default: { from: query } };
});
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { brandFactSources, brandFactsSource } = await import('./content-brand-facts.js');

describe('brandFactsSource', () => {
  it('gives the facts as the site states them, once each', () => {
    const source = brandFactsSource({
      brandName: 'Ansvisor',
      facts: ['Growth $249 per month', 'Starter $49 per month', 'Growth $249 per month'],
    });
    expect(source).toMatchObject({ kind: 'input', ref: 'brand-facts', label: 'Brand facts' });
    expect(source.detail).toContain(
      "Ansvisor's own facts, as its site states them: Growth $249 per month | Starter $49 per month",
    );
    expect(source.detail).toContain('never as a [bracket]');
  });

  it('says nothing about the AI engines the brand is tracked on', () => {
    const source = brandFactsSource({ brandName: 'Acme', facts: ['Free trial for 14 days'] });
    expect(source.detail).not.toMatch(/engine|tracks|ChatGPT|Perplexity/);
  });

  it('is nothing without facts', () => {
    expect(brandFactsSource({ brandName: 'Acme', facts: [] })).toBeNull();
    expect(brandFactsSource({ brandName: 'Acme', facts: ['  ', ''] })).toBeNull();
  });
});

describe('brandFactSources', () => {
  it('reads the approved facts', async () => {
    tables.fail = null;
    tables.brand_facts = [{ quote: 'Starter $49 per month', scope: null }];
    const [source] = await brandFactSources({ id: 'b1', name: 'Ansvisor' }, { title: 'Pricing' });
    expect(source.detail).toContain('Starter $49 per month');
    expect(source.detail).not.toContain('tracks now');
  });

  it('is empty without approved facts', async () => {
    tables.fail = null;
    tables.brand_facts = [];
    expect(await brandFactSources({ id: 'b1', name: 'Ansvisor' }, {})).toEqual([]);
  });

  it('writes the draft without them when they can’t be read', async () => {
    tables.fail = 'brand_facts';
    expect(await brandFactSources({ id: 'b1', name: 'Ansvisor' }, {})).toEqual([]);
  });
});
