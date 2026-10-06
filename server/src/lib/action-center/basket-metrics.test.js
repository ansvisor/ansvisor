import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { BASKET_KPIS, basketValues, pageScope } = await import('./basket-metrics.js');

describe('pageScope', () => {
  it('turns page URLs into citation keys, hosts and GA paths', () => {
    expect(
      pageScope([
        'https://www.Example.com/Blog/Post/?utm=x#top',
        'https://docs.example.com/',
        'not a url',
      ]),
    ).toEqual({
      keys: ['example.com/blog/post', 'docs.example.com'],
      domains: ['example.com', 'docs.example.com'],
      paths: ['/Blog/Post', '/'],
    });
  });
});

describe('basketValues', () => {
  const raw = {
    cells: 40,
    visible: 10,
    mention_answers: 12,
    competitor_visible_total: 30,
    top_competitor_visible: 20,
    page_citations: 7,
    ga_connected: true,
    page_ai_sessions: 55,
  };

  it('measures the basket', () => {
    expect(basketValues(raw, { pageCount: 2 })).toEqual({
      ai_visibility: 25,
      share_of_voice: 25,
      // 25% against the strongest competitor's 50%.
      competitor_lead: -25,
      mentions: 12,
      citations: 7,
      ai_referral_traffic: 55,
    });
  });

  it('leaves unanswerable metrics unmeasured instead of zero', () => {
    const none = basketValues(
      { ...raw, cells: 0, visible: 0, competitor_visible_total: 0 },
      {
        pageCount: 0,
      },
    );
    expect(Object.values(none).every((v) => v === null)).toBe(true);
    expect(
      basketValues({ ...raw, ga_connected: false }, { pageCount: 2 }).ai_referral_traffic,
    ).toBe(null);
  });

  it('covers every basket KPI', () => {
    expect(Object.keys(basketValues(raw, { pageCount: 1 })).sort()).toEqual(
      Object.keys(BASKET_KPIS).sort(),
    );
  });
});
