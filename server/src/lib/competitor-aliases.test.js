import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Merged competitors (00543): the names and domains merged into a competitor
 * are matched as its own in new answers, and only from the merge on when an
 * older answer is counted again.
 */

const db = vi.hoisted(() => ({ competitors: [], merged: [], mergedError: null, calls: [] }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: (columns) => (db.calls.push({ table, columns }), chain),
        eq: (column, value) => (db.calls.push({ table, column, value }), chain),
        then: (resolve) =>
          resolve(
            table === 'merged_competitors'
              ? { data: db.mergedError ? null : db.merged, error: db.mergedError }
              : { data: db.competitors, error: null },
          ),
      };
      return chain;
    },
  },
}));
const warn = vi.hoisted(() => vi.fn());
vi.mock('./logger.js', () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

const {
  competitorsAt,
  loadTrackedCompetitors,
  mergedCompetitorDomains,
  readMergedCompetitors,
  withMergedNames,
} = await import('./competitor-aliases.js');
const { parseResponse } = await import('./response-parser.js');

const brand = { brandName: 'Brand A', domains: ['brand-a.example'] };
const MERGED_AT = '2026-11-17T10:00:00Z';

beforeEach(() => {
  db.calls = [];
  db.mergedError = null;
  warn.mockReset();
  db.competitors = [
    { id: 'kept', name: 'Sky Air', domain: 'sky.example' },
    { id: 'other', name: 'Trips', domain: null },
  ];
  db.merged = [
    {
      id: 'dup',
      merged_into_id: 'kept',
      name: 'Island Hopper',
      domain: 'islandhopper.example',
      merged_at: MERGED_AT,
    },
  ];
});

describe('loadTrackedCompetitors', () => {
  it('reads the brand’s competitors and its merged ones, by brand', async () => {
    const tracked = await loadTrackedCompetitors('b1');
    expect(db.calls).toContainEqual({ table: 'competitors', column: 'brand_id', value: 'b1' });
    expect(db.calls).toContainEqual({
      table: 'merged_competitors',
      column: 'brand_id',
      value: 'b1',
    });
    expect(tracked).toEqual([
      {
        id: 'kept',
        name: 'Sky Air',
        domain: 'sky.example',
        aliases: ['Island Hopper'],
        aliasDomains: ['islandhopper.example'],
        merged: [{ name: 'Island Hopper', domain: 'islandhopper.example', since: MERGED_AT }],
      },
      { id: 'other', name: 'Trips', domain: '' },
    ]);
  });

  it('counts as before when the merged ones can’t be read, quietly before 00543', async () => {
    db.mergedError = {
      code: 'PGRST205',
      message: "Could not find the table 'public.merged_competitors'",
    };
    const tracked = await loadTrackedCompetitors('b1');
    expect(tracked.map((c) => c.aliases)).toEqual([undefined, undefined]);
    expect(warn).not.toHaveBeenCalled();

    db.mergedError = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(await readMergedCompetitors('b1')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('gives the merged domains, for the sources that are never a source to earn', async () => {
    expect(await mergedCompetitorDomains('b1')).toEqual(['islandhopper.example']);
  });
});

describe('a new answer naming a merged competitor', () => {
  it('counts for the kept one, by the merged name, domain and site', async () => {
    const tracked = await loadTrackedCompetitors('b1');
    const answer = {
      text: 'Island Hopper runs ferries; see islandhopper.example. Brand A is calm.',
      citations: [
        { url: 'https://www.islandhopper.example/routes' },
        { url: 'https://guide.example/a' },
      ],
    };
    const metrics = parseResponse(answer, brand, 'neutral', tracked);
    const kept = metrics.competitorMentions.find((m) => m.competitor_id === 'kept');
    expect(kept).toMatchObject({
      name: 'Sky Air',
      domain: 'sky.example',
      mention_count: 2,
      citation_count: 1,
      mention_position: 1,
    });
    // One entry per tracked competitor: none for the merged one.
    expect(metrics.competitorMentions.map((m) => m.competitor_id)).toEqual(['kept', 'other']);
    expect(metrics.mentionPosition).toBe(2);
    expect(metrics.mentionedEntityCount).toBe(2);
  });

  it('is not counted at all once unmerged into nothing (no merged rows)', async () => {
    db.merged = [];
    const tracked = await loadTrackedCompetitors('b1');
    const metrics = parseResponse(
      { text: 'Island Hopper runs ferries.', citations: [] },
      brand,
      'neutral',
      tracked,
    );
    expect(metrics.competitorMentions.every((m) => m.mention_count === 0)).toBe(true);
  });
});

describe('the parser with merged names', () => {
  it('counts a merged name that is the kept one’s own once, and the kept one’s own as before', () => {
    const answer = { text: 'Sky Air and sky.example and SKY AIR.', citations: [] };
    const plain = parseResponse(answer, brand, 'neutral', [
      { id: 'kept', name: 'Sky Air', domain: 'sky.example' },
    ]);
    const merged = parseResponse(answer, brand, 'neutral', [
      {
        id: 'kept',
        name: 'Sky Air',
        domain: 'sky.example',
        aliases: ['sky air', ' Sky Air '],
        aliasDomains: ['SKY.example'],
      },
    ]);
    expect(merged.competitorMentions[0].mention_count).toBe(
      plain.competitorMentions[0].mention_count,
    );
  });
});

describe('withMergedNames', () => {
  it('takes each merged name and domain once, and leaves competitors without any as they were', () => {
    const comps = [
      { id: 'k', name: 'K', domain: 'k.example' },
      { id: 'x', name: 'X', domain: '' },
    ];
    const out = withMergedNames(comps, [
      { merged_into_id: 'k', name: 'K Two', domain: 'k2.example', merged_at: MERGED_AT },
      { merged_into_id: 'k', name: 'K Two', domain: '', merged_at: MERGED_AT },
      { merged_into_id: 'gone', name: 'Nobody', domain: 'nobody.example' },
    ]);
    expect(out[0].aliases).toEqual(['K Two']);
    expect(out[0].aliasDomains).toEqual(['k2.example']);
    expect(out[1]).toBe(comps[1]);
  });
});

describe('competitorsAt', () => {
  it('uses the merged names only in answers from the merge on', async () => {
    const tracked = await loadTrackedCompetitors('b1');
    const before = competitorsAt(tracked, '2026-11-16T09:00:00Z');
    const after = competitorsAt(tracked, '2026-11-17T10:00:01Z');
    expect(before[0]).toMatchObject({ aliases: [], aliasDomains: [] });
    expect(after[0]).toMatchObject({
      aliases: ['Island Hopper'],
      aliasDomains: ['islandhopper.example'],
    });
    expect(before[1]).toBe(tracked[1]);
  });
});
