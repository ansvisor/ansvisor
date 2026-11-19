import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: { from: vi.fn() } }));
const { opportunityKeywords, sameTitleAs, titleOverlap, trackedEngineNames, untrackedEngines } =
  await import('./opportunity-quality.js');

/** Opportunities the model wrote, kept to what the brand tracks and has open (Content test 2026-11-19). */

describe('untrackedEngines (item 15)', () => {
  const tracked = new Set(['chatgpt-web', 'gemini-web', 'google-aio']);

  it('names the engines an opportunity is about that the brand doesn’t track', () => {
    expect(untrackedEngines('Analytics setup for Perplexity and Gemini', tracked)).toEqual([
      'Perplexity',
    ]);
    expect(untrackedEngines('Win citations in Microsoft Copilot answers', tracked)).toEqual([
      'Microsoft Copilot',
    ]);
  });

  it('finds none for tracked engines, none named, or tracking not known', () => {
    expect(untrackedEngines('Track ChatGPT, Gemini and Google AI Overviews', tracked)).toEqual([]);
    expect(untrackedEngines('Best AI SEO tools for agencies', tracked)).toEqual([]);
    expect(untrackedEngines('Analytics setup for Perplexity', null)).toEqual([]);
  });

  it('tells the model the tracked engines by name', () => {
    expect(trackedEngineNames(tracked)).toEqual(['ChatGPT', 'Google AI Overviews', 'Gemini']);
    expect(trackedEngineNames(null)).toEqual([]);
  });
});

describe('sameTitleAs (item 15)', () => {
  const open = [
    'Track brand mentions across ChatGPT, Gemini and Google AI Overviews',
    'Best AI SEO tools for 2026',
  ];

  it('finds the open opportunity a new title repeats in other words', () => {
    expect(
      sameTitleAs('How to track brand mentions in ChatGPT, Gemini and Google AI Overviews', open),
    ).toBe(open[0]);
    expect(sameTitleAs('The definitive list of the best AI SEO tools', open)).toBe(open[1]);
  });

  it('lets a different need through, however many words it shares', () => {
    expect(sameTitleAs('Best open source AI SEO tools you can self-host', open)).toBeNull();
    expect(sameTitleAs('Profound alternatives for agencies', open)).toBeNull();
    expect(titleOverlap('SEO', 'SEO tools')).toBe(0);
    expect(titleOverlap('Best AI SEO tools', 'Open source AI SEO tools')).toBeLessThan(0.75);
  });
});

describe('opportunityKeywords (item 16)', () => {
  it('keeps the keyword tool’s keywords its prompts share, then its fan-outs', () => {
    expect(
      opportunityKeywords({
        // The test's "Profound alternatives" keywords: none about it.
        keywords: ['ai search engine', 'search engine', 'generative ai', 'chatbot', 'ai software'],
        prompts: ['What are the best alternatives to Profound for AI visibility tracking?'],
        queries: [
          'profound alternatives',
          'profound vs otterly vs peec ai',
          'ai visibility tracking tools for agencies compared side by side in 2026',
        ],
      }),
    ).toEqual(['profound alternatives', 'profound vs otterly vs peec ai']);
  });

  it('keeps a keyword its prompts share words with, once', () => {
    expect(
      opportunityKeywords({
        keywords: ['AI visibility tracking', 'ai visibility tracking', 'chatbot'],
        prompts: ['Which AI visibility tracking tool should a startup use?'],
        queries: [],
      }),
    ).toEqual(['ai visibility tracking']);
  });

  it('keeps at most eight', () => {
    const queries = Array.from({ length: 12 }, (_, i) => `query ${i}`);
    expect(opportunityKeywords({ queries })).toHaveLength(8);
  });
});
