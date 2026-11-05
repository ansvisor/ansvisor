'use client';

import { useTranslations } from 'next-intl';
import type { ScoreRange } from '@/lib/audit/score-range';
import { cn } from '@/lib/utils';

/** What a score's range means: the lowest and highest score of the audits it read. */
export function useScoreRangeTip(): (range: ScoreRange) => string {
  const t = useTranslations('audit.range');
  return (range) =>
    range.low === range.high
      ? t('tipSame', { audits: range.audits, low: range.low })
      : t('tip', { audits: range.audits, low: range.low, high: range.high });
}

/**
 * "± 2" beside a score, which says what it means on hover. `spoken` adds
 * that for screen readers too; off where the sentence is written out next
 * to it, so it isn't read twice.
 */
export function ScoreRangeMark({
  range,
  spoken = true,
  className,
}: {
  range: ScoreRange;
  spoken?: boolean;
  className?: string;
}) {
  const t = useTranslations('audit.range');
  const tip = useScoreRangeTip()(range);
  return (
    <span
      title={tip}
      data-slot="score-range"
      className={cn('whitespace-nowrap font-medium text-muted-foreground', className)}
    >
      {t('plusMinus', { range: range.plusMinus })}
      {spoken && <span className="sr-only"> {tip}</span>}
    </span>
  );
}
