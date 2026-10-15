import { describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

const {
  improveBaseline,
  improveGoal,
  improveImpact,
  improveKpiKeys,
  improvePages,
  improveTaskRows,
  improveWhy,
  volumeTier,
} = await import('./from-prompt-improve.js');

const P = (id, state, extra = {}) => ({ id, state, ...extra });

describe('volumeTier', () => {
  it('splits estimated monthly AI searches at 100 and 1,000', () => {
    expect(volumeTier(null)).toBe(0);
    expect(volumeTier(99)).toBe(0);
    expect(volumeTier(100)).toBe(1);
    expect(volumeTier(999)).toBe(1);
    expect(volumeTier(1000)).toBe(2);
  });
});

describe('improveImpact', () => {
  it('is high with demand and a real gap', () => {
    expect(improveImpact([P('chatgpt-web', 'not_mentioned')], 5000)).toBe('high');
    expect(
      improveImpact([P('perplexity-web', 'not_mentioned'), P('google-aio', 'not_cited')], 300),
    ).toBe('high');
  });

  it('is low for a small gap without high demand', () => {
    expect(improveImpact([P('google-aio', 'not_cited')], 50)).toBe('low');
    expect(improveImpact([P('google-aio', 'not_cited')], null)).toBe('low');
  });

  it('is medium otherwise', () => {
    expect(improveImpact([P('chatgpt-web', 'mentioned_late')], 300)).toBe('medium');
    expect(improveImpact([P('chatgpt-web', 'not_mentioned')], null)).toBe('medium');
    expect(improveImpact([P('google-aio', 'not_cited')], 2000)).toBe('medium');
  });
});

describe('improveWhy / improveGoal', () => {
  const platforms = [
    P('perplexity-web', 'not_mentioned'),
    P('gemini-web', 'not_mentioned'),
    P('chatgpt-web', 'mentioned_late', { mentionPosition: 3.4 }),
    P('google-aio', 'not_cited'),
  ];

  it('describes each platform state in one sentence', () => {
    expect(improveWhy(platforms)).toBe(
      'Not mentioned on Perplexity and Gemini; mentioned late (avg #3.4) on ChatGPT; mentioned early but not cited on Google AI Overviews.',
    );
  });

  it('starts with a capital when the brand is mentioned everywhere', () => {
    expect(improveWhy([P('google-aio', 'not_cited')])).toBe(
      'Mentioned early but not cited on Google AI Overviews.',
    );
  });

  it('names the prompt and the platforms in the goal', () => {
    expect(improveGoal('best coffee', platforms.slice(0, 2))).toBe(
      'Get the brand mentioned early and cited for "best coffee" on Perplexity and Gemini.',
    );
  });
});

describe('improveBaseline', () => {
  it('keeps the 7-day read per platform at send time, with its window', () => {
    const window = { from: '2026-10-06T10:00:00.000Z', to: '2026-10-13T10:00:00.000Z' };
    const snapshot = {
      platform: 'chatgpt-web',
      state: 'mentioned_late',
      runs: 8,
      mentionedRuns: 8,
      citedRuns: 0,
      mentionPosition: 3.4,
      citationRank: null,
    };
    expect(improveBaseline([snapshot], '2026-10-13T10:00:00.000Z', window)).toEqual({
      capturedAt: '2026-10-13T10:00:00.000Z',
      window,
      platforms: [snapshot],
    });
  });
});

describe('improveTaskRows', () => {
  it('makes one human task per suggestion with its text exactly as edited', () => {
    const rows = improveTaskRows('a1', [
      {
        id: 'perplexity-web:0',
        platform: 'perplexity-web',
        title: 'Edited title',
        body: 'Edited body',
        sources: [{ type: 'fanout', ref: 'q' }],
      },
      { id: 'own:1', platform: 'chatgpt-web', title: 'My own idea', body: '', sources: [] },
    ]);
    expect(rows).toEqual([
      {
        action_id: 'a1',
        position: 1,
        task_key: null,
        title: 'Edited title',
        status: 'todo',
        mode: 'human',
        permission: 'read',
        details: {
          body: 'Edited body',
          platform: 'perplexity-web',
          platformLabel: 'Perplexity',
          sources: [{ type: 'fanout', ref: 'q' }],
        },
      },
      expect.objectContaining({
        position: 2,
        title: 'My own idea',
        details: { body: '', platform: 'chatgpt-web', platformLabel: 'ChatGPT', sources: [] },
      }),
    ]);
  });
});

describe('improvePages', () => {
  it('collects the brand pages the suggestions name, once each', () => {
    const suggestions = [
      {
        sources: [
          { type: 'brand_page', ref: 'https://acme.com/plans' },
          { type: 'fanout', ref: 'best coffee subscription' },
        ],
      },
      { sources: [{ type: 'brand_page', ref: 'https://acme.com/plans' }] },
      { sources: [{ type: 'competitor_url', ref: 'https://rival.com/x' }] },
      {},
    ];
    expect(improvePages(suggestions)).toEqual(['https://acme.com/plans']);
  });
});

describe('improveKpiKeys', () => {
  it('measures citations only when the action names brand pages', () => {
    expect(improveKpiKeys(['https://acme.com/plans'])).toContain('citations');
    expect(improveKpiKeys([])).toEqual(['ai_visibility', 'mentions']);
  });
});
