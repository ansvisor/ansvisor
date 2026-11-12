import { describe, expect, it } from 'vitest';
import { ADS_PERIODS, ADS_TABS, DEFAULT_ADS_PERIOD, adsTabOf } from './tabs';

/** Ads' tabs by the address's hash, as the mockup keeps them (ADS-01 §11 `ads.tab`). */

describe('adsTabOf', () => {
  it('lists the five tabs in the mockup’s order', () => {
    expect(ADS_TABS).toEqual(['ov', 'op', 'sov', 'cmp', 'con']);
  });

  it('reads a tab from the hash, with or without its #', () => {
    expect(adsTabOf('#op')).toBe('op');
    expect(adsTabOf('#sov')).toBe('sov');
    expect(adsTabOf('cmp')).toBe('cmp');
    expect(adsTabOf('#con')).toBe('con');
  });

  it('opens the Overview for no hash or one it doesn’t know', () => {
    for (const hash of ['', '#', '#ov', '#OP', '#campaigns', null, undefined]) {
      expect(adsTabOf(hash)).toBe('ov');
    }
  });

  it('offers 7, 30 and 90 days, 30 first', () => {
    expect(ADS_PERIODS).toEqual(['7d', '30d', '90d']);
    expect(DEFAULT_ADS_PERIOD).toBe('30d');
  });
});
