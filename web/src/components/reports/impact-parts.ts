import type { useTranslations } from 'next-intl';
import type { ImpactOutcome, ImpactRow } from '@/lib/impact/report';

/**
 * How a shipped change's outcome reads wherever the impact ledger shows it:
 * Reports › "What Ansvisor did for you" and an agent's "What this agent
 * did". One set of pills, words and numbers for both.
 */

/** Each outcome's pill, in both themes (the Action Center's colors). */
export const OUTCOME_PILL: Record<ImpactOutcome, string> = {
  improved:
    'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300',
  pending: 'text-muted-foreground',
  no_meaningful_change: 'text-foreground/80',
  declined:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  not_measurable:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
};

export const PILL =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap';

/** A signed number as the table shows it: "+12", "−3", and "0" with no sign. */
export const signed = (value: number) =>
  value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';

/** The words of Reports' impact page (reports.impact). */
export type ImpactWords = ReturnType<typeof useTranslations<'reports.impact'>>;

/** "Pending · early signal" once day 7 is in; else the outcome's word. */
export function outcomeLabel(row: Pick<ImpactRow, 'outcome' | 'checkpoint'>, t: ImpactWords) {
  if (row.outcome === 'pending' && row.checkpoint === 'd7') return t('outcome.pendingEarly');
  return t(`outcome.${row.outcome}`);
}
