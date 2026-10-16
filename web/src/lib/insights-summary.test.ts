import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore } from './visibility-score';
import {
  parsePlatformRows,
  platformChanges,
  platformMovers,
  rankSummary,
  type PlatformRow,
} from './insights-summary';

const row = (
  model_used: string | null,
  platform: string | null,
  win: 'cur' | 'prev',
  answers: number,
  mentions: number,
): PlatformRow => ({
  model_used,
  platform,
  win,
  answers,
  mention_answers: mentions,
  citation_answers: 0,
  sum_inv_position: null,
  position_count: 0,
});

// Model slugs fold into the platform names "Share of Voice by Platform" uses.
const platformOf = (model: string | null, platform: string | null) =>
  platform === 'google-aimode' ? 'Google AI Mode' : model?.startsWith('gpt-') ? 'ChatGPT' : 'Other';

const score = (answers: number, mentions: number) =>
  computeAiVisibilityScore({
    answers,
    mentionAnswers: mentions,
    citationAnswers: 0,
    positionFactor: null,
  })!;

describe('platformChanges', () => {
  it('scores each platform in both windows, folding model slugs together', () => {
    const changes = platformChanges(
      [
        row('gpt-5-mini', null, 'cur', 50, 10),
        row('gpt-4o', null, 'cur', 50, 10),
        row('gpt-5-mini', null, 'prev', 100, 40),
        row(null, 'google-aimode', 'cur', 100, 60),
        row(null, 'google-aimode', 'prev', 100, 20),
      ],
      platformOf,
    );

    expect(changes.map((c) => c.name)).toEqual(['Google AI Mode', 'ChatGPT']);
    const chatgpt = changes[1];
    expect(chatgpt.cur).toBe(score(100, 20));
    expect(chatgpt.change).toBe(Math.round((score(100, 20) - score(100, 40)) * 10) / 10);
  });

  it('leaves out platforms not answered in both windows', () => {
    expect(platformChanges([row('gpt-5-mini', null, 'cur', 10, 5)], platformOf)).toEqual([]);
  });
});

describe('platformMovers', () => {
  const change = (name: string, c: number) => ({ name, cur: 0, prev: 0, change: c });

  it('names the biggest rise and the biggest drop', () => {
    const sorted = [change('A', 16.1), change('B', 2), change('C', -1), change('D', -3.2)];

    expect(platformMovers(sorted)).toEqual({ up: sorted[0], down: sorted[3] });
  });

  it('names nothing when nothing moved that way', () => {
    expect(platformMovers([change('A', 0), change('B', -1)])).toEqual({
      up: null,
      down: change('B', -1),
    });
    expect(platformMovers([])).toEqual({ up: null, down: null });
  });
});

describe('rankSummary', () => {
  const brand = (name: string, score: number, isOwnBrand = false) => ({ name, score, isOwnBrand });

  it('gives the gap to the brand directly ahead', () => {
    expect(
      rankSummary([brand('Semrush', 36.3), brand('Peec AI', 18.3), brand('Ansvisor', 17.4, true)]),
    ).toEqual({
      rank: 3,
      count: 3,
      neighbour: { name: 'Peec AI', gap: 0.9, side: 'behind' },
    });
  });

  it('gives the lead over the runner-up when first', () => {
    expect(rankSummary([brand('Ansvisor', 78.8, true), brand('Demo Coffee Co', 61.9)])).toEqual({
      rank: 1,
      count: 2,
      neighbour: { name: 'Demo Coffee Co', gap: 16.9, side: 'ahead' },
    });
  });

  it('has no rank alone on the leaderboard', () => {
    expect(rankSummary([brand('Ansvisor', 78.8, true)])).toBeNull();
  });
});

describe('parsePlatformRows', () => {
  it('reads the RPC payload and refuses rollups not yet backfilled', () => {
    expect(
      parsePlatformRows({
        complete: true,
        platforms: [{ model_used: 'gpt-4o', platform: null, win: 'prev', answers: '3' }],
      }),
    ).toEqual([
      {
        model_used: 'gpt-4o',
        platform: null,
        win: 'prev',
        answers: 3,
        mention_answers: 0,
        citation_answers: 0,
        sum_inv_position: null,
        position_count: 0,
      },
    ]);
    expect(parsePlatformRows({ complete: false, platforms: [] })).toBeNull();
  });
});
