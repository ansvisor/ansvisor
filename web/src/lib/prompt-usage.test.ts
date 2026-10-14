/**
 * prompt-usage.test.ts  (PROMPT-009)
 *
 * Tests the Tracked Prompts usage counter states.
 */

import { describe, expect, test } from 'vitest';
import { getPromptUsage, isPromptLimitReached } from './prompt-usage';

describe('getPromptUsage', () => {
  test('-1 is unlimited and never blocks', () => {
    const u = getPromptUsage(5000, -1);
    expect(u.state).toBe('unlimited');
    expect(isPromptLimitReached(u)).toBe(false);
  });

  test('below 80% is normal', () => {
    expect(getPromptUsage(0, 200)).toEqual({ state: 'normal', remaining: 200, percent: 0 });
    expect(getPromptUsage(159, 200).state).toBe('normal');
  });

  test('from 80% up to one below the limit is a warning with the slots left', () => {
    expect(getPromptUsage(160, 200)).toEqual({ state: 'warning', remaining: 40, percent: 80 });
    expect(getPromptUsage(187, 200)).toEqual({ state: 'warning', remaining: 13, percent: 94 });
    expect(getPromptUsage(49, 50).state).toBe('warning');
  });

  test('exactly at the limit is full (the cap is inclusive)', () => {
    const u = getPromptUsage(200, 200);
    expect(u).toEqual({ state: 'full', remaining: 0, percent: 100 });
    expect(isPromptLimitReached(u)).toBe(true);
  });

  test('above the limit (after a downgrade) is over, with the bar capped at 100', () => {
    const u = getPromptUsage(187, 50);
    expect(u).toEqual({ state: 'over', remaining: 0, percent: 100 });
    expect(isPromptLimitReached(u)).toBe(true);
  });

  test('a zero limit is full at zero usage', () => {
    expect(getPromptUsage(0, 0).state).toBe('full');
  });
});
