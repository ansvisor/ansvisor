import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { livePageLine, livePageSummary } = await import('./content-live-page.js');

/**
 * How the live page does now, as the Content Agent is told (learning B5):
 * what it earns as it reads, and the prompts it lost.
 */
const impact = {
  citations: { cur: 12, prev: 20 },
  aiVisits: { cur: 35, prev: 40 },
  promptCounts: { cur: 4, prev: 6, lost: 2 },
  prompts: [
    { text: 'best pour over kettle', cur: 5, prev: 6 },
    { text: 'how long to brew pour over', cur: 0, prev: 2 },
    { text: 'pour over vs french press', cur: 0, prev: 4 },
  ],
};

describe('livePageSummary', () => {
  it('reads the numbers and the lost prompts, the most cited before first', () => {
    expect(livePageSummary(impact)).toEqual({
      days: 30,
      citations: { cur: 12, prev: 20 },
      prompts: { cur: 4, lost: 2 },
      lostPrompts: ['pour over vs french press', 'how long to brew pour over'],
      aiVisits: { cur: 35, prev: 40 },
    });
  });

  it('tells nothing of a page neither cited nor visited from AI', () => {
    expect(
      livePageSummary({ citations: { cur: 0, prev: 0 }, aiVisits: { cur: 0, prev: 0 } }),
    ).toBeNull();
    expect(livePageSummary(null)).toBeNull();
  });
});

describe('livePageLine', () => {
  it('says what the page earns, and asks to keep it and answer what it lost', () => {
    const line = livePageLine(livePageSummary(impact));
    expect(line).toContain(
      'tracked AI answers cited it 12 times (20 before), for 4 prompts, and it had 35 AI visits (40 before). It lost 2 prompts it was cited for: "pour over vs french press", "how long to brew pour over".',
    );
    expect(line).toContain('keep the answers, facts and names AI engines may cite from it');
    expect(line).toContain("answer a lost prompt's question");
  });

  it('asks nothing about lost prompts when none was lost', () => {
    const line = livePageLine(
      livePageSummary({ ...impact, promptCounts: { cur: 1, lost: 0 }, prompts: [] }),
    );
    expect(line).toContain('for 1 prompt,');
    expect(line).not.toContain('lost');
    expect(livePageLine(null)).toBe('');
  });
});
