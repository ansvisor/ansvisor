import { describe, expect, it } from 'vitest';
import { candidatePages, resolveDecision, tokens } from './page-matching.js';

describe('tokens', () => {
  it('keeps meaningful words, folds plain plurals and handles any script', () => {
    expect(tokens('The BEST AI rank trackers for 2026')).toEqual(['rank', 'tracker']);
    expect(tokens('Yapay zekâ görünürlüğü araçları')).toEqual([
      'yapay',
      'zekâ',
      'görünürlüğü',
      'araçları',
    ]);
    expect(tokens('class process')).toEqual(['class', 'process']);
  });
});

describe('candidatePages', () => {
  const pages = [
    {
      url: 'https://example.com/blog/best-ai-rank-tracker-tools',
      title: 'Best AI Rank Tracker Tools',
      description: 'Compare rank trackers for AI search.',
    },
    {
      url: 'https://example.com/blog/google-ai-overviews-tracking',
      title: 'How to Track Google AI Overviews',
      description: 'Monitor rankings in AI Overviews.',
    },
    { url: 'https://example.com/pricing', title: 'Pricing', description: 'Plans for every team.' },
    {
      url: 'https://example.com/blog/rank',
      title: 'Rank',
      description: 'A page that shares one word.',
    },
  ];

  it('ranks pages by the rarer words they share with the need', () => {
    const found = candidatePages('Which AI rank tracker tools are most accurate?', pages);
    expect(found.map((p) => p.url)).toEqual([
      'https://example.com/blog/best-ai-rank-tracker-tools',
    ]);
  });

  it('needs two shared words, so one common word does not pull a page in', () => {
    expect(candidatePages('pricing', pages)).toEqual([]);
  });

  it('keeps at most the limit', () => {
    expect(candidatePages('track rank google overviews tracker tools', pages, 1)).toHaveLength(1);
  });
});

describe('resolveDecision', () => {
  const candidates = [{ url: 'a' }, { url: 'b' }];

  it('keeps a decision its pages support', () => {
    expect(resolveDecision('expand', [1, 1, 9], candidates)).toEqual({
      decision: 'expand',
      pages: [{ url: 'b' }],
    });
    expect(resolveDecision('consolidate', [0, 1], candidates).decision).toBe('consolidate');
  });

  it('falls back when the pages are missing', () => {
    expect(resolveDecision('optimize', [], candidates)).toEqual({ decision: 'create', pages: [] });
    expect(resolveDecision('consolidate', [0], candidates).decision).toBe('optimize');
    expect(resolveDecision('create', [0], candidates)).toEqual({ decision: 'create', pages: [] });
    expect(resolveDecision('rewrite', [0], candidates).decision).toBe('create');
  });
});
