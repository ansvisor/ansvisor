// Numbers and dates follow the interface language (LOC-002): 1,232 in English,
// 1.232 in German, 1 232 in French. English keeps en-US, as before.
//
// The language is the person's own, set once per page by <FormatLocale> (the
// layout) so these plain functions need no hook. Pass `locale` to say it
// outright (a test, or a server component that asks next-intl's getLocale()).
// Only the browser keeps the language: on the server this module is shared by
// concurrent requests in different languages, so server rendering formats in
// en-US unless `locale` is passed, and the browser re-renders in the person's.
let formatLocale = 'en-US';

/** The Intl locale for an interface language ("en" is en-US; the test language en-XA too). */
export function intlLocaleOf(uiLocale: string): string {
  return uiLocale === 'en' || uiLocale === 'en-XA' ? 'en-US' : uiLocale;
}

export function setFormatLocale(uiLocale: string): void {
  // Never on the server: one request's language would leak into another's.
  if (typeof window === 'undefined') return;
  formatLocale = intlLocaleOf(uiLocale);
}

export function getFormatLocale(): string {
  return formatLocale;
}

export function formatNumber(value: number, locale: string = formatLocale): string {
  return value.toLocaleString(locale);
}

/**
 * An amount in a currency, whole: "$12,001", "€900". Without a currency, or
 * one Intl doesn't know, the number alone.
 */
export function formatMoney(
  amount: number,
  currency: string | null,
  locale: string = formatLocale,
): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      // Not a currency code Intl knows.
    }
  }
  return formatNumber(Math.round(amount), locale);
}

/** The % change from `previous` to `current`, whole; null when there was nothing before. */
export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatCompactNumber(value: number, locale: string = formatLocale): string {
  // English keeps its k / M / B; other languages use their own compact form.
  if (!locale.startsWith('en')) {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value,
    );
  }
  const format = (num: number) => num.toFixed(1).replace(/\.0$/, '');

  if (value >= 1_000_000_000) {
    return `${format(value / 1_000_000_000)}B`;
  }

  if (value >= 1_000_000) {
    return `${format(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${format(value / 1_000)}k`;
  }

  return formatNumber(value, locale);
}

export function formatDate(iso: string | null, locale: string = formatLocale): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "Oct 17": a short day label, e.g. for a chart axis. */
export function formatMonthDay(
  iso: string,
  timeZone?: string,
  locale: string = formatLocale,
): string {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone });
}

/** "Oct 17, 2026, 2:05 PM": a date with its time, for runs on the same day. */
export function formatDateTime(iso: string, locale: string = formatLocale): string {
  return new Date(iso).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
