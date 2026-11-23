'use client';

import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { OpportunityFlowState } from '@/lib/opportunity-flow';

/**
 * Says why no new opportunities arrive overnight (opportunity-flow.ts) and
 * what brings more: the quota's renewal, or new prompts, finished work marked
 * Done and "+ New".
 */
export function OpportunityFlowNote({
  state,
  resetsOn,
  canManage,
}: {
  state: OpportunityFlowState;
  /** When the month's quota renews, already formatted; '' when unknown. */
  resetsOn: string;
  canManage: boolean;
}) {
  const t = useTranslations('content.flowNote');
  const limit = state === 'limit';

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-md border p-3 text-sm',
        limit
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
          : 'bg-muted/40',
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">
          {limit
            ? resetsOn
              ? t('limitTitle', { date: resetsOn })
              : t('limitTitleNoDate')
            : t('coveredTitle')}
        </p>
        {!limit && (
          <p className="text-muted-foreground">
            {t.rich(canManage ? 'coveredHint' : 'coveredHintReadOnly', {
              prompts: (chunks) => (
                <Link href="/dashboard/prompts" className="text-foreground underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
      </div>
    </div>
  );
}
