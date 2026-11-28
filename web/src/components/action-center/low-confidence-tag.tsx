'use client';

import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PriorityConfidence } from '@/lib/action-center/priority';

/**
 * "Single source" beside an action's priority (AC-26): the score says how
 * much the action could matter, and stays as it is; this says its findings
 * come from one kind of evidence (most often the AI answers alone), not that
 * they are unsure. Hover or focus says why, and what would confirm it. A
 * neutral tag, not a warning. Nothing at medium or high confidence, or
 * before the score kept one.
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
            className="cursor-help whitespace-nowrap rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        }
      >
        {t('reason.confidence.low')}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-start">{tip}</TooltipContent>
    </Tooltip>
  );
}
