import { describe, expect, it } from 'vitest';
import type { ReportPayload } from '@/lib/actions/reports';
import { presentationSlides, type PresentationReport } from './presentation';
import { renderPresentationPptx } from './presentation-pptx';

/**
 * The .pptx renderer (issue #2298): a real PowerPoint file with the deck's
 * text on its slides, editable in PowerPoint, Keynote and LibreOffice.
 */

function fullReport(): PresentationReport {
  const payload = {
    brandName: 'Acme',
    summaryText: 'Visibility held steady through October.',
    insights: {
      avgVisibilityScore: 42.5,
      totalMentions: 120,
      totalCitations: 34,
      positiveSentimentPct: 61.2,
    },
    visibilityRate: { visiblePrompts: 7, promptCount: 20, ratePct: 35, score: 51.25 },
    visibilityTrend: [
      { date: '2026-10-01', score: 40, competitors: 35 },
      { date: '2026-10-02', score: 44, competitors: 36 },
    ],
    shareOfVoice: {
      overallSov: 22.3,
      overallSovChange: 1.2,
      byPlatform: [{ provider: 'ChatGPT', brandMentions: 10, competitorMentions: 30, sov: 25 }],
    },
    competitors: [
      {
        name: 'Rival',
        avgVisibilityScore: 48,
        visibilityRate: 55.5,
        visiblePrompts: 11,
        promptCount: 20,
      },
    ],
    promptPerformance: {
      best: [
        {
          text: 'best crm for startups',
          avgVisibility: 80,
          visibilityRate: 90,
          totalMentions: 9,
          runs: 10,
        },
      ],
      worst: [
        { text: 'crm free tier', avgVisibility: 10, visibilityRate: 5, totalMentions: 1, runs: 10 },
      ],
    },
    topicPerformance: [{ name: 'Pricing', avgVisibility: 60, visibilityRate: 70, change: 4.2 }],
    citations: {
      totals: { domains: 5, urls: 12, citations: 34, results: 50, avgCitationsPerResult: 0.68 },
      sourceTypeBreakdown: [],
      topDomains: [
        {
          domain: 'g2.com',
          category: 'review',
          totalCitations: 12,
          resultsCiting: 8,
          usagePct: 24,
        },
      ],
    },
    missingSections: ['aiTraffic'],
  } as unknown as ReportPayload;
  return { title: 'October visibility', date_from: '2026-10-01', date_to: '2026-10-31', payload };
}

describe('renderPresentationPptx', () => {
  it('renders every slide kind into a valid .pptx zip', async () => {
    const slides = presentationSlides(fullReport());
    const kinds = slides.map((slide) => slide.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['title', 'summary', 'kpis', 'trend', 'sov', 'table', 'missing']),
    );

    const buffer = await renderPresentationPptx(slides);
    // A .pptx is a zip: PK magic, then the parts PowerPoint opens.
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(buffer.byteLength).toBeGreaterThan(5000);

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const slideParts = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name),
    );
    expect(slideParts).toHaveLength(slides.length);

    const firstSlide = await zip.files['ppt/slides/slide1.xml'].async('string');
    expect(firstSlide).toContain('October visibility');
    expect(firstSlide).toContain('Acme');
    // The summary slide carries the report's words as editable text.
    const secondSlide = await zip.files['ppt/slides/slide2.xml'].async('string');
    expect(secondSlide).toContain('Visibility held steady through October.');
    // Native charts, not pictures: the trend and SoV slides have chart parts.
    const chartParts = Object.keys(zip.files).filter((name) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(name),
    );
    expect(chartParts.length).toBeGreaterThanOrEqual(2);
  }, 30000);
});
