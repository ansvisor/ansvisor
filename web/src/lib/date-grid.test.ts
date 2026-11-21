import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  clampDay,
  inRange,
  isDay,
  monthGrid,
  startOfWeek,
  weekStartOf,
} from './date-grid';

describe('the date picker’s days (AC-25)', () => {
  it('knows a real day from one that isn’t', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-2-3')).toBe(false);
    expect(isDay(null)).toBe(false);
  });

  it('moves by days and months, a short month keeping its last day', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -14)).toBe('2025-01-15');
  });

  it('keeps a day in its range', () => {
    expect(clampDay('1999-05-01', '2000-01-01', '2100-12-31')).toBe('2000-01-01');
    expect(clampDay('2026-05-01', '2000-01-01')).toBe('2026-05-01');
    expect(inRange('2026-05-01', undefined, '2026-04-30')).toBe(false);
  });

  it('starts weeks on Sunday for English (US), Monday elsewhere', () => {
    expect(weekStartOf('en-US')).toBe(0);
    expect(weekStartOf('tr')).toBe(1);
    expect(startOfWeek('2026-11-20', 1)).toBe('2026-11-16');
    expect(startOfWeek('2026-11-20', 0)).toBe('2026-11-15');
  });

  it('lays a month out as six weeks, the days around it marked', () => {
    const weeks = monthGrid('2026-11-20', 1);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // November 2026 starts on a Sunday: its Monday week begins Oct 26.
    expect(weeks[0][0]).toEqual({ day: '2026-10-26', inMonth: false });
    expect(weeks[0][6]).toEqual({ day: '2026-11-01', inMonth: true });
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
  });
});
