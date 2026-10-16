import { describe, expect, it } from 'vitest';
import { coverage, kpiRates, parseKpiSeries, rateChange, shareOfVoice } from './insights-kpis';

describe('kpiRates', () => {
  it('works out every card rate from the components', () => {
    expect(
      kpiRates({
        answers: 200,
        citationAnswers: 76,
        mentioning: 100,
        positive: 48,
        negative: 14,
        sumPosition: 240,
        positionCount: 100,
      }),
    ).toEqual({
      citationRate: 38,
      positivePct: 48,
      negativePct: 14,
      netSentiment: 34,
      avgPosition: 2.4,
    });
  });

  it('has no rate without the answers it needs', () => {
    expect(
      kpiRates({
        answers: 0,
        citationAnswers: 0,
        mentioning: 0,
        positive: 0,
        negative: 0,
        sumPosition: null,
        positionCount: 0,
      }),
    ).toEqual({
      citationRate: null,
      positivePct: null,
      negativePct: null,
      netSentiment: null,
      avgPosition: null,
    });
  });
});

describe('rates', () => {
  it('rounds changes to one decimal and needs both values', () => {
    expect(rateChange(64.3, 62.2)).toBe(2.1);
    expect(rateChange(64.3, null)).toBeNull();
  });

  it('matches share_of_voice_aggregates and the coverage line', () => {
    expect(shareOfVoice(46, 954)).toBe(4.6);
    expect(shareOfVoice(0, 0)).toBeNull();
    expect(coverage(456, 709)).toBe(64.3);
    expect(coverage(0, 0)).toBeNull();
  });
});

describe('parseKpiSeries', () => {
  it('turns each day into the cards’ values', () => {
    const series = parseKpiSeries({
      complete: true,
      days: [
        {
          day: '2026-10-13',
          answers: 10,
          citation_answers: 4,
          total_mentions: 12,
          total_citations: 5,
          positive_count: 3,
          negative_count: 1,
          mentioning_answers: 6,
          sum_position: 9,
          position_count: 6,
          visible_prompts: 3,
          active_prompts: 4,
          competitor_mentions: 36,
        },
      ],
    });

    expect(series).toEqual([
      {
        day: '2026-10-13',
        mentions: 12,
        citations: 5,
        netSentiment: 33,
        coverage: 75,
        shareOfVoice: 25,
        avgPosition: 1.5,
        citationRate: 40,
      },
    ]);
  });

  it('draws nothing before the rollups are backfilled', () => {
    expect(parseKpiSeries({ complete: false, days: [] })).toBeNull();
    expect(parseKpiSeries(null)).toBeNull();
  });
});
