import { describe, expect, it } from 'vitest';
import type { CompetitorComparisonData, VisibilityRateTrendData } from '@/lib/actions/tracking';
import { summaryContext, summaryFacts, summaryText, type SummaryInput } from './summary-format';

// en.json's insights.summary / insights.compare, enough to read the output.
const messages: Record<string, string> = {
  visibility: 'visibility',
  rank: '#{rank}',
  ofCount: 'of {count}',
  pts: '{value} pts',
  behind: 'behind {name}',
  ahead: 'ahead of {name}',
  tied: 'tied with {name}',
  upMost: 'Up most:',
  downMost: 'Down most:',
  vs: 'vs {from} – {to}',
  newExcluded: '{count} new prompts excluded',
  newIncluded: 'includes {count} new prompts',
};
const t = (key: string, values: Record<string, string | number> = {}) =>
  messages[key].replace(/\{(\w+)\}/g, (_, k) => String(values[k]));

const trend = (rate: number, change: number | null) =>
  ({
    entities: [],
    points: [],
    summary: { rate, prevRate: null, change, prevFrom: '2026-08-14', prevTo: '2026-09-12' },
    pinned: [],
  }) as VisibilityRateTrendData;

const leaderboard = (...brands: [string, number, boolean?][]) =>
  ({
    providerRows: [],
    brands: brands.map(([name, score, own]) => ({ name, score, isOwnBrand: !!own })),
  }) as unknown as CompetitorComparisonData;

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  trend: trend(17.4, 1.5),
  competitors: leaderboard(['Semrush', 36.3], ['Peec AI', 18.3], ['Ansvisor', 17.4, true]),
  comparison: { basis: 'same', samePrompts: 200, newPrompts: 509, droppedPrompts: 0 },
  platformChanges: [
    { name: 'Google AI Mode', cur: 21, prev: 4.9, change: 16.1 },
    { name: 'Gemini', cur: 24.8, prev: 22.4, change: 2.4 },
    { name: 'ChatGPT', cur: 8.1, prev: 11.3, change: -3.2 },
  ],
  ...over,
});

describe('summary line', () => {
  it('reads like the mockup, on screen and when copied', () => {
    const facts = summaryFacts(input(), t);
    const context = summaryContext(input(), t, t);

    expect(summaryText(facts, context)).toBe(
      '17.4 visibility +1.5 · #3 of 3 · 0.9 pts behind Peec AI · Up most: Google AI Mode +16.1 · ' +
        'Down most: ChatGPT −3.2 · vs Aug 14, 2026 – Sep 12, 2026 · 509 new prompts excluded',
    );
    // The change and the movers carry their tone for the screen.
    expect(facts[0].parts[2]).toEqual({ text: '+1.5', tone: 'good' });
    expect(facts[3].parts[2]).toEqual({ text: '−3.2', tone: 'bad' });
  });

  it('says ahead when first and tied when level', () => {
    const first = summaryFacts(
      input({ competitors: leaderboard(['Ansvisor', 20, true], ['B', 18.5]) }),
      t,
    );
    const tied = summaryFacts(
      input({ competitors: leaderboard(['Ansvisor', 20, true], ['B', 20]) }),
      t,
    );

    expect(summaryText([first[1]], null)).toBe('#1 of 2 · 1.5 pts ahead of B');
    expect(summaryText([tied[1]], null)).toBe('#1 of 2 · tied with B');
  });

  it('leaves out what it has no data for, never showing a made-up 0', () => {
    const facts = summaryFacts(
      input({ trend: null, competitors: null, platformChanges: null, comparison: null }),
      t,
    );

    expect(facts).toEqual([]);
    expect(summaryContext(input({ trend: trend(17.4, null), comparison: null }), t, t)).toBeNull();
  });

  it('says the change includes new prompts when Same prompts is off', () => {
    const context = summaryContext(
      input({ comparison: { basis: 'all', samePrompts: 200, newPrompts: 509, droppedPrompts: 0 } }),
      t,
      t,
    );

    expect(context).toBe('vs Aug 14, 2026 – Sep 12, 2026 · includes 509 new prompts');
  });
});
