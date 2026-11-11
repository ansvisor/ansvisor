import { describe, expect, it } from 'vitest';
import { addDays, hasFullWeek, isMondayIn, lastWeekOf } from './last-week';

describe('Monday on Today', () => {
  it("reads Monday on the person's clock", () => {
    const sundayNightInUtc = new Date('2026-11-16T03:00:00Z');
    expect(isMondayIn(sundayNightInUtc, 'UTC')).toBe(true);
    // Still Sunday evening in Los Angeles.
    expect(isMondayIn(sundayNightInUtc, 'America/Los_Angeles')).toBe(false);
    expect(isMondayIn(new Date('2026-11-17T12:00:00Z'), 'Europe/Istanbul')).toBe(false);
  });

  it('spans last week Monday to Sunday, and the week before, on the person’s clock', () => {
    const week = lastWeekOf(new Date('2026-11-16T09:00:00Z'), 'Europe/Istanbul');
    expect(week.days).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(week.before).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(week.start).toBe('2026-11-08T21:00:00.000Z');
    expect(week.end).toBe('2026-11-15T21:00:00.000Z');
  });

  it('sums up a week only once the brand ran before it started', () => {
    expect(hasFullWeek('2026-11-08T20:00:00Z', '2026-11-08T21:00:00.000Z')).toBe(true);
    expect(hasFullWeek('2026-11-10T03:00:00Z', '2026-11-08T21:00:00.000Z')).toBe(false);
    expect(hasFullWeek(null, '2026-11-08T21:00:00.000Z')).toBe(false);
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});
