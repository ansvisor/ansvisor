import { describe, expect, it } from 'vitest';
import { matchesSignalCode, signalCode } from './signal-code';

// The owner's ask (14 Nov): each brand numbers its signals from S-01 (00534).
describe("a signal's code", () => {
  it("is its brand's number, two digits at least, and none before its brand is numbered", () => {
    expect(signalCode({ brandNo: 1 })).toBe('S-01');
    expect(signalCode({ brandNo: 12 })).toBe('S-12');
    expect(signalCode({ brandNo: 120 })).toBe('S-120');
    expect(signalCode({ brandNo: null })).toBeNull();
    expect(signalCode({})).toBeNull();
  });

  it('is what a search for S-12, s12 or 12 finds, and nothing near it', () => {
    for (const query of ['S-12', 's-12', 'S12', 'S 12', '#12', '12', ' 12 ']) {
      expect(matchesSignalCode({ brandNo: 12 }, query), query).toBe(true);
    }
    for (const query of ['S-1', 'S-120', '1', 'AC-12', 'S-12a', '']) {
      expect(matchesSignalCode({ brandNo: 12 }, query), query).toBe(false);
    }
    expect(matchesSignalCode({ brandNo: null }, '12')).toBe(false);
  });
});
