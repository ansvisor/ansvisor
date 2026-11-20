import { describe, expect, it } from 'vitest';

import {
  answerScore,
  competitorScoreIn,
  foldScores,
  headToHeadFromRollups,
  type HeadToHeadRollupEngine,
  type HeadToHeadRollupGroup,
  type HeadToHeadRollups,
} from './head-to-head';

/**
 * The head-to-head scores are the Visibility score the competitor cards show
 * (UX audit CP-01, decision D3): 100 × (0.6 × mention rate + 0.25 × citation
 * rate + 0.15 × position factor, shrunk on thin evidence), both sides over
 * the brand's answers in the scope.
 */

const COMP = 'comp-1';
const prompts: HeadToHeadRollups['prompts'] = [
  { id: 'p1', text: 'best crm for startups', category: 'comparison' },
  { id: 'p2', text: 'how to pick a crm', category: null },
];
const provider = (model: string | null, platform: string | null) =>
  platform === 'chatgpt' ? 'ChatGPT' : (model ?? 'Unknown');

function group(overrides: Partial<HeadToHeadRollupGroup>): HeadToHeadRollupGroup {
  return {
    prompt_id: 'p1',
    platform: 'chatgpt',
    model_used: null,
    region: 'US',
    runs: 1,
    brand_total: 0,
    comp_total: 0,
    latest_at: '2026-10-01T00:00:00+00:00',
    brand_mention_answers: 0,
    brand_citation_answers: 0,
    brand_inv_position: 0,
    brand_position_count: 0,
    comp_mention_answers: 0,
    comp_citation_answers: 0,
    comp_inv_position: 0,
    comp_position_count: 0,
    ...overrides,
  };
}

function engine(overrides: Partial<HeadToHeadRollupEngine>): HeadToHeadRollupEngine {
  return {
    platform: 'chatgpt',
    model_used: null,
    brand_count: 1,
    brand_total: 0,
    comp_count: 0,
    comp_total: 0,
    brand_mention_answers: 0,
    brand_citation_answers: 0,
    brand_inv_position: 0,
    brand_position_count: 0,
    comp_mention_answers: 0,
    comp_citation_answers: 0,
    comp_inv_position: 0,
    comp_position_count: 0,
    ...overrides,
  };
}

const rollups = (r: Partial<HeadToHeadRollups>): HeadToHeadRollups => ({
  groups: [],
  engines: [],
  prompts,
  ...r,
});

describe('one answer’s score', () => {
  it('is the formula over the one answer, a listed competitor named or not', () => {
    // Named first, not cited: 60 for the mention, the position shrunk to 1/21.
    expect(answerScore({ mention_count: 1, citation_count: 0, mention_position: 1 })).toBe(60.7);
    expect(answerScore({ mention_count: 0, citation_count: 1 })).toBe(25);
    expect(
      competitorScoreIn([{ competitor_id: COMP, mention_count: 2, mention_position: 1 }], COMP),
    ).toBe(60.7);
    expect(competitorScoreIn([{ competitor_id: COMP }], COMP)).toBe(0);
  });

  it('is null when the answer does not list the competitor', () => {
    expect(competitorScoreIn([{ competitor_id: 'other', mention_count: 1 }], COMP)).toBeNull();
    expect(competitorScoreIn(null, COMP)).toBeNull();
  });
});

