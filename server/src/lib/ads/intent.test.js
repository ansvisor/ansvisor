import { describe, expect, it } from 'vitest';
import { ADS_THRESHOLDS } from '../../config/ads.js';
import { COMMERCIAL, INTENT_WEIGHTS } from '../priority-core.js';
import { buyingIntents, intentClass, isBuyingIntent } from './intent.js';

/**
 * Buying intent (ADS-01 §2): the intents the Action Center already calls
 * commercial, by the same line (COMMERCIAL), never a copy of it.
 */

describe('intentClass', () => {
  it('counts comparing and choosing as buying intent', () => {
    for (const intent of ['comparison', 'best-top', 'vs-review', 'recommendation']) {
      expect(intentClass(intent), intent).toBe('buying');
      expect(isBuyingIntent(intent), intent).toBe(true);
    }
  });

  it('does not count learning or fixing', () => {
    for (const intent of ['how-to', 'problem-solving', 'what-is', 'other']) {
      expect(intentClass(intent), intent).toBe('not_buying');
      expect(isBuyingIntent(intent), intent).toBe(false);
    }
  });

  it('does not count an intent outside the taxonomy', () => {
    for (const intent of [
      'buying',
      'commercial',
      'transactional',
      'Comparison',
      'constructor',
      '__proto__',
      'toString',
    ]) {
      expect(intentClass(intent), intent).toBe('not_buying');
    }
  });

  it('says "not analysed" for a prompt without an intent, and never guesses', () => {
    for (const intent of [null, undefined, '', '   ', 42, {}]) {
      expect(intentClass(intent), String(intent)).toBe('not_analysed');
      expect(isBuyingIntent(intent)).toBe(false);
    }
  });
});

describe('the buying-intent line', () => {
  it('is the Action Center’s COMMERCIAL, not a copy', () => {
    expect(ADS_THRESHOLDS.minIntentWeight).toBe(COMMERCIAL);
    expect(buyingIntents()).toEqual(
      Object.keys(INTENT_WEIGHTS).filter((i) => INTENT_WEIGHTS[i] >= COMMERCIAL),
    );
    expect(buyingIntents()).toEqual(['comparison', 'best-top', 'vs-review', 'recommendation']);
  });

  it("takes a workspace's own line", () => {
    expect(intentClass('how-to', { minIntentWeight: 0.75 })).toBe('buying');
    expect(buyingIntents({ minIntentWeight: 0.95 })).toEqual(['comparison', 'best-top']);
    expect(intentClass('recommendation', { minIntentWeight: 0.9 })).toBe('not_buying');
  });

  it('ignores a line that is not a weight', () => {
    for (const minIntentWeight of [2, -1, '0.5', Number.NaN, null]) {
      expect(buyingIntents({ minIntentWeight })).toEqual(buyingIntents());
    }
  });
});
