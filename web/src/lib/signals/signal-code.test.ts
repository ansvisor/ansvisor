import { describe, expect, it } from 'vitest';
import { matchesSignalCode, searchedSignalNo, signalCode } from './signal-code';

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

  it("reads the number a person's code names, however written (Chat's lookup by code)", () => {
    for (const query of ['S-07', 's-7', 'S 7', 's7', '#7', '7', ' S-007 ']) {
      expect(searchedSignalNo(query), query).toBe(7);
    }
    for (const query of ['S-0', 'AC-7', 'S-7a', 'S - 7', 'seven', '']) {
      expect(searchedSignalNo(query), query).toBeNull();
    }
  });
});
