import { describe, expect, it } from 'vitest';
import { aiUsageToastDue, aiUsageToastMark, type AiUsage } from './ai-usage';

/** The AI usage toast (AI usage spec §4): once a period in a browser, on reaching 80%. */

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  periodStart: '2026-10-20T09:00:00.000Z',
  periodEnd: '2026-11-20T09:00:00.000Z',
  unlimited: false,
  percentUsed: 84,
  features: [],
  ...over,
});
const shown = '2026-10-20T09:00:00.000Z:growth';

describe('aiUsageToastDue', () => {
  it('marks the period and the plan it warned about', () => {
    expect(aiUsageToastMark(usage())).toBe(shown);
  });

  it('is due once a period from 80%', () => {
    expect(aiUsageToastDue(usage({ percentUsed: 80 }), null)).toBe(true);
    expect(aiUsageToastDue(usage({ percentUsed: 91 }), shown)).toBe(false);
  });

  it('marks the free trial apart, so a plan started within its period warns again', () => {
    expect(aiUsageToastMark(usage({ trial: true }))).toBe(`${shown}:trial`);
    expect(aiUsageToastDue(usage(), `${shown}:trial`)).toBe(true);
  });

  it('starts over in a new period, or on a plan changed within one', () => {
    expect(aiUsageToastDue(usage({ periodStart: '2026-11-20T09:00:00.000Z' }), shown)).toBe(true);
    expect(aiUsageToastDue(usage({ plan: 'enterprise' }), shown)).toBe(true);
  });

  it('is not due below 80%, once used up (the red banner says it), or unmetered', () => {
    expect(aiUsageToastDue(usage({ percentUsed: 79.9 }), null)).toBe(false);
    expect(aiUsageToastDue(usage({ percentUsed: 100 }), null)).toBe(false);
    expect(aiUsageToastDue(usage({ unlimited: true, percentUsed: null }), null)).toBe(false);
  });
});
