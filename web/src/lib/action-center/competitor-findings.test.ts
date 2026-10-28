import { describe, expect, it } from 'vitest';
import { parseCompetitorFindings } from './competitor-findings';

/** What Analyze competitor content stored (learning C1), read defensively. */
describe('parseCompetitorFindings', () => {
  it('reads the pages, the brand page and the gaps', () => {
    expect(
      parseCompetitorFindings({
        competitorPages: [
          {
            url: 'https://rival.com/kettles',
            domain: 'rival.com',
            cited: 4,
            words: 1200,
            passes: ['faq-schema', 3],
          },
          { url: 'javascript:alert(1)', cited: 1 },
        ],
        yourPage: { url: 'https://acme.com/kettles', cited: 1, words: null, passes: [] },
        gaps: [
          { key: 'faq-schema', label: 'FAQ schema', competitors: 2, of: 3 },
          { key: 'tables', competitors: 1, of: 0 },
        ],
        capped: 1,
        unreadable: 0,
      }),
    ).toEqual({
      competitorPages: [
        {
          url: 'https://rival.com/kettles',
          domain: 'rival.com',
          cited: 4,
          words: 1200,
          passes: ['faq-schema'],
        },
      ],
      yourPage: {
        url: 'https://acme.com/kettles',
        domain: null,
        cited: 1,
        words: null,
        passes: [],
      },
      gaps: [{ key: 'faq-schema', label: 'FAQ schema', competitors: 2, of: 3 }],
      capped: 1,
      unreadable: 0,
      reason: null,
    });
  });

  it("reads why nothing was compared, and nothing from another tool's output", () => {
    expect(
      parseCompetitorFindings({
        competitorPages: [],
        yourPage: null,
        gaps: [],
        reason: 'none_cited',
      })?.reason,
    ).toBe('none_cited');
    expect(parseCompetitorFindings({ answers: 100 })).toBeNull();
    expect(parseCompetitorFindings(null)).toBeNull();
  });
});
