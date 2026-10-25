import { describe, expect, it } from 'vitest';
import { checkDateText, isCheckDateText, pageCheckDate } from './check-date';
import { isByline } from './readability';

/** A comparison's visible check date (Quality spec §11, CE-052). */

const NOW = new Date('2026-10-25T12:00:00Z');

describe('checkDateText', () => {
  it('says this month in the page’s language, none for a language without a line', () => {
    expect(checkDateText('English (US)', NOW)).toBe('Last checked: October 2026');
    expect(checkDateText('tr', NOW)).toBe('Son kontrol: Ekim 2026');
    expect(checkDateText('de', NOW)).toBe('Zuletzt geprüft: Oktober 2026');
    expect(checkDateText('Japanese', NOW)).toBeNull();
  });

  it('is read back in every language, and Answer first reads past it as a date', () => {
    for (const language of ['en', 'tr', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'sv']) {
      const line = checkDateText(language, NOW)!;
      expect(pageCheckDate([line], NOW)).toBe(true);
      expect(isByline(line)).toBe(true);
    }
  });
});

describe('pageCheckDate', () => {
  it('reads a check date from the last two years, as a verb or a label', () => {
    for (const text of [
      'We tested each tool in March 2025.',
      'Last update: October 2026',
      'Son güncelleme: Ekim 2026',
      'İncelendi: Ekim 2026',
      'Letzte Aktualisierung: Oktober 2026',
      'Dernière mise à jour : octobre 2026',
      'Última actualización: octubre de 2026',
      'Ultimo aggiornamento: ottobre 2026',
    ]) {
      expect(pageCheckDate([text], NOW), text).toBe(true);
    }
  });

  it('reads none from an old date, a year with no check, a word inside another, or a check far from its year', () => {
    for (const text of [
      'Last checked: May 2021.',
      'Founded in 2026 by two engineers.',
      'We checked every plan.',
      'Areas of improvement for 2026.',
      'Untested before 2026.',
      'We tested a dozen tools for this guide, comparing price, speed, support and integrations for small teams; Acme launched in 2026.',
    ]) {
      expect(pageCheckDate([text], NOW), text).toBe(false);
    }
  });

  it('tells a check date at any year, for Add line to replace', () => {
    expect(isCheckDateText('Last checked: May 2021')).toBe(true);
    expect(isCheckDateText('Our pick for small teams.')).toBe(false);
  });
});
