import { describe, expect, it } from 'vitest';
import type { HeadToHeadGroup, ScoreParts } from '@/lib/head-to-head';
import { engineCount, engineRows, lowSample } from './prompt-engines';

const parts = (answers: number, mentionAnswers: number): ScoreParts => ({
  answers,
  mentionAnswers,
  citationAnswers: 0,
  invPosition: 0,
  positionCount: 0,
});

const group = (
  platform: string,
  region: string | undefined,
  runs: number,
  modelUsed = '',
): HeadToHeadGroup => ({
  promptId: 'p1',
  promptText: 'Best CRM',
  platform,
  rawPlatform: platform.toLowerCase(),
  modelUsed,
  rawModelUsed: modelUsed || null,
  region,
  runs,
  brandScore: 0,
  competitorScore: 0,
  diff: 0,
  latestAt: '2026-11-19T10:00:00Z',
  parts: { brand: parts(runs, runs), competitor: parts(runs, 0) },
});

describe('a prompt by engine, its locations under each (UX audit CP-05)', () => {
  const groups = [
    group('Google AI Mode', 'TR-ISTANBUL', 1),
    group('ChatGPT', 'US', 85, 'gpt-5'),
    group('ChatGPT', 'US', 12, 'gpt-4o'),
    group('ChatGPT', 'GB', 20, 'gpt-5'),
    group('Gemini', undefined, 30),
  ];

  it('counts engines, not engine, model and location combinations', () => {
    expect(engineCount(groups)).toBe(3);
  });

  it('lists each engine once, most runs first, with its locations by name', () => {
    const { engines, twice } = engineRows(groups);
    expect(engines.map((e) => [e.platform, e.runs, e.locations])).toEqual([
      ['ChatGPT', 117, 2],
      ['Gemini', 30, 1],
      ['Google AI Mode', 1, 1],
    ]);
    expect(engines[0].rows.map((r) => `${r.region}·${r.modelUsed}`)).toEqual([
      'GB·gpt-5',
      'US·gpt-4o',
      'US·gpt-5',
    ]);
    // US shows twice under ChatGPT (two models): those rows name their model.
    expect([...twice].map((r) => r.modelUsed).sort()).toEqual(['gpt-4o', 'gpt-5']);
    expect(engines[0].brandScore).toBeGreaterThan(engines[0].competitorScore);
  });

  it('flags fewer than 10 runs as a low sample (D8)', () => {
    expect(lowSample(1)).toBe(true);
    expect(lowSample(9)).toBe(true);
    expect(lowSample(10)).toBe(false);
  });
});
