// The UI is English-only, so numbers use en-US separators whatever the
// browser's locale is — a Turkish browser would otherwise show 1,232 as "1.232".
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
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
