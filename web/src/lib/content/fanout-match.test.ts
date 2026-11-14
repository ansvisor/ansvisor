import { describe, expect, it } from 'vitest';
import { carriesFanout } from './fanout-match';

describe('carriesFanout', () => {
  it('meets the headings and questions people accept for a fan-out', () => {
    const pairs = [
      ['how to measure ai overviews in search console', 'Measuring AI Overviews in Search Console'],
      // From here on, each was missed before: "measuring" ≠ "measure", "AI" dropped.
      ['how to measure ai overviews', 'Measuring AI Overviews'],
      ['is ai search replacing google', 'Will AI search replace Google?'],
      ['using chatgpt for seo', 'How to Use ChatGPT for SEO'],
      ['content strategy for saas', 'SaaS Content Strategies'],
      ['track ai visibility in ga4', 'Tracking AI Visibility in GA4'],
      // Three key words: all but one.
      ['aeo vs seo differences', 'AEO vs SEO: what is different?'],
    ];
    for (const [fanout, heading] of pairs) {
      expect(carriesFanout(fanout, heading), `${fanout} → ${heading}`).toBe(true);
    }
  });

  it('never meets an unrelated heading, or one with a fan-out’s words but two', () => {
    const fanout = 'how to measure ai overviews in search console';
    expect(carriesFanout(fanout, 'Pricing and plans')).toBe(false);
    expect(carriesFanout(fanout, 'AI Overviews pricing')).toBe(false);
    expect(carriesFanout('home espresso grinder', 'Best espresso machines under $500')).toBe(false);
    // An acronym the fan-out writes in capitals is one of its words.
    expect(carriesFanout('UX audit', 'Audit checklist')).toBe(false);
    expect(carriesFanout('the and of', 'The and of')).toBe(false);
  });
});
