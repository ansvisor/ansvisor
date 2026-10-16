/**
 * format.test.ts
 *
 * The browser's default locale is simulated as Turkish (tr-TR), which uses "."
 * for thousands and "," for decimals — the setup where a prompt's 1,232
 * mentions used to read as "1.232" on the Prompts page.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { formatCompactNumber, formatNumber } from './format.js';

const toLocaleString = Number.prototype.toLocaleString;

beforeEach(() => {
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return toLocaleString.call(this, locales ?? 'tr-TR', options);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the simulated browser locale is Turkish', () => {
  expect((1232).toLocaleString()).toBe('1.232');
});

test('formatNumber uses English separators whatever the browser locale is', () => {
  expect(formatNumber(1232)).toBe('1,232');
  expect(formatNumber(1_234_567)).toBe('1,234,567');
  expect(formatNumber(1234.5)).toBe('1,234.5');
  expect(formatNumber(0)).toBe('0');
});

test('formatCompactNumber keeps decimals below 1,000 in English', () => {
  expect(formatCompactNumber(512.25)).toBe('512.25');
  expect(formatCompactNumber(999)).toBe('999');
});

test('formatCompactNumber abbreviates from 1,000 up', () => {
  expect(formatCompactNumber(1232)).toBe('1.2k');
  expect(formatCompactNumber(2_500_000)).toBe('2.5M');
  expect(formatCompactNumber(3_000_000_000)).toBe('3B');
});
