import { describe, expect, it } from 'vitest';
import { COMMERCIAL } from '../lib/priority-core.js';
import { ADS_THRESHOLDS, adsThresholds } from './ads.js';

/** Ads' earn-or-pay thresholds: product's defaults, a workspace's own over them. */

describe('adsThresholds', () => {
  it('gives the defaults without a workspace setting', () => {
    expect(ADS_THRESHOLDS).toEqual({
      minIntentWeight: COMMERCIAL,
      leadPosition: 1,
      minPaidVolume: 1000,
    });
    expect(Object.isFrozen(ADS_THRESHOLDS)).toBe(true);
    for (const overrides of [undefined, null, {}, 'x', 7]) {
      expect(adsThresholds(overrides)).toEqual(ADS_THRESHOLDS);
    }
  });

  it("lays a workspace's own over them, key by key", () => {
    const merged = adsThresholds({ minPaidVolume: 250, leadPosition: 2 });
    expect(merged).toEqual({ minIntentWeight: COMMERCIAL, leadPosition: 2, minPaidVolume: 250 });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(ADS_THRESHOLDS.minPaidVolume).toBe(1000);
  });

  it('ignores unknown keys and values out of range', () => {
    expect(
      adsThresholds({
        minIntentWeight: 1.5,
        leadPosition: 0,
        minPaidVolume: -1,
        maxBudget: 100,
      }),
    ).toEqual(ADS_THRESHOLDS);
    expect(
      adsThresholds({ minIntentWeight: '0.5', leadPosition: Infinity, minPaidVolume: NaN }),
    ).toEqual(ADS_THRESHOLDS);
    expect(adsThresholds({ minIntentWeight: 0, minPaidVolume: 0 })).toMatchObject({
      minIntentWeight: 0,
      minPaidVolume: 0,
    });
  });
});
