import { describe, expect, it } from 'vitest';

import { aggregateHeadToHead, competitorScoreIn, type HeadToHeadResultRow } from './head-to-head';

const COMP = 'comp-1';
const prompts = new Map([
  ['p1', { text: 'best crm for startups', category: 'comparison' }],
  ['p2', { text: 'how to pick a crm' }],
]);
const provider = (model: string | null, platform: string | null) =>
  platform === 'chatgpt' ? 'ChatGPT' : (model ?? 'Unknown');

function row(overrides: Partial<HeadToHeadResultRow>): HeadToHeadResultRow {
  return {
    prompt_id: 'p1',
    platform: 'chatgpt',
    model_used: null,
    region: 'US',
    visibility_score: 0,
    competitor_mentions: [],
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const mention = (score: number, id = COMP) => [{ competitor_id: id, visibility_score: score }];

describe('competitorScoreIn', () => {
  it('returns the score when the competitor is listed, 0 when listed without one', () => {
    expect(competitorScoreIn(mention(40), COMP)).toBe(40);
    expect(competitorScoreIn([{ competitor_id: COMP }], COMP)).toBe(0);
  });

  it('returns null when the answer does not list the competitor', () => {
    expect(competitorScoreIn(mention(40, 'other'), COMP)).toBeNull();
    expect(competitorScoreIn(null, COMP)).toBeNull();
  });
});

describe('aggregateHeadToHead', () => {
  it('returns one group per prompt, engine, model and region, averaged over its runs', () => {
    const data = aggregateHeadToHead(
      [
        row({ visibility_score: 60, competitor_mentions: mention(20) }),
        row({
          visibility_score: 40,
          competitor_mentions: mention(40),
          created_at: '2026-10-02T00:00:00Z',
        }),
        row({ region: 'GB', visibility_score: 10, competitor_mentions: mention(50) }),
      ],
      COMP,
      prompts,
      provider,
    );

    expect(data.groups).toHaveLength(2);
    const us = data.groups.find((g) => g.region === 'US')!;
    expect(us).toMatchObject({
      promptId: 'p1',
      promptText: 'best crm for startups',
      promptCategory: 'comparison',
      platform: 'ChatGPT',
      rawPlatform: 'chatgpt',
      rawModelUsed: null,
      runs: 2,
      brandScore: 50,
      competitorScore: 30,
      diff: 20,
      latestAt: '2026-10-02T00:00:00Z',
    });
  });

  it('carries no answer text or citations', () => {
    const data = aggregateHeadToHead([row({ visibility_score: 10 })], COMP, prompts, provider);
    expect(Object.keys(data.groups[0])).not.toContain('response');
    expect(Object.keys(data.groups[0])).not.toContain('citations');
  });

  it('counts a missing competitor as 0 in groups but leaves it out of the overall average', () => {
    const data = aggregateHeadToHead(
      [
        row({ visibility_score: 50, competitor_mentions: mention(30) }),
        row({ visibility_score: 50, competitor_mentions: [] }),
      ],
      COMP,
      prompts,
      provider,
    );
    expect(data.groups[0].competitorScore).toBe(15);
    expect(data.competitorAvg).toBe(30);
    expect(data.brandAvg).toBe(50);
  });

  it('breaks results down by display provider', () => {
    const data = aggregateHeadToHead(
      [
        row({ platform: 'chatgpt', visibility_score: 80, competitor_mentions: mention(20) }),
        row({
          platform: null,
          model_used: 'Gemini',
          visibility_score: 20,
          competitor_mentions: mention(60),
        }),
      ],
      COMP,
      prompts,
      provider,
    );
    expect(data.platformRows).toEqual([
      { platform: 'ChatGPT', brandScore: 80, competitorScore: 20, diff: 60 },
      { platform: 'Gemini', brandScore: 20, competitorScore: 60, diff: -40 },
    ]);
  });

  it('ranks gaps and strengths by group average, worst and best first', () => {
    const data = aggregateHeadToHead(
      [
        row({ prompt_id: 'p1', visibility_score: 10, competitor_mentions: mention(60) }),
        row({ prompt_id: 'p2', visibility_score: 30, competitor_mentions: mention(40) }),
        row({
          prompt_id: 'p2',
          region: 'GB',
          visibility_score: 90,
          competitor_mentions: mention(10),
        }),
        row({
          prompt_id: 'p1',
          region: 'GB',
          visibility_score: 20,
          competitor_mentions: mention(20),
        }),
      ],
      COMP,
      prompts,
      provider,
    );
    expect(data.gaps.map((g) => [g.promptId, g.diff])).toEqual([
      ['p1', -50],
      ['p2', -10],
    ]);
    expect(data.strengths.map((g) => [g.promptId, g.diff])).toEqual([['p2', 80]]);
  });

  it('counts results without a prompt in the averages but not as a group', () => {
    const data = aggregateHeadToHead(
      [row({ prompt_id: null, visibility_score: 90 }), row({ visibility_score: 10 })],
      COMP,
      prompts,
      provider,
    );
    expect(data.groups).toHaveLength(1);
    expect(data.brandAvg).toBe(50);
  });
});
