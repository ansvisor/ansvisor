/**
 * prompt-position-summary.test.ts  (PROMPT-007)
 *
 * Tests the Tracked Prompts Positions cell: the average the panel shows, the
 * trend against the previous period, and the per-platform dots.
 */

import { describe, expect, test } from 'vitest';
import {
  buildPositionCell,
  compareLateness,
  previousWindow,
  type PlatformDotState,
  type PromptPositionCell,
  type PlatformPositionRow,
} from './prompt-position-summary';

const row = (platform: string, over: Partial<PlatformPositionRow> = {}): PlatformPositionRow => ({
  platform,
  runs: 4,
  mentionAnswers: 4,
  positionSum: 4,
  positionCount: 4,
  entitySum: 20,
  entityCount: 4,
  ...over,
});

const platforms = [
  { id: 'chatgpt-web', label: 'ChatGPT' },
  { id: 'perplexity-web', label: 'Perplexity' },
  { id: 'gemini-web', label: 'Gemini' },
  { id: 'google-aio', label: 'Google AI Overviews' },
];

describe('buildPositionCell', () => {
  test('averages positions over mentioning answers across platforms, like the panel', () => {
    const cell = buildPositionCell(
      [
        row('chatgpt-web', { positionSum: 2, positionCount: 2 }), // #1, #1
        row('perplexity-web', { positionSum: 8, positionCount: 2 }), // #4, #4
      ],
      [],
      platforms,
    );
    expect(cell.avg).toBe(2.5);
    expect(cell.delta).toBeNull();
  });

  test('ignores platforms outside the plan-included list', () => {
    const cell = buildPositionCell(
      [
        row('chatgpt-web', { positionSum: 1, positionCount: 1 }),
        row('grok-web', { positionSum: 9, positionCount: 1 }),
      ],
      [],
      platforms,
    );
    expect(cell.avg).toBe(1);
    expect(cell.dots.map((d) => d.id)).not.toContain('grok-web');
  });

  test('delta is previous minus current: positive when the brand moved up', () => {
    const better = buildPositionCell(
      [row('chatgpt-web', { positionSum: 3, positionCount: 2 })], // #1.5
      [row('chatgpt-web', { positionSum: 4, positionCount: 2 })], // #2.0
      platforms,
    );
    expect(better.delta).toBe(0.5);
    const worse = buildPositionCell(
      [row('chatgpt-web', { positionSum: 6, positionCount: 2 })],
      [row('chatgpt-web', { positionSum: 4, positionCount: 2 })],
      platforms,
    );
    expect(worse.delta).toBe(-1);
  });

  test('a dot per platform: early, late, mentioned without position, missing, no runs', () => {
    const cell = buildPositionCell(
      [
        row('chatgpt-web', { positionSum: 1, positionCount: 1, entitySum: 5, entityCount: 1 }),
        row('perplexity-web', { positionSum: 5, positionCount: 1, entitySum: 5, entityCount: 1 }),
        row('gemini-web', { positionSum: 0, positionCount: 0 }),
        row('google-aio', { mentionAnswers: 0, positionSum: 0, positionCount: 0 }),
      ],
      [],
      [...platforms, { id: 'copilot-web', label: 'Microsoft Copilot' }],
    );
    expect(cell.dots.map((d) => [d.id, d.state])).toEqual([
      ['chatgpt-web', 'early'],
      ['perplexity-web', 'late'],
      ['gemini-web', 'mentioned'],
      ['google-aio', 'missing'],
      ['copilot-web', 'no_runs'],
    ]);
    expect(cell.lateOrMissing).toBe(true);
  });

  test('mentioned in under half the runs is missing, like the Improve tab, however high it ranked', () => {
    // #1 in 8 of 120 answers: the Improve tab calls this "Not mentioned".
    const cell = buildPositionCell(
      [
        row('chatgpt-web', {
          runs: 120,
          mentionAnswers: 8,
          positionSum: 8,
          positionCount: 8,
          entitySum: 40,
          entityCount: 8,
        }),
      ],
      [],
      platforms.slice(0, 1),
    );
    expect(cell.dots).toEqual([
      {
        id: 'chatgpt-web',
        label: 'ChatGPT',
        state: 'missing',
        avg: null,
        runs: 120,
        mentionedRuns: 8,
      },
    ]);
    expect(cell.lateOrMissing).toBe(true);
    // The average stays the Positions panel's.
    expect(cell.avg).toBe(1);
  });

  test('mentioned in exactly half the runs counts as mentioned', () => {
    const cell = buildPositionCell(
      [row('chatgpt-web', { runs: 4, mentionAnswers: 2, positionSum: 2, positionCount: 2 })],
      [],
      platforms.slice(0, 1),
    );
    expect(cell.dots[0].state).toBe('early');
    expect(cell.lateOrMissing).toBe(false);
  });

  test('not late or missing when every tracked platform is early or has no runs', () => {
    const cell = buildPositionCell(
      [row('chatgpt-web', { positionSum: 1, positionCount: 1 })],
      [],
      platforms.slice(0, 2),
    );
    expect(cell.lateOrMissing).toBe(false);
  });
});

describe('compareLateness', () => {
  const cell = (avg: number | null, states: PlatformDotState[]): PromptPositionCell => ({
    avg,
    delta: null,
    dots: states.map((state, i) => ({
      id: `p${i}`,
      label: `P${i}`,
      state,
      avg: null,
      runs: 4,
      mentionedRuns: 0,
    })),
    lateOrMissing: states.some((s) => s === 'late' || s === 'missing'),
  });
  const order = (cells: Record<string, PromptPositionCell | undefined>) =>
    Object.keys(cells).sort((a, b) => compareLateness(cells[a], cells[b]));

  test('puts the prompt late or missing on the most platforms first', () => {
    expect(
      order({
        one: cell(1.5, ['early', 'missing', 'early']),
        three: cell(2, ['late', 'missing', 'missing']),
        two: cell(3, ['late', 'missing', 'early']),
      }),
    ).toEqual(['three', 'two', 'one']);
  });

  test('then the one missing on more of them, then the worse average', () => {
    expect(
      order({
        lateTwice: cell(4, ['late', 'late']),
        missingTwice: cell(2, ['missing', 'missing']),
        missingOnceAt3: cell(3, ['missing', 'late']),
        missingOnceAt5: cell(5, ['missing', 'late']),
      }),
    ).toEqual(['missingTwice', 'missingOnceAt5', 'missingOnceAt3', 'lateTwice']);
  });

  test('counts a prompt never ranked as the furthest back, and one without a cell last', () => {
    expect(
      order({
        none: undefined,
        ranked: cell(6, ['missing']),
        neverRanked: cell(null, ['missing']),
      }),
    ).toEqual(['neverRanked', 'ranked', 'none']);
  });
});

describe('previousWindow', () => {
  test('is the same length, ending where the window starts', () => {
    expect(
      previousWindow({ from: '2026-10-08T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z' }),
    ).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' });
  });

  test('an open window ends now', () => {
    const now = Date.parse('2026-10-13T00:00:00.000Z');
    expect(previousWindow({ from: '2026-10-06T00:00:00.000Z' }, now)).toEqual({
      from: '2026-09-29T00:00:00.000Z',
      to: '2026-10-06T00:00:00.000Z',
    });
  });
});
