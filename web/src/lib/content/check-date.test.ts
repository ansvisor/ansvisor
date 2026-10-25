import { describe, expect, it } from 'vitest';
import { checkDateText, pageCheckDate } from './check-date';

/** A comparison's visible check date (Quality spec §11, CE-052). */

const NOW = new Date('2026-10-25T12:00:00Z');

describe('checkDateText', () => {
  it('says this month in the page’s language, none for a language without a line', () => {
    expect(checkDateText('English (US)', NOW)).toBe('Last checked: October 2026.');
    expect(checkDateText('tr', NOW)).toBe('Son kontrol: Ekim 2026.');
    expect(checkDateText('de', NOW)).toBe('Zuletzt geprüft: Oktober 2026.');
    expect(checkDateText('Japanese', NOW)).toBeNull();
  });
});

describe('pageCheckDate', () => {
  it('reads a check date from the last two years', () => {
    expect(pageCheckDate(['Last checked: October 2026.'], NOW)).toBe(true);
    expect(pageCheckDate(['We tested each tool in March 2025.'], NOW)).toBe(true);
    expect(pageCheckDate(['Son kontrol: Ekim 2026.'], NOW)).toBe(true);
  });

  it('reads none from an old date, a year with no check, or a check with no year', () => {
    expect(pageCheckDate(['Last checked: May 2021.'], NOW)).toBe(false);
    expect(pageCheckDate(['Founded in 2026 by two engineers.'], NOW)).toBe(false);
    expect(pageCheckDate(['We checked every plan.'], NOW)).toBe(false);
  });
});
