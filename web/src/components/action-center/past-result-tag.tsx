'use client';

import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PriorityReason } from '@/lib/action-center/priority';

/** Fewest earlier results with a verdict before the track is worth showing. */
export const PAST_RESULT_MIN = 2;

/** The past result to show for an action, or null with too little history. */
export function shownPastResult(
  reason: PriorityReason | null | undefined,
): NonNullable<PriorityReason['pastSuccess']> | null {
  const past = reason?.pastSuccess;
  return past && past.results >= PAST_RESULT_MIN ? past : null;
}

/**
 * "4 of 7 worked" beside an action's priority: how the brand's earlier
 * actions of this kind (or with this play) turned out, as the score already
 * weighs them (learning B4). A measured track, never a forecast. Hover or
 * focus says it in full. Nothing with fewer than two results.
 * A click on it stays on it: in a table row, it doesn't open the drawer.
 */
export function PastResultTag({ reason }: { reason?: PriorityReason | null }) {
  const t = useTranslations('actionCenter.actionsPage.priority');
  const past = shownPastResult(reason);
  if (!past) return null;
  const sentence = t(
    (past.points !== 0 ? past.points > 0 : past.improved * 2 >= past.results)
      ? 'reason.pastSuccess.worked'
      : 'reason.pastSuccess.rarely',
    {
      improved: past.improved,
      results: past.results,
      by: past.play ? 'play' : 'kind',
    },
  );
  const tip = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        closeDelay={0}
        render={
          <button
            type="button"
            aria-label={`${t('pastTag', { improved: past.improved, results: past.results })}: ${tip}`}
            onClick={(event) => event.stopPropagation()}
            className="cursor-help whitespace-nowrap rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        }
      >
        {t('pastTag', { improved: past.improved, results: past.results })}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-start">{tip}.</TooltipContent>
    </Tooltip>
  );
}
