import { describe, expect, it } from 'vitest';
import {
  computeAiVisibilityScore,
  POSITION_SUPPORT_ANSWERS,
  VISIBILITY_SCORE_WEIGHTS,
} from './visibility-score';

describe('computeAiVisibilityScore', () => {
  it('blends the three components with the canonical weights', () => {
    // position support: 5/(5+10) = 1/3 → effective pf = 0.8/3 = 0.2667
    // 100 × (0.6×0.5 + 0.25×0.2 + 0.15×0.2667) = 30 + 5 + 4 = 39
    expect(
      computeAiVisibilityScore({
        answers: 10,
        mentionAnswers: 5,
        citationAnswers: 2,
        positionFactor: 0.8,
      }),
    ).toBe(39);
  });

  it('treats a null position factor as zero contribution', () => {
    expect(
      computeAiVisibilityScore({
        answers: 10,
        mentionAnswers: 0,
        citationAnswers: 1,
        positionFactor: null,
      }),
    ).toBe(2.5);
  });

  it('returns null for an empty scope instead of a fake zero', () => {
    expect(
      computeAiVisibilityScore({
        answers: 0,
        mentionAnswers: 0,
        citationAnswers: 0,
        positionFactor: null,
      }),
    ).toBeNull();
  });

  it('approaches 100 as a perfect entity accumulates evidence', () => {
    // Large perfect scope: support 10000/10010 ≈ 1 → rounds to 100.
    expect(
      computeAiVisibilityScore({
        answers: 10_000,
        mentionAnswers: 10_000,
        citationAnswers: 10_000,
        positionFactor: 1,
      }),
    ).toBe(100);
    // Small perfect scope: the position term is still earning trust.
    // 100 × (0.6 + 0.25 + 0.15 × 7/17) = 91.2
    expect(
      computeAiVisibilityScore({
        answers: 7,
        mentionAnswers: 7,
        citationAnswers: 7,
        positionFactor: 1,
      }),
    ).toBe(91.2);
  });

  it('damps a perfect position average built on a thin sample', () => {
    // A competitor named first in 6 of 16k answers used to score a flat
    // 15-point position floor and outrank one named in 500+. Support 6/16
    // caps its position term at 5.6 points (5.7 total with the tiny
    // mention/citation contributions).
    expect(
      computeAiVisibilityScore({
        answers: 16_332,
        mentionAnswers: 6,
        citationAnswers: 4,
        positionFactor: 1,
      }),
    ).toBe(5.7);
    // A high-volume competitor is effectively untouched by the shrinkage:
    // support 3892/3902 ≈ 0.997.
    expect(
      computeAiVisibilityScore({
        answers: 16_332,
        mentionAnswers: 3892,
        citationAnswers: 2608,
        positionFactor: 0.791,
      }),
    ).toBe(30.1);
  });

  it('rounds to one decimal', () => {
    // 100 × (0.6×1/3 + 0.25×1/3) = 28.333… → 28.3
    expect(
      computeAiVisibilityScore({
        answers: 3,
        mentionAnswers: 1,
        citationAnswers: 1,
        positionFactor: null,
      }),
    ).toBe(28.3);
  });

  it('weights sum to 1 so the score stays on a 0-100 scale', () => {
    const { mention, citation, position } = VISIBILITY_SCORE_WEIGHTS;
    expect(mention + citation + position).toBe(1);
    expect(POSITION_SUPPORT_ANSWERS).toBeGreaterThan(0);
  });
});
