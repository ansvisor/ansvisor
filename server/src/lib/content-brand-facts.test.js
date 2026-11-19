import { describe, expect, it, vi } from 'vitest';

/**
 * The brand's own facts reach the content writers (content test
 * 2026-11-19): drafts about Ansvisor wrote "[AI engines Ansvisor tracks]"
 * and kept claims of engines it had paused.
 */

const tables = vi.hoisted(() => ({
  brand_facts: [],
  prompt_sets: [],
  prompts: [],
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

const { brandFactSources, brandFactsSource, trackedEngines } =
  await import('./content-brand-facts.js');

describe('brandFactsSource', () => {
  it('gives the facts as the site states them, the engines tracked and those not', () => {
    const source = brandFactsSource({
      brandName: 'Ansvisor',
      facts: ['Growth $249 per month', 'Starter $49 per month', 'Growth $249 per month'],
      engines: ['ChatGPT', 'Google AI Overviews', 'Gemini'],
    });
    expect(source).toMatchObject({ kind: 'input', ref: 'brand-facts', label: 'Brand facts' });
    expect(source.detail).toContain(
      "Ansvisor's own facts, as its site states them: Growth $249 per month | Starter $49 per month",
    );
    expect(source.detail).toContain(
      'The AI engines Ansvisor tracks now: ChatGPT, Google AI Overviews, Gemini.',
    );
    expect(source.detail).toContain("It doesn't track Perplexity");
    expect(source.detail).toContain('never as a [bracket]');
  });

  it('is nothing without facts or engines', () => {
    expect(brandFactsSource({ brandName: 'Acme', facts: [], engines: [] })).toBeNull();
  });
});

describe('brandFactSources', () => {
  it('reads the approved facts and the active prompts’ engines', async () => {
    tables.fail = null;
    tables.brand_facts = [{ quote: 'Starter $49 per month', scope: null }];
    tables.prompt_sets = [{ id: 's1' }];
    tables.prompts = [{ platforms: ['chatgpt-web', 'gemini-web'] }];
    expect(await trackedEngines('b1')).toEqual(['ChatGPT', 'Gemini']);
    const [source] = await brandFactSources({ id: 'b1', name: 'Ansvisor' }, { title: 'Pricing' });
    expect(source.detail).toContain('Starter $49 per month');
    expect(source.detail).toContain('tracks now: ChatGPT, Gemini.');
  });

  it('writes the draft without them when they can’t be read', async () => {
    tables.fail = 'brand_facts';
    expect(await brandFactSources({ id: 'b1', name: 'Ansvisor' }, {})).toEqual([]);
  });
});
