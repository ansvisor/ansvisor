'use client';

import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PriorityConfidence } from '@/lib/action-center/priority';

/**
 * "Low confidence" beside an action's priority (AC-26): the score says how
 * much the action could matter, and stays as it is; this says it rests on
 * little, such as one kind of finding from one source. Hover or focus says
 * why. Nothing at medium or high confidence, or before the score kept one.
 * A click on it stays on it: in a table row, it doesn't open the drawer.
 */
export function LowConfidenceTag({ confidence }: { confidence?: PriorityConfidence | null }) {
  const t = useTranslations('actionCenter.actionsPage.priority');
  if (confidence?.level !== 'low') return null;
  const tip =
    confidence.kinds > 0
      ? t('lowConfidence.tip', {
          why: t('reason.confidence.found', {
            kinds: confidence.kinds,
            sources: confidence.sources,
          }),
        })
      : t('lowConfidence.sentTip');
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        closeDelay={0}
        render={
          <button
            type="button"
            aria-label={`${t('reason.confidence.low')}: ${tip}`}
            onClick={(event) => event.stopPropagation()}
            className="cursor-help whitespace-nowrap rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-amber-400"
          />
        }
      >
        {t('reason.confidence.low')}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-start">{tip}</TooltipContent>
    </Tooltip>
  );
}
