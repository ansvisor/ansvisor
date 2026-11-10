// The UI is English-only, so numbers use en-US separators whatever the
// browser's locale is — a Turkish browser would otherwise show 1,232 as "1.232".
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * An amount in a currency, whole: "$12,001", "€900". Without a currency, or
 * one Intl doesn't know, the number alone.
 */
export function formatMoney(amount: number, currency: string | null): string {
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      // Not a currency code Intl knows.
    }
  }
  return formatNumber(Math.round(amount));
}

/** The % change from `previous` to `current`, whole; null when there was nothing before. */
export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatCompactNumber(value: number): string {
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

  return formatNumber(value);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "Oct 17": a short day label, e.g. for a chart axis. */
export function formatMonthDay(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
}

/** "Oct 17, 2026, 2:05 PM": a date with its time, for runs on the same day. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
