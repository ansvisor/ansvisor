import { describe, expect, it } from 'vitest';
import type { ReportPayload } from '@/lib/actions/reports';
import {
  PRESENTATION_SUMMARY_CHARS,
  presentationSlides,
  sourceNote,
  type PresentationReport,
} from './presentation';

/**
 * The payload → slide mapping (issue #2298): figures pass through as the
 * report stored them, every data slide names its source and period, and a
 * section the report does not carry makes no slide.
 */

const PERIOD = { date_from: '2026-10-01', date_to: '2026-10-31' };

function report(payload: Partial<ReportPayload>): PresentationReport {
  return {
    title: 'October visibility',
    ...PERIOD,
    payload: { brandName: 'Acme', summaryText: '', ...payload } as ReportPayload,
  };
}

describe('presentationSlides', () => {
  it('opens with a title slide naming the brand and the period', () => {
    const slides = presentationSlides(report({}));
    expect(slides[0]).toEqual({
      kind: 'title',
      title: 'October visibility',
      brand: 'Acme',
      period: '2026-10-01 – 2026-10-31',
    });
  });

  it('puts the source report and period on every data slide', () => {
    const slides = presentationSlides(
      report({
        summaryText: 'A steady month.',
        insights: {
          avgVisibilityScore: 42.5,
          totalMentions: 120,
          totalCitations: 34,
          positiveSentimentPct: 61.2,
        } as ReportPayload['insights'],
      }),
    );
    const note = sourceNote(report({}));
    expect(note).toContain('October visibility');
    expect(note).toContain('2026-10-01');
    expect(note).toContain('2026-10-31');
    for (const slide of slides.slice(1)) {
      expect((slide as { note?: string }).note).toBe(note);
    }
  });

  it('keeps the stored figures: rates as percents, changes signed, nothing recalculated', () => {
    const slides = presentationSlides(
      report({
        visibilityRate: { visiblePrompts: 7, promptCount: 20, ratePct: 35, score: 51.25 },
        shareOfVoice: {
          overallSov: 22.34,
          overallSovChange: -1.24,
          byPlatform: [{ provider: 'ChatGPT', brandMentions: 10, competitorMentions: 30, sov: 25 }],
        },
      }),
    );
    const kpis = slides.find((slide) => slide.kind === 'kpis');
    expect(kpis).toMatchObject({
      cells: expect.arrayContaining([
        { label: 'AI Visibility Score', value: '51.3' },
        { label: 'Visibility rate', value: '35%', detail: '7 of 20 prompts' },
        { label: 'Share of voice', value: '22.3% (-1.2%)' },
      ]),
    });
    const sov = slides.find((slide) => slide.kind === 'sov');
    expect(sov).toMatchObject({ overall: 22.34, rows: [{ platform: 'ChatGPT', pct: 25 }] });
  });

  it('maps the trend to points, with the competitor average only where the report has it', () => {
    const slides = presentationSlides(
      report({
        visibilityTrend: [
          { date: '2026-10-01', score: 40, competitors: 35 },
          { date: '2026-10-02', score: 44, competitors: null },
        ],
      }),
    );
    const trend = slides.find((slide) => slide.kind === 'trend');
    expect(trend).toMatchObject({
      points: [
        { day: '2026-10-01', score: 40 },
        { day: '2026-10-02', score: 44 },
      ],
      competitorPoints: [{ day: '2026-10-01', score: 35 }],
    });
  });

  it('maps competitors to a table with their stored rates', () => {
    const slides = presentationSlides(
      report({
        competitors: [
          {
            name: 'Rival',
            avgVisibilityScore: 48.04,
            visibilityRate: 55.5,
            visiblePrompts: 11,
            promptCount: 20,
          } as ReportPayload['competitors'] extends (infer T)[] | undefined ? T : never,
        ],
      }),
    );
    const table = slides.find((slide) => slide.kind === 'table');
    expect(table).toMatchObject({
      heading: 'Competitors',
      columns: ['Brand', 'Visibility rate', 'Visible prompts', 'Avg. score'],
      rows: [['Rival', '55.5%', '11 of 20', '48']],
    });
  });

  it('lists the sections the report could not gather instead of leaving slides out silently', () => {
    const slides = presentationSlides(
      report({ missingSections: ['citations', 'topicPerformance'] }),
    );
    expect(slides.at(-1)).toMatchObject({
      kind: 'missing',
      // Named as the Reports page names them, not as raw payload ids.
      sections: ['Citations', 'Topics'],
    });
  });

  it('makes no slide for a section the payload does not carry', () => {
    const slides = presentationSlides(report({ summaryText: 'Only a summary.' }));
    expect(slides.map((slide) => slide.kind)).toEqual(['title', 'summary']);
  });

  it('caps a table slide at ten rows when the payload carries more - and says so', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      name: `Competitor ${i + 1}`,
      avgVisibilityScore: 40 + i,
      visibilityRate: 10 + i,
      visiblePrompts: i,
      promptCount: 20,
    })) as unknown as ReportPayload['competitors'];
    const slides = presentationSlides(report({ competitors: many }));
    const table = slides.find((slide) => slide.kind === 'table');
    expect(table?.kind === 'table' && table.rows).toHaveLength(10);
    expect(table?.kind === 'table' && table.rows[0][0]).toBe('Competitor 1');
    // No silent loss: the slide names the cap and keeps the report's order.
    expect(table?.kind === 'table' && table.shownOf).toEqual({ shown: 10, total: 14 });
  });

  it('marks a table slide complete when the payload fits it', () => {
    const slides = presentationSlides(
      report({
        competitors: [
          {
            name: 'Rival',
            avgVisibilityScore: 48,
            visibilityRate: 55.5,
            visiblePrompts: 11,
            promptCount: 20,
          } as ReportPayload['competitors'] extends (infer T)[] | undefined ? T : never,
        ],
      }),
    );
    const table = slides.find((slide) => slide.kind === 'table');
    expect(table?.kind === 'table' && table.shownOf).toBeNull();
  });

  it('makes no trend slide for an empty trend, and maps a single point honestly', () => {
    expect(presentationSlides(report({ visibilityTrend: [] })).map((slide) => slide.kind)).toEqual([
      'title',
    ]);
    const slides = presentationSlides(
      report({ visibilityTrend: [{ date: '2026-10-31', score: 51, competitors: null }] }),
    );
    const trend = slides.find((slide) => slide.kind === 'trend');
    expect(trend).toMatchObject({
      points: [{ day: '2026-10-31', score: 51 }],
      competitorPoints: null,
    });
  });

  it('keeps every KPI cell the payload supports, past one row of three', () => {
    const slides = presentationSlides(
      report({
        visibilityRate: { visiblePrompts: 7, promptCount: 20, ratePct: 35, score: 51.2 },
        insights: {
          avgVisibilityScore: 51.2,
          totalMentions: 120,
          totalCitations: 34,
          positiveSentimentPct: 61.2,
        } as ReportPayload['insights'],
        shareOfVoice: { overallSov: 22.3, overallSovChange: null, byPlatform: [] },
      }),
    );
    const kpis = slides.find((slide) => slide.kind === 'kpis');
    expect(kpis?.kind === 'kpis' && kpis.cells.length).toBe(6);
    // The stored score is shown as stored: no recomputation from other fields.
    expect(kpis?.kind === 'kpis' && kpis.cells[0]).toEqual({
      label: 'AI Visibility Score',
      value: '51.2',
    });
  });

  it('marks a short summary as complete, not an excerpt', () => {
    const slides = presentationSlides(report({ summaryText: 'A steady month.' }));
    const summary = slides.find((slide) => slide.kind === 'summary');
    expect(summary?.kind === 'summary' && summary.excerpt).toBe(false);
  });

  it('keeps a very long summary readable on one slide, cut at a word boundary', () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const slides = presentationSlides(report({ summaryText: long }));
    const summary = slides.find((slide) => slide.kind === 'summary');
    expect(summary?.kind).toBe('summary');
    if (summary?.kind !== 'summary') return;
    expect(summary.excerpt).toBe(true);
    expect(summary.paragraphs[0].length).toBeLessThanOrEqual(PRESENTATION_SUMMARY_CHARS + 1);
    expect(summary.paragraphs[0]).not.toMatch(/word\d{0,2}…$/);
    expect(summary.paragraphs[0].endsWith('…')).toBe(true);
  });
});
