import { describe, expect, it } from 'vitest';

import { formatRegionDisplay, regionFlag, regionLabel } from './region';

describe('region display helpers', () => {
  it('shows a known region as flag plus country name', () => {
    const usFlag = String.fromCodePoint(0x1f1fa, 0x1f1f8);

    expect(regionLabel('US')).toBe('United States');
    expect(regionFlag('US')).toBe(usFlag);
    expect(formatRegionDisplay('US')).toBe(`${usFlag} United States`);
  });

  it('normalizes lower-case known region codes', () => {
    const gbFlag = String.fromCodePoint(0x1f1ec, 0x1f1e7);

    expect(formatRegionDisplay('gb')).toBe(`${gbFlag} United Kingdom`);
  });

  it('falls back to the raw code without a flag for unknown values', () => {
    expect(regionLabel('ZZ')).toBe('ZZ');
    expect(regionFlag('ZZ')).toBe('');
    expect(formatRegionDisplay('ZZ')).toBe('ZZ');
    expect(formatRegionDisplay('USA')).toBe('USA');
  });
});
