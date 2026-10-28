import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "+ Track" on a People Also Ask question (PROMPT-014): the question is
 * tracked once. A brand that already tracks the same text (case, accents,
 * punctuation and spacing aside) gets nothing added.
 */

let brandPrompts: { text: string }[] = [];
let pages: [number, number][] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      expect(table).toBe('prompts');
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async (from: number, to: number) => {
          pages.push([from, to]);
          return { data: brandPrompts.slice(from, to + 1), error: null };
        },
      };
      return chain;
    },
  })),
}));

const trackPagePrompts = vi.fn();
vi.mock('@/lib/actions/prompt-suggestions', () => ({
  trackPagePrompts: (...args: unknown[]) => trackPagePrompts(...args),
}));

const { trackDemandQuestion } = await import('./prompt-demand-signals');

beforeEach(() => {
  brandPrompts = [{ text: 'What is the best AI search monitoring tool?' }];
  pages = [];
  trackPagePrompts.mockReset().mockResolvedValue({ promptIds: ['n1'] });
});

describe('trackDemandQuestion', () => {
  it('tracks a question the brand has no prompt for, in its topic', async () => {
    expect(
      await trackDemandQuestion('b1', ' How do I track my brand in ChatGPT? ', 'Monitoring'),
    ).toEqual({
      promptIds: ['n1'],
    });
    expect(trackPagePrompts).toHaveBeenCalledWith('b1', null, [
      { text: 'How do I track my brand in ChatGPT?', topic: 'Monitoring' },
    ]);
  });

  it('adds nothing a second time for the same text, however it is written', async () => {
    brandPrompts.push({ text: 'how do i track my brand in chatgpt' });
    expect(
      await trackDemandQuestion('b1', 'How do I track my brand in ChatGPT?', 'Monitoring'),
    ).toEqual({
      promptIds: [],
      alreadyTracked: true,
    });
    expect(trackPagePrompts).not.toHaveBeenCalled();
  });

  it("reads every page of the brand's prompts", async () => {
    brandPrompts = Array.from({ length: 1000 }, (_, i) => ({ text: `prompt ${i}` }));
    brandPrompts.push({ text: 'How do I track my brand in ChatGPT' });
    expect(await trackDemandQuestion('b1', 'How do I track my brand in ChatGPT?', 'x')).toEqual({
      promptIds: [],
      alreadyTracked: true,
    });
    expect(pages).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('asks for a question', async () => {
    expect(await trackDemandQuestion('b1', '  ', 'x')).toEqual({
      promptIds: [],
      error: 'Pick a question.',
    });
    expect(trackPagePrompts).not.toHaveBeenCalled();
  });
});
