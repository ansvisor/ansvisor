// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SCORE_RANGE, scoreRange } from './score-range';

describe('scoreRange', () => {
  it('needs the minimum number of audits: none with one or two', () => {
    expect(SCORE_RANGE.minAudits).toBe(3);
    expect(scoreRange([])).toBeNull();
    expect(scoreRange(null)).toBeNull();
    expect(scoreRange(undefined)).toBeNull();
    expect(scoreRange([0.64])).toBeNull();
    expect(scoreRange([0.62, 0.64])).toBeNull();
    expect(scoreRange([0.62, 0.66, 0.64])).toEqual({ plusMinus: 2, low: 62, high: 66, audits: 3 });
  });

  it('is ± 0 when the audits scored the same, in points as shown', () => {
    expect(scoreRange([0.64, 0.64, 0.64, 0.64, 0.64])).toEqual({
      plusMinus: 0,
      low: 64,
      high: 64,
      audits: 5,
    });
    // 63.6 and 64.4 both show as 64.
    expect(scoreRange([0.636, 0.644, 0.64])?.plusMinus).toBe(0);
  });

  it('is half the gap between the lowest and highest score, rounded up', () => {
    expect(scoreRange([0.62, 0.65, 0.64])).toEqual({ plusMinus: 2, low: 62, high: 65, audits: 3 });
    expect(scoreRange([0.6, 0.61, 0.6])?.plusMinus).toBe(1);
  });

  it("reads only the page's latest audits, so an old score leaves the window", () => {
    expect(SCORE_RANGE.audits).toBe(5);
    // Oldest first: 0.3 is the sixth audit back.
    const trend = [0.3, 0.62, 0.64, 0.63, 0.65, 0.64];
    expect(scoreRange(trend)).toEqual({ plusMinus: 2, low: 62, high: 65, audits: 5 });
  });

  it('counts an outlier in the window in full: a change to the page widens the range', () => {
    // A fix lifted the page from 45 to 70: the jump stays in the range for five audits.
    expect(scoreRange([0.45, 0.46, 0.7])).toEqual({ plusMinus: 13, low: 45, high: 70, audits: 3 });
    expect(scoreRange([0.45, 0.46, 0.7, 0.7, 0.7, 0.7, 0.7])?.plusMinus).toBe(0);
  });
});
