import { describe, expect, it } from 'vitest';
import { pulseMessage } from './pulse.js';

/**
 * The Daily Pulse in Slack (#2139): the e-mail's numbers, highlights and
 * warnings in Block Kit, with the links to Visibility and the Pulse's
 * settings; Slack's markup escaped, lists capped.
 */

const METRICS = {
  windowDays: 1,
  kpis: {
    totalResults: 120,
    visibilityRate: 34,
    weekRate: 31.2,
    weekTrend: -2.14,
    mentions: 182,
    mentionsChange: 6,
    citations: 47,
    citationsChange: -4,
    sentimentPct: 71,
    sentimentChange: null,
    visiblePrompts: 17,
    promptCount: 50,
  },
  highlights: [
    {
      type: 'first_citation',
      url: 'https://northwind.test/pricing',
      label: 'northwind.test/pricing',
      promptText: 'best crm for <startups>',
    },
    { type: 'prompt_gain', promptText: 'crm & invoicing', gain: 3 },
    { type: 'competitor_overtaken', competitorName: 'Contoso', brandRate: 34, competitorRate: 30 },
    { type: 'new_engine', platform: 'perplexity-web' },
    { type: 'something_new' },
  ],
  warnings: [{ type: 'competitor_surge', competitorName: 'Fabrikam', from: 10, to: 22 }],
  degradedPlatforms: [],
};
const URLS = {
  insightsUrl: 'https://app.test/dashboard/insights',
  settingsUrl: 'https://app.test/dashboard/settings?tab=notifications',
};

const textOf = (blocks) => JSON.stringify(blocks);

describe('pulseMessage', () => {
  it("says the day's numbers, highlights and warnings, with its links", () => {
    const { text, blocks } = pulseMessage({ brandName: 'Northwind', metrics: METRICS, ...URLS });
    expect(text).toBe('Northwind Daily Pulse: visibility 34 (-2.1 pts this week)');
    expect(blocks[0]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: 'Daily Pulse · Northwind' },
    });
    expect(blocks[1].elements[0].text).toBe(
      'How Northwind showed up in AI answers over the last 24 hours.',
    );
    expect(blocks[2].fields.map((f) => f.text)).toEqual([
      '*Visibility*\n34',
      '*7-day trend*\n31.2 ▼ -2.1',
      '*Mentions*\n182 ▲ +6',
      '*Citations*\n47 ▼ -4',
      '*Positive sentiment*\n71%',
      '*Prompts you appear in*\n17/50',
    ]);
    expect(blocks[3].text.text).toBe(
      [
        '*Highlights*',
        '• First citation for <https://northwind.test/pricing|northwind.test/pricing> — “best crm for &lt;startups&gt;”',
        '• “crm &amp; invoicing” gained *+3 pts* visibility this week',
        '• You overtook *Contoso* on the leaderboard (34 vs 30)',
        '• First appearance on *Perplexity*',
      ].join('\n'),
    );
    expect(blocks[4].text.text).toBe(
      '*Needs attention*\n• *Fabrikam* surged from 10 to 22 week-over-week',
    );
    expect(blocks[5].text.text).toBe(
      '<https://app.test/dashboard/insights|Open Visibility>  ·  <https://app.test/dashboard/settings?tab=notifications|Pulse settings>',
    );
    // Links, not buttons: no interactivity address answers yet.
    expect(blocks.some((b) => b.type === 'actions')).toBe(false);
  });

  it('says Weekly Pulse for 7 days, and which platforms were degraded', () => {
    const { text, blocks } = pulseMessage({
      brandName: 'Northwind',
      metrics: {
        ...METRICS,
        windowDays: 7,
        highlights: [],
        warnings: [],
        degradedPlatforms: ['chatgpt-web', 'google-aio'],
      },
      ...URLS,
    });
    expect(text).toContain('Weekly Pulse');
    expect(blocks[0].text.text).toBe('Weekly Pulse · Northwind');
    expect(textOf(blocks)).toContain('over the last 7 days');
    expect(textOf(blocks)).toContain(
      'Data collection was degraded on ChatGPT, Google AI Overviews today',
    );
    expect(textOf(blocks)).not.toContain('Highlights');
    expect(textOf(blocks)).not.toContain('Needs attention');
  });

  it('shows five items of a list and how many more, and keeps a header short', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      type: 'lost_citations',
      promptText: `prompt ${i}`,
    }));
    const { blocks } = pulseMessage({
      brandName: 'N'.repeat(200),
      metrics: { ...METRICS, highlights: [], warnings: many },
      ...URLS,
    });
    expect(blocks[0].text.text).toHaveLength(150);
    const warnings = blocks.find((b) => b.text?.text?.startsWith('*Needs attention*'));
    expect(warnings.text.text.split('\n')).toHaveLength(7);
    expect(warnings.text.text).toContain('…and 3 more');
  });
});
