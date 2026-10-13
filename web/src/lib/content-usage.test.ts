/**
 * content-usage.test.ts  (CONTENT-001)
 *
 * How the monthly content counters read on the usage card.
 */

import { describe, expect, test } from 'vitest';
import { hasContentQuota, usagePercent, usageTone, type ContentUsage } from './content-usage';

const c = (used: number, limit: number) => ({ used, limit, remaining: Math.max(0, limit - used) });

describe('usageTone', () => {
  test('normal under 80%, warning from 80%, exhausted at the limit', () => {
    expect(usageTone(c(7, 10))).toBe('normal');
    expect(usageTone(c(8, 10))).toBe('warning');
    expect(usageTone(c(43, 50))).toBe('warning');
    expect(usageTone(c(10, 10))).toBe('exhausted');
    expect(usageTone(c(12, 10))).toBe('exhausted');
  });

  test('unlimited plans have no tone', () => {
    expect(usageTone(c(0, -1))).toBe('unlimited');
  });
});

describe('usagePercent', () => {
  test('is capped at 100 and empty when unlimited', () => {
    expect(usagePercent(c(32, 50))).toBe(64);
    expect(usagePercent(c(12, 10))).toBe(100);
    expect(usagePercent(c(0, -1))).toBe(0);
  });
});

describe('hasContentQuota', () => {
  const usage = (o: number, b: number): ContentUsage => ({
    plan: 'starter',
    planName: 'Starter',
    periodStart: null,
    periodEnd: null,
    opportunities: c(0, o),
    briefs: c(0, b),
  });

  test('shows the card when either counter is limited', () => {
    expect(hasContentQuota(usage(10, 10))).toBe(true);
    expect(hasContentQuota(usage(-1, 10))).toBe(true);
    expect(hasContentQuota(usage(-1, -1))).toBe(false);
    expect(hasContentQuota(null)).toBe(false);
  });
});
