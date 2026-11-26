import { getFormatLocale } from '@/lib/format';
import type { AdsSpend } from './api';

/**
 * One amount in its currency, to the cent ("$12.35", "€3.00"). Without a
 * currency, or one Intl doesn't know, the number alone.
 */
export function spendAmount(s: AdsSpend, locale: string = getFormatLocale()): string {
  if (s.currencyCode) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: s.currencyCode,
        maximumFractionDigits: 2,
      }).format(s.amount);
    } catch {
      // Not a currency code Intl knows.
    }
  }
  return s.amount.toLocaleString(locale, { maximumFractionDigits: 2 });
}

/**
 * Spend in several currencies, never converted or added across them:
 * "$14.35 + €3.00". Nothing spent reads as 0.
 */
export function spendText(list: AdsSpend[], locale: string = getFormatLocale()): string {
  if (list.length === 0) return spendAmount({ currencyCode: null, amount: 0 }, locale);
  return list.map((s) => spendAmount(s, locale)).join(' + ');
}
