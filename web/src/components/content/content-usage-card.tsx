'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Gauge, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  hasContentQuota,
  usagePercent,
  usageTone,
  type ContentUsage,
  type UsageCounter,
  type UsageTone,
} from '@/lib/content-usage';

const BAR_CLASS: Record<UsageTone, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-500',
  exhausted: 'bg-red-500',
  unlimited: 'bg-muted-foreground/30',
};

const LEFT_CLASS: Record<UsageTone, string> = {
  normal: 'text-muted-foreground',
  warning: 'text-amber-600 dark:text-amber-400',
  exhausted: 'text-red-600 dark:text-red-400',
  unlimited: 'text-muted-foreground',
};

/**
 * This billing period's content usage (CONTENT-001): new opportunities and
 * briefs against the plan's two monthly limits, and when they renew. Renders
 * nothing on plans that limit neither (self-hosted, unlimited Enterprise).
 */
export function ContentUsageCard({
  usage,
  className,
}: {
  usage: ContentUsage | null;
  className?: string;
}) {
  const t = useTranslations('content.usage');
  const locale = useLocale();

  if (!hasContentQuota(usage)) return null;

  const resets = usage.periodEnd
    ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        new Date(usage.periodEnd),
      )
    : null;
  const exhausted =
    usageTone(usage.opportunities) === 'exhausted' || usageTone(usage.briefs) === 'exhausted';

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t('title')}
        </CardTitle>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-flex cursor-help"
            title={t('tooltip', { date: resets ?? '' })}
            aria-label={t('tooltip', { date: resets ?? '' })}
          >
            <Info className="h-3.5 w-3.5" />
          </span>
          <Gauge className="h-3.5 w-3.5" />
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        <Counter label={t('opportunities')} counter={usage.opportunities} />
        <Counter label={t('briefs')} counter={usage.briefs} />
        <p className="text-xs text-muted-foreground">
          {[
            usage.planName && t('plan', { plan: usage.planName }),
            resets && t('resets', { date: resets }),
          ]
            .filter(Boolean)
            .join(' · ')}
          {exhausted && usage.plan === 'starter' && (
            <>
              {' · '}
              <Link
                href="/dashboard/settings?tab=billing"
                className="font-medium text-foreground underline underline-offset-2"
              >
                {t('upgrade')}
              </Link>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function Counter({ label, counter }: { label: string; counter: UsageCounter }) {
  const t = useTranslations('content.usage');
  const tone = usageTone(counter);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        {tone === 'unlimited' ? (
          <span className="text-muted-foreground">{t('unlimited')}</span>
        ) : (
          <span className="tabular-nums">
            <span className="text-sm font-semibold">{counter.used}</span>
            <span className="text-muted-foreground"> / {counter.limit}</span>
          </span>
        )}
      </div>
      {tone !== 'unlimited' && (
        <>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', BAR_CLASS[tone])}
              style={{ width: `${usagePercent(counter)}%` }}
            />
          </div>
          <p className={cn('mt-0.5 text-[11px] tabular-nums', LEFT_CLASS[tone])}>
            {tone === 'exhausted'
              ? t('limitReached')
              : t('remaining', { count: counter.remaining })}
          </p>
        </>
      )}
    </div>
  );
}
