import { describe, expect, it } from 'vitest';
import { SINCE_MAX_DAYS, sinceMoves, sincePeriods, type SinceCell } from './since';

/**
 * Chat Home's "Since you left" (CHAT-22 §1): the days since the person last
 * left Home against as many before, and per engine the biggest citation drop
 * and win beyond normal swing.
 */

const NOW = Date.parse('2026-10-31T09:00:00Z');

describe('sincePeriods', () => {
  it('counts from the day Home was left to yesterday, against as many days before', () => {
    expect(sincePeriods('2026-10-19T15:20:00Z', NOW)).toEqual({
      a: { from: '2026-10-07', to: '2026-10-18' },
      b: { from: '2026-10-19', to: '2026-10-30' },
    });
    expect(sincePeriods('2026-10-30T23:00:00Z', NOW)).toEqual({
      a: { from: '2026-10-29', to: '2026-10-29' },
      b: { from: '2026-10-30', to: '2026-10-30' },
    });
  });

  it('has nothing until a whole day passed, or for a time that isn’t one', () => {
    expect(sincePeriods('2026-10-31T01:00:00Z', NOW)).toBeNull();
    expect(sincePeriods('not a date', NOW)).toBeNull();
  });

  it(`counts ${SINCE_MAX_DAYS} days at most`, () => {
    expect(sincePeriods('2026-01-01T00:00:00Z', NOW)).toEqual({
      a: { from: '2026-09-01', to: '2026-09-30' },
      b: { from: '2026-10-01', to: '2026-10-30' },
    });
  });
});

const cells = (engine: string, a: [number, number], b: [number, number]): SinceCell[] => [
  { engine, period: 'a', answers: a[0], citationAnswers: a[1] },
  { engine, period: 'b', answers: b[0], citationAnswers: b[1] },
];

describe('sinceMoves', () => {
  it('gives the engine whose citations fell most and the one whose rose most', () => {
    expect(
      sinceMoves([
        ...cells('google-aio', [200, 60], [200, 40]),
        ...cells('gpt-5', [200, 30], [200, 50]),
        ...cells('perplexity', [200, 50], [200, 30]),
        // Two prompts of one engine add up.
        ...cells('perplexity', [100, 10], [100, 5]),
      ]),
    ).toEqual({
      drop: { engine: 'perplexity', before: 60, now: 35 },
      win: { engine: 'gpt-5', before: 30, now: 50 },
    });
  });

  it('leaves out a change within normal swing, and one only fewer runs made', () => {
    expect(
      sinceMoves([
        ...cells('google-aio', [200, 60], [200, 57]),
        // Half the runs, the same rate: fewer citations, no drop.
        ...cells('gpt-5', [200, 40], [100, 20]),
      ]),
    ).toEqual({ drop: null, win: null });
  });

  it('leaves out an engine tracked in only one period', () => {
    expect(
      sinceMoves([
        { engine: 'grok', period: 'b', answers: 200, citationAnswers: 50 },
        { engine: 'gemini', period: 'a', answers: 200, citationAnswers: 50 },
      ]),
    ).toEqual({ drop: null, win: null });
  });
});
