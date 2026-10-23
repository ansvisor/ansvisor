'use client';

import { AlertCircle, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAiUsage } from '@/components/providers/ai-usage-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { useUserRole } from '@/hooks/use-user-role';
import { aiUsageTone, percentLabel } from '@/lib/billing/ai-usage';
import { formatMonthDay } from '@/lib/format';
import { AiUsageGetMore } from './ai-usage-get-more';

/**
 * The month's AI usage once it needs attention, under a page's header row
 * (AI usage spec §4): amber from 80%, with where to see it; red once used up,
 * saying until when AI features stop, with where to get more (other members
 * are told to ask an admin). Nothing below 80%.
 */
export function AiUsageBanner() {
  const t = useTranslations('aiUsage');
  const { usage } = useAiUsage();
  const { canAdmin } = useUserRole();
  if (!usage || usage.unlimited) return null;

  const tone = aiUsageTone(usage);
  const resets = usage.periodEnd ? formatMonthDay(usage.periodEnd) : null;

  if (tone === 'warning') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <p className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
          {t('banner.warning', { percent: percentLabel(usage.percentUsed ?? 0) })}
        </p>
        <Link
          href="/dashboard/settings/billing#ai-usage"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('banner.seeUsage')}
        </Link>
      </div>
    );
  }

  if (tone !== 'exhausted') return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900/50 dark:bg-red-950/30">
      <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
      <p className="min-w-0 flex-1 text-red-900 dark:text-red-200">
        {resets ? t('banner.exhausted', { date: resets }) : t('banner.exhaustedNoDate')}
        {!canAdmin && <> {t('askAdmin')}</>}
      </p>
      {canAdmin && (
        <div className="flex flex-wrap gap-1.5">
          <AiUsageGetMore plan={usage.plan} primary />
        </div>
      )}
    </div>
  );
}