describe('headToHeadFromRollups', () => {
  it('scores each prompt, engine, model and region group over its answers', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [
          // 2 answers: the brand named in 1, the competitor in both.
          group({
            runs: 2,
            brand_mention_answers: 1,
            comp_mention_answers: 2,
            latest_at: '2026-10-02T00:00:00+00:00',
          }),
          group({ region: 'GB', brand_mention_answers: 1 }),
        ],
      }),
      provider,
    );

    expect(data.groups).toHaveLength(2);
    expect(data.groups.find((g) => g.region === 'US')).toMatchObject({
      promptId: 'p1',
      promptText: 'best crm for startups',
      promptCategory: 'comparison',
      platform: 'ChatGPT',
      rawPlatform: 'chatgpt',
      rawModelUsed: null,
      runs: 2,
      brandScore: 30,
      competitorScore: 60,
      diff: -30,
      latestAt: '2026-10-02T00:00:00+00:00',
    });
  });

  it('lists the most recently run groups first', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [
          group({ prompt_id: 'p1', latest_at: '2026-10-01T00:00:00+00:00' }),
          group({ prompt_id: 'p2', latest_at: '2026-10-05T00:00:00+00:00' }),
        ],
      }),
      provider,
    );
    expect(data.groups.map((g) => g.promptId)).toEqual(['p2', 'p1']);
  });

  it('scores the competitor over the brand’s answers, as the cards do', () => {
    // Four answers; the competitor named in one, cited in one.
    const data = headToHeadFromRollups(
      rollups({
        groups: [group({ runs: 4, comp_mention_answers: 1, comp_citation_answers: 1 })],
        engines: [
          engine({
            brand_count: 4,
            brand_mention_answers: 2,
            comp_count: 1,
            comp_mention_answers: 1,
            comp_citation_answers: 1,
          }),
        ],
      }),
      provider,
    );
    // 100 × (0.6 × 1/4 + 0.25 × 1/4): 21.3, not over its own single answer.
    expect(data.groups[0].competitorScore).toBe(21.3);
    expect(data.competitorAvg).toBe(21.3);
    expect(data.brandAvg).toBe(30);
  });

  it('breaks the scores down by display provider', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [group({ brand_mention_answers: 1 })],
        engines: [
          engine({ brand_mention_answers: 1 }),
          engine({
            platform: null,
            model_used: 'Gemini',
            brand_count: 2,
            comp_count: 2,
            comp_mention_answers: 2,
          }),
        ],
      }),
      provider,
    );
    expect(data.platformRows).toEqual([
      { platform: 'ChatGPT', brandScore: 60, competitorScore: 0, diff: 60 },
      { platform: 'Gemini', brandScore: 0, competitorScore: 60, diff: -60 },
    ]);
  });

  it('ranks gaps and strengths by the score difference, worst and best first', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [
          group({ prompt_id: 'p1', runs: 2, comp_mention_answers: 2 }),
          group({ prompt_id: 'p2', runs: 4, comp_mention_answers: 1 }),
          group({ prompt_id: 'p2', region: 'GB', brand_mention_answers: 1 }),
          group({ prompt_id: 'p1', region: 'GB' }),
        ],
      }),
      provider,
    );
    expect(data.gaps.map((g) => [g.promptId, g.diff])).toEqual([
      ['p1', -60],
      ['p2', -15],
    ]);
    expect(data.strengths.map((g) => [g.promptId, g.diff])).toEqual([['p2', 60]]);
  });

  it('folds several groups from their summed parts, not an average of their scores', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [
          group({ runs: 1, brand_mention_answers: 1 }),
          group({ region: 'GB', runs: 3, comp_mention_answers: 3 }),
        ],
      }),
      provider,
    );
    // The brand named in 1 of 4 answers: 15, not the 30 an average of 60 and 0 gives.
    expect(foldScores(data.groups)).toEqual({ brandScore: 15, competitorScore: 45, diff: -30 });
  });

  it('shrinks the position term on thin evidence, as the cards do', () => {
    const data = headToHeadFromRollups(
      rollups({
        engines: [
          engine({
            brand_count: 10,
            brand_mention_answers: 1,
            brand_inv_position: 1,
            brand_position_count: 1,
          }),
        ],
      }),
      provider,
    );
    // 6 for the mention, 0.15 × 1 × 1/21 × 100 = 0.7 for being named first once.
    expect(data.brandAvg).toBe(6.7);
  });

  it('counts answers without a prompt in the overall scores, which only the engines carry', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [group({ brand_mention_answers: 1 })],
        engines: [engine({ brand_count: 2, brand_mention_answers: 1 })],
      }),
      provider,
    );
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].brandScore).toBe(60);
    expect(data.brandAvg).toBe(30);
  });

  it('reads numbers sent as strings, as Postgres numerics arrive', () => {
    const data = headToHeadFromRollups(
      rollups({
        groups: [group({ runs: '2' as never, brand_mention_answers: '1' as never })],
        engines: [engine({ brand_count: '4' as never, brand_citation_answers: '1' as never })],
      }),
      provider,
    );
    expect(data.groups[0].brandScore).toBe(30);
    expect(data.brandAvg).toBe(6.3);
  });
});
