import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  DEFAULT_FX,
  cardCurrency,
  estimatedCardUsd,
  reportCardFx,
  reportCardLimits,
  reportCardOrigins,
} from './config.js';
import { countryCurrency } from './countries.js';
import {
  countryInSentence,
  countryLanguage,
  countryName,
  isCountry,
  languageName,
} from './countries.js';

describe('reportCardLimits', () => {
  it('falls back to 200 a day, $200 a month, 30 days and 5 an hour', () => {
    expect(reportCardLimits({})).toEqual({ ...DEFAULTS });
    expect(DEFAULTS).toMatchObject({
      dailyCap: 200,
      monthlyBudgetUsd: 200,
      repeatDays: 30,
      ipHourly: 5,
    });
  });

  it('reads each from the environment, and ignores what isn’t a number', () => {
    const limits = reportCardLimits({
      REPORT_CARD_DAILY_CAP: '50',
      REPORT_CARD_MONTHLY_BUDGET_USD: '75.5',
      REPORT_CARD_REPEAT_DAYS: 'soon',
      REPORT_CARD_IP_HOURLY: '-3',
      REPORT_CARD_CONCURRENCY: '0',
    });
    expect(limits).toMatchObject({
      dailyCap: 50,
      monthlyBudgetUsd: 75.5,
      repeatDays: 30,
      ipHourly: 5,
      concurrency: 1,
    });
  });

  it('expects a card to cost under 40 cents', () => {
    expect(estimatedCardUsd(reportCardLimits({}))).toBeCloseTo(0.375, 3);
  });
});

describe('reportCardOrigins', () => {
  it('is www.ansvisor.com and ansvisor.com unless set', () => {
    expect(reportCardOrigins({})).toEqual(['https://www.ansvisor.com', 'https://ansvisor.com']);
    expect(
      reportCardOrigins({ REPORT_CARD_ORIGINS: 'https://www.ansvisor.com/, https://x.webflow.io' }),
    ).toEqual(['https://www.ansvisor.com', 'https://x.webflow.io']);
  });
});

describe('countries', () => {
  it('knows a country by its code, with its English name and main language', () => {
    expect(isCountry('TR')).toBe(true);
    expect(isCountry('US')).toBe(true);
    expect(isCountry('ZZ')).toBe(false);
    expect(isCountry('EU')).toBe(false);
    expect(isCountry('XK')).toBe(true);
    expect(isCountry('tr')).toBe(false);
    expect(countryName('US')).toBe('United States');
    expect(countryName('TR')).toMatch(/^T(ü|u)rk/);
    expect(countryLanguage('TR')).toBe('tr');
    expect(countryLanguage('US')).toBe('en');
    expect(countryLanguage('DE')).toBe('de');
    expect(languageName('tr')).toBe('Turkish');
  });

  it('puts "the" before the countries whose name takes it', () => {
    expect(countryInSentence('US')).toBe('the United States');
    expect(countryInSentence('TR', 'Türkiye')).toBe('Türkiye');
  });

  it('asks in English where no main language is named', () => {
    expect(countryLanguage('IN')).toBe('en');
    expect(countryLanguage('NG')).toBe('en');
  });
});

describe('the card’s currency', () => {
  it('is TRY for Türkiye, GBP, CAD, AUD, EUR in the euro area and USD elsewhere', () => {
    expect(countryCurrency('TR')).toBe('TRY');
    expect(countryCurrency('gb')).toBe('GBP');
    expect(countryCurrency('CA')).toBe('CAD');
    expect(countryCurrency('AU')).toBe('AUD');
    expect(countryCurrency('DE')).toBe('EUR');
    expect(countryCurrency('US')).toBe('USD');
    expect(countryCurrency('JP')).toBe('USD');
  });

  it('takes the rates and their date from the environment, else the defaults', () => {
    expect(reportCardFx({})).toEqual({ rates: DEFAULT_FX.rates, date: DEFAULT_FX.date });
    const fx = reportCardFx({
      REPORT_CARD_FX_RATES: 'TRY=43.5, GBP=abc, JPY=150',
      REPORT_CARD_FX_DATE: '2026-12-01',
    });
    expect(fx.rates.TRY).toBe(43.5);
    expect(fx.rates.GBP).toBe(DEFAULT_FX.rates.GBP);
    expect(fx.rates.JPY).toBe(150);
    expect(fx.date).toBe('2026-12-01');
    expect(reportCardFx({ REPORT_CARD_FX_DATE: 'soon' }).date).toBe(DEFAULT_FX.date);
  });

  it('stamps a card with its currency, rate and date; none for US dollars', () => {
    const fx = { rates: { TRY: 41.9 }, date: '2026-11-01' };
    expect(cardCurrency('TRY', fx)).toEqual({ code: 'TRY', perUsd: 41.9, asOf: '2026-11-01' });
    expect(cardCurrency('USD', fx)).toBeNull();
    expect(cardCurrency('SEK', fx)).toBeNull();
  });
});
