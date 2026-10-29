import { afterEach, describe, expect, it } from 'vitest';
import { chatgptFanoutDue, chatgptFanoutMode, chatgptFanoutWeekday } from './chatgpt-fanout.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Prompt ids shaped like the real ones, fixed so the test never changes. */
const ids = Array.from(
  { length: 700 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
);
/** Seven consecutive days, starting at an hour a nightly run might submit. */
const week = (start) => Array.from({ length: 7 }, (_, i) => new Date(start + i * DAY_MS));

describe('chatgptFanoutMode', () => {
  afterEach(() => {
    delete process.env.CLORO_CHATGPT_FANOUT;
  });

  it('reads off, sample and all, in any case', () => {
    expect(chatgptFanoutMode('off')).toBe('off');
    expect(chatgptFanoutMode(' ALL ')).toBe('all');
    expect(chatgptFanoutMode('Sample')).toBe('sample');
  });

  it('defaults to sample when unset or unknown', () => {
    expect(chatgptFanoutMode(undefined)).toBe('sample');
    expect(chatgptFanoutMode('')).toBe('sample');
    expect(chatgptFanoutMode('weekly')).toBe('sample');
  });

  it('reads the environment', () => {
    expect(chatgptFanoutMode()).toBe('sample');
    process.env.CLORO_CHATGPT_FANOUT = 'off';
    expect(chatgptFanoutMode()).toBe('off');
  });
});

describe('chatgptFanoutDue', () => {
  it('asks once in any seven days on sample, for every prompt', () => {
    for (const start of [Date.UTC(2026, 9, 29, 2), Date.UTC(2027, 0, 3, 23, 59)]) {
      for (const id of ids) {
        const days = week(start).filter((date) => chatgptFanoutDue(id, date, 'sample'));
        expect(days).toHaveLength(1);
        expect(days[0].getUTCDay()).toBe(chatgptFanoutWeekday(id));
      }
    }
  });

  it('keeps a prompt on the same day, whatever the hour', () => {
    const id = ids[0];
    const day = Date.UTC(2026, 9, 29);
    const due = chatgptFanoutDue(id, new Date(day), 'sample');
    expect(chatgptFanoutDue(id, new Date(day + DAY_MS - 1), 'sample')).toBe(due);
  });

  it('spreads the prompts across the week', () => {
    const perDay = new Array(7).fill(0);
    for (const id of ids) perDay[chatgptFanoutWeekday(id)]++;
    // 100 a day on average; none of them close to empty or doubled.
    for (const count of perDay) {
      expect(count).toBeGreaterThan(70);
      expect(count).toBeLessThan(130);
    }
  });

  it('asks on every day on all, and on none on off', () => {
    for (const date of week(Date.UTC(2026, 9, 29, 2))) {
      for (const id of ids.slice(0, 50)) {
        expect(chatgptFanoutDue(id, date, 'all')).toBe(true);
        expect(chatgptFanoutDue(id, date, 'off')).toBe(false);
      }
    }
  });
});
