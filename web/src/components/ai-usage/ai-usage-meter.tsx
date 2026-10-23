'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAiUsage } from '@/components/providers/ai-usage-provider';
import { AiUsageBanner } from './ai-usage-banner';
import { AiUsageGetMore } from './ai-usage-get-more';
import { buttonVariants } from '@/components/ui/button-variants';
import { LoadingDots } from '@/components/ui/loading-dots';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { useUserRole } from '@/hooks/use-user-role';
import {
  aiUsageTone,
  percentLabel,
  type UsageCount,
  type UsageLimits,
} from '@/lib/billing/ai-usage';
import { readUsageLimits } from '@/lib/billing/ai-usage-client';
import type { UsageTone } from '@/lib/content-usage';
import { formatMonthDay, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';

/** Black under 80%, amber from 80%, red once used up (AI usage spec §4). */
const METER_CLASS: Record<UsageTone, string> = {
  normal: 'border-border text-foreground',
  warning: 'border-amber-500/70 text-amber-700 dark:border-amber-400/60 dark:text-amber-400',
  exhausted: 'border-red-500/70 text-red-700 dark:border-red-400/60 dark:text-red-400',
  unlimited: 'border-border text-muted-foreground',
};

const FILL_CLASS: Record<UsageTone, string> = {
  normal: 'bg-foreground',
  warning: 'bg-amber-500',
  exhausted: 'bg-red-500',
  unlimited: 'bg-muted-foreground/30',
};

const LABEL_KEY = {
  normal: 'meter.label',
  warning: 'meter.labelWarning',
  exhausted: 'meter.labelExhausted',
  unlimited: 'meter.label',
} as const satisfies Record<UsageTone, string>;

/**
 * A page's header row with the AI usage meter at its far right, on the
 * title's line (AI usage spec §3.1): the same place on every page, however
 * the row's own buttons wrap beside it. On a phone it goes under the row, on
 * the right, so the row keeps the whole width for its buttons. From 80% of
 * the month's allowance the banner follows the row (spec §4), spaced as the
 * page spaces its parts.
 */
export function HeaderWithAiUsage({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 sm:flex-1">{children}</div>
        <AiUsageMeter className="self-end sm:self-auto" />
      </div>
      <AiUsageBanner />
    </>
  );
}

/**
 * "AI 21%" at the far right of a page's header row (AI usage spec §3.1): the
 * share of the workspace's monthly AI allowance used, with a small bar. A
 * click opens what used it, what doesn't count, the limits that aren't AI,
 * and where to get more: getting more and an own key are an admin's to
 * change, so other members are told to ask one. Nothing on a plan without an
 * allowance; while the first read runs, an empty box of its size keeps the
 * header row from shifting.
 */
export function AiUsageMeter({ className }: { className?: string }) {
  const t = useTranslations('aiUsage');
  const tFeature = useTranslations('settings.aiUsageMeter.features');
  const tCommon = useTranslations('common');
  const { usage, refresh } = useAiUsage();
  const { canAdmin } = useUserRole();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [open, setOpen] = useState(false);
  // Undefined until the popover first opens, null while that first read runs;
  // a later opening keeps what it shows until the new read lands.
  const [limits, setLimits] = useState<UsageLimits | null | undefined>(undefined);
  // The latest read, so an earlier one landing late can't replace it.
  const limitsRead = useRef(0);

  if (usage === undefined) {
    return (
      <span
        aria-hidden
        className={cn('hidden h-8 w-[5.75rem] shrink-0 sm:inline-block', className)}
      />
    );
  }
  if (usage === null || usage.unlimited) return null;

  const tone = aiUsageTone(usage);
  const percent = usage.percentUsed ?? 0;
  const used = percentLabel(percent);
  const width = `${Math.min(100, percent)}%`;
  const resets = usage.periodEnd ? formatMonthDay(usage.periodEnd) : null;
  // A warning or a used-up allowance makes Get more the primary button (spec §4).
  const pressing = tone === 'warning' || tone === 'exhausted';

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    refresh();
    setLimits((shown) => shown ?? null);
    const id = ++limitsRead.current;
    void readUsageLimits(brandId).then((read) => {
      if (id === limitsRead.current) setLimits(read);
    });
  };
  const close = () => setOpen(false);

  const count = ({ used: n, limit }: UsageCount) =>
    t('popover.ofLimit', { used: formatNumber(n), limit: formatNumber(limit) });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={t(LABEL_KEY[tone], { percent: used })}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-2 rounded-full border bg-background px-3 text-xs font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted',
          METER_CLASS[tone],
          className,
        )}
      >
        <span aria-hidden>{t('meter.ai')}</span>
        <span aria-hidden className="block h-1.5 w-11 overflow-hidden rounded-full bg-muted">
          <span className={cn('block h-full rounded-full', FILL_CLASS[tone])} style={{ width }} />
        </span>
        <span aria-hidden className="tabular-nums">
          {used}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
        <PopoverTitle className="text-xs font-normal text-muted-foreground">
          {usage.planName ? t('popover.title', { plan: usage.planName }) : t('popover.titleNoPlan')}
        </PopoverTitle>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums">{used}</p>
        <div
          role="progressbar"
          aria-label={t('popover.titleNoPlan')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(percent)}
          aria-valuetext={used}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className={cn('h-full rounded-full', FILL_CLASS[tone])} style={{ width }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {resets ? t('popover.shared', { date: resets }) : t('popover.sharedNoDate')}
        </p>
        {tone === 'exhausted' && (
          <p className="mt-2 text-xs text-red-700 dark:text-red-400">
            {resets ? t('popover.exhausted', { date: resets }) : t('popover.exhaustedNoDate')}
          </p>
        )}

        <ul className="mt-3 divide-y border-t text-[13px]">
          {usage.features.map(({ feature, percent: share }) => (
            <li key={feature} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-muted-foreground">{tFeature(feature)}</span>
              <span className="font-medium tabular-nums">{percentLabel(share)}</span>
            </li>
          ))}
        </ul>

        <ul className="mt-1 border-t text-[13px]">
          <li className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-muted-foreground">{t('popover.ownKey')}</span>
            <span className="font-medium">{t('popover.notCounted')}</span>
          </li>
        </ul>

        {limits !== undefined &&
          (limits === null || limits.auditPages || limits.promptLocations) && (
            <>
              <p className="mt-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t('popover.otherLimits')}
              </p>
              {limits === null ? (
                <p className="mt-1 border-t py-1.5 text-muted-foreground">
                  <LoadingDots />
                  <span className="sr-only">{tCommon('loading')}</span>
                </p>
              ) : (
                <ul className="mt-1 divide-y border-t text-[13px]">
                  {limits.auditPages && (
                    <li className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-muted-foreground">{t('popover.auditPages')}</span>
                      <span className="font-medium tabular-nums">{count(limits.auditPages)}</span>
                    </li>
                  )}
                  {limits.promptLocations && (
                    <li className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-muted-foreground">{t('popover.promptLocations')}</span>
                      <span className="font-medium tabular-nums">
                        {count(limits.promptLocations)}
                      </span>
                    </li>
                  )}
                </ul>
              )}
            </>
          )}

        {!canAdmin && <p className="mt-3 text-xs text-muted-foreground">{t('askAdmin')}</p>}
        <div className="mt-4 flex flex-wrap gap-1.5">
          <AiUsageGetMore plan={usage.plan} primary={pressing} onFollow={close} />
          <Link
            href="/dashboard/settings/billing#ai-usage"
            onClick={close}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            {t('popover.details')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
