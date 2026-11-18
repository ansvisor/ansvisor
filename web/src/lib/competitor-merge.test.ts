// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  aliasesByCompetitor,
  competitorDomainKey,
  competitorDomainRows,
  likelyDuplicates,
  mergedCompetitorDomains,
  mergedMatch,
} from './competitor-merge';

/**
 * Merging duplicate competitors (00543): the kept competitor's other names,
 * a new competitor that is a merged one again, the pairs that may be one
 * company, and the competitor sites the Citations reads tell apart.
 */

const c = (id: string, name: string, domain = '') => ({ id, name, domain });

describe('likelyDuplicates', () => {
  it('pairs the same domain, the same name in other spelling, a name inside the other, a name that is the domain', () => {
    expect(
      likelyDuplicates([c('a', 'Sky Air', 'sky.example'), c('b', 'Blue', 'www.Sky.example/')]),
    ).toEqual([['a', 'b']]);
    expect(likelyDuplicates([c('a', 'Sky Air'), c('b', 'SKY-AIR')])).toEqual([['a', 'b']]);
    expect(likelyDuplicates([c('a', 'Sky Air Tours'), c('b', 'Sky Air')])).toEqual([['a', 'b']]);
    expect(likelyDuplicates([c('a', 'Ünal Turizm'), c('b', 'Unal turizm')])).toEqual([['a', 'b']]);
    expect(
      likelyDuplicates([c('a', 'Island Hopper'), c('b', 'Ferries', 'islandhopper.example')]),
    ).toEqual([['a', 'b']]);
  });

  it('leaves different companies apart, and short names', () => {
    expect(likelyDuplicates([c('a', 'Trip'), c('b', 'Tripadvisor')])).toEqual([]);
    expect(likelyDuplicates([c('a', 'Air'), c('b', 'Air Lines')])).toEqual([]);
    expect(
      likelyDuplicates([
        c('a', 'Blue Ferry', 'blue.example'),
        c('b', 'Green Ferry', 'green.example'),
      ]),
    ).toEqual([]);
    expect(likelyDuplicates([c('a', 'Rival', ''), c('b', 'Other', '')])).toEqual([]);
  });

  it('lists each pair once, in the list’s order', () => {
    expect(
      likelyDuplicates([
        c('a', 'Sky Air'),
        c('b', 'Trips'),
        c('c', 'Sky Air Tours'),
        c('d', 'SkyAir'),
      ]),
    ).toEqual([
      ['a', 'c'],
      ['a', 'd'],
    ]);
  });
});

describe('mergedMatch', () => {
  const merged = [
    { id: 'm1', merged_into_id: 'k', name: 'Island Hopper', domain: 'islandhopper.example' },
    { id: 'm2', merged_into_id: 'k', name: 'Sky Tours', domain: '' },
  ];

  it('finds a merged competitor by its domain, or without a domain by its name', () => {
    expect(
      mergedMatch({ name: 'Anything', domain: 'https://www.IslandHopper.example/' }, merged)?.id,
    ).toBe('m1');
    expect(mergedMatch({ name: ' sky tours ', domain: '' }, merged)?.id).toBe('m2');
    expect(mergedMatch({ name: 'Sky Tours', domain: 'skytours.example' }, merged)).toBeNull();
    expect(mergedMatch({ name: 'Other', domain: '' }, merged)).toBeNull();
  });
});

describe('aliasesByCompetitor', () => {
  it('gathers each kept competitor’s merged names and domains', () => {
    const byKept = aliasesByCompetitor([
      { id: 'm1', merged_into_id: 'k1', name: 'A', domain: 'a.example' },
      { id: 'm2', merged_into_id: 'k1', name: 'B', domain: null },
      { id: 'm3', merged_into_id: 'k2', name: 'C', domain: 'c.example' },
    ]);
    expect(byKept.get('k1')).toEqual([
      { id: 'm1', name: 'A', domain: 'a.example' },
      { id: 'm2', name: 'B', domain: '' },
    ]);
    expect(byKept.get('k2')).toHaveLength(1);
    expect(byKept.get('k3')).toBeUndefined();
  });
});

describe('competitorDomainKey', () => {
  it('compares domains with scheme, www, case and path aside', () => {
    expect(competitorDomainKey('HTTPS://www.Sky.example/routes?x=1')).toBe('sky.example');
    expect(competitorDomainKey(null)).toBe('');
  });
});

/** A client whose tables answer from `tables`, keeping the brand each read asks for. */
function client(tables: Record<string, { data: unknown; error: { message: string } | null }>) {
  const asked: [string, string, unknown][] = [];
  return {
    asked,
    from: (table: string) => ({
      select: () => ({
        eq: async (column: string, value: unknown) => {
          asked.push([table, column, value]);
          return tables[table] ?? { data: [], error: null };
        },
      }),
    }),
  };
}

describe('competitorDomainRows', () => {
  it('gives the tracked and the merged competitors’ domains, by brand', async () => {
    const db = client({
      competitors: { data: [{ domain: 'sky.example' }, { domain: '' }], error: null },
      merged_competitors: { data: [{ domain: 'islandhopper.example' }], error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await competitorDomainRows(db as any, 'b1');
    expect(rows).toEqual({
      data: [{ domain: 'sky.example' }, { domain: '' }, { domain: 'islandhopper.example' }],
      error: null,
    });
    expect(db.asked).toEqual([
      ['competitors', 'brand_id', 'b1'],
      ['merged_competitors', 'brand_id', 'b1'],
    ]);
  });

  it('gives the tracked ones’ alone when the merged ones can’t be read, and fails with the tracked read', async () => {
    const without = client({
      competitors: { data: [{ domain: 'sky.example' }], error: null },
      merged_competitors: { data: null, error: { message: 'relation does not exist' } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await competitorDomainRows(without as any, 'b1')).data).toEqual([
      { domain: 'sky.example' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await mergedCompetitorDomains(without as any, 'b1')).toEqual([]);

    const failed = client({ competitors: { data: null, error: { message: 'boom' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await competitorDomainRows(failed as any, 'b1')).toEqual({
      data: null,
      error: { message: 'boom' },
    });
  });
});
