import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore } from './visibility-score';
import {
  parsePlatformRows,
  platformChanges,
  platformMovers,
  platformTable,
  rankSummary,
  type PlatformChange,
  type PlatformRow,
} from './insights-summary';

const row = (
  model_used: string | null,
  platform: string | null,
  win: 'cur' | 'prev',
  answers: number,
  mentions: number,
  extra: Partial<PlatformRow> = {},
): PlatformRow => ({
  model_used,
  platform,
  win,
  answers,
  mention_answers: mentions,
  citation_answers: 0,
  sum_inv_position: null,
  position_count: 0,
  sum_position: null,
  visible_prompt_ids: [],
  active_prompt_ids: [],
  ...extra,
});

// Model slugs fold into platform names, as resolveProvider does.
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
    expect(platformChanges([row('gpt-5-mini', null, 'cur', 30, 5)], platformOf)).toEqual([]);
  });

  it('leaves out a change over fewer than 20 answers in either window', () => {
    const changes = platformChanges(
      [
        row('gpt-4o', null, 'cur', 40, 4),
        row('gpt-4o', null, 'prev', 19, 15),
        row(null, 'google-aimode', 'cur', 20, 10),
        row(null, 'google-aimode', 'prev', 20, 2),
      ],
      platformOf,
    );

    expect(changes.map((c) => c.name)).toEqual(['Google AI Mode']);
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
        sum_position: null,
        visible_prompt_ids: [],
        active_prompt_ids: [],
      },
    ]);
    expect(parsePlatformRows({ complete: false, platforms: [] })).toBeNull();
  });

  it('reads the 00133 position sum and prompt ids', () => {
    expect(
      parsePlatformRows({
        complete: true,
        platforms: [
          {
            model_used: 'gpt-4o',
            win: 'cur',
            sum_position: '12',
            visible_prompt_ids: ['p1'],
            active_prompt_ids: ['p1', 'p2'],
          },
        ],
      })?.[0],
    ).toMatchObject({
      sum_position: 12,
      visible_prompt_ids: ['p1'],
      active_prompt_ids: ['p1', 'p2'],
    });
  });
});

describe('platformTable', () => {
  const change = (name: string, c: number): PlatformChange => ({
    name,
    cur: 0,
    prev: 0,
    change: c,
  });

  it('folds model slugs and fills each column from the current window', () => {
    const [chatgpt] = platformTable(
      [
        row('gpt-5-mini', null, 'cur', 30, 6, {
          sum_inv_position: 2,
          position_count: 4,
          sum_position: 10,
          visible_prompt_ids: ['p1', 'p2'],
          active_prompt_ids: ['p1', 'p2', 'p3', 'p4'],
        }),
        // The same prompts on another ChatGPT model count once.
        row('gpt-4o', null, 'cur', 30, 6, {
          sum_inv_position: 1,
          position_count: 2,
          sum_position: 8,
          visible_prompt_ids: ['p2', 'p3'],
          active_prompt_ids: ['p1', 'p2', 'p3', 'p4', 'p5'],
        }),
        row('gpt-4o', null, 'prev', 60, 50),
      ],
      [change('ChatGPT', -3.2)],
      [{ provider: 'ChatGPT', sov: 41.5 }],
      platformOf,
    );

    expect(chatgpt).toEqual({
      name: 'ChatGPT',
      status: 'ok',
      runs: 60,
      visibility: computeAiVisibilityScore({
        answers: 60,
        mentionAnswers: 12,
        citationAnswers: 0,
        positionFactor: 3 / 6,
      }),
      change: -3.2,
      coverage: 60,
      shareOfVoice: 41.5,
      avgPosition: 3,
      worst: true,
    });
  });

  it('shows why instead of numbers below 20 answers or without runs', () => {
    const table = platformTable(
      [
        row(null, 'google-aimode', 'prev', 50, 10),
        row('claude-sonnet', null, 'cur', 12, 6),
        row('gpt-4o', null, 'cur', 40, 4),
      ],
      [change('Other', -5)],
      [{ provider: 'Other', sov: 80 }],
      platformOf,
    );

    expect(table.map((r) => [r.name, r.status, r.runs])).toEqual([
      ['ChatGPT', 'ok', 40],
      ['Other', 'lowSample', 12],
      ['Google AI Mode', 'noRuns', 0],
    ]);
    // A low-sample row has no values, so its drop doesn't tint it.
    expect(table[1]).toMatchObject({ visibility: null, change: null, shareOfVoice: null });
    expect(table.some((r) => r.worst)).toBe(false);
  });

  it('sorts by Visibility and tints only the biggest drop', () => {
    const table = platformTable(
      [row('gpt-4o', null, 'cur', 40, 4), row(null, 'google-aimode', 'cur', 40, 30)],
      [change('ChatGPT', -1), change('Google AI Mode', -4)],
      [],
      platformOf,
    );

    expect(table.map((r) => [r.name, r.worst])).toEqual([
      ['Google AI Mode', true],
      ['ChatGPT', false],
    ]);
    expect(table[0].shareOfVoice).toBeNull();
  });
});
