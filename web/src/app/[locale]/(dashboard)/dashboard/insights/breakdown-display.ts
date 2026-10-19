import type { BreakdownRow } from '@/lib/actions/tracking';

export function sortBreakdownRowsForDisplay(rows: BreakdownRow[]): BreakdownRow[] {
  return [...rows].sort((a, b) => {
    const currentDiff = b.cur - a.cur;
    if (currentDiff !== 0) return currentDiff;

    const deltaDiff = b.delta - a.delta;
    if (deltaDiff !== 0) return deltaDiff;

    return a.label.localeCompare(b.label);
  });
}
