import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore, VISIBILITY_SCORE_WEIGHTS } from './visibility-score';

describe('computeAiVisibilityScore', () => {
  it('blends the three components with the canonical weights', () => {
    // 100 × (0.6×0.5 + 0.25×0.2 + 0.15×0.8) = 30 + 5 + 12 = 47
    expect(
      computeAiVisibilityScore({
        answers: 10,
        mentionAnswers: 5,
        citationAnswers: 2,
        positionFactor: 0.8,
      }),
    ).toBe(47);
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

  it('caps naturally at 100 when every answer mentions, cites and ranks first', () => {
    expect(
      computeAiVisibilityScore({
        answers: 7,
        mentionAnswers: 7,
        citationAnswers: 7,
        positionFactor: 1,
      }),
    ).toBe(100);
  });

  it('rounds to one decimal', () => {
    // 100 × 0.6 × (1/3) = 20.0; 100 × (0.6×1/3 + 0.25×1/3) = 28.333… → 28.3
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
  });
});
