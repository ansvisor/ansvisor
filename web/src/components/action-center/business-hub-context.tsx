'use client';

import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { BUSINESS_HUB_URL } from '@/lib/business-hub/links';
import { cn } from '@/lib/utils';

/** Visibility's Business Hub card, its Enter numbers dialog open. */
export const ENTER_NUMBERS_HREF = '/dashboard/insights?businessHub=enter';

/**
 * The ChatGPT Business Hub block of the setup action's drawer
 * (BUSINESS_HUB_ENABLED): Business Hub itself, a step away. A task's card
 * links its own address too, but only an absolute one, and the buttons that
 * follow here open pages of the app. There is no Business Hub API, so the
 * person marks each task done; outside the regions where claiming is open
 * (the payload's `variant`), Business Agents aren't offered. Enter numbers
 * opens Visibility's Business Hub card with its dialog. The weekly reminder
 * to enter the numbers shows it too, saying how the reminder ends.
 */
export function BusinessHubContext({
  payload,
  reminder = false,
}: {
  payload: Record<string, unknown>;
  /** The weekly reminder to enter the numbers: it closes itself, and Not relevant stops it. */
  reminder?: boolean;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.businessHub');
  const waitlist = payload.variant === 'waitlist';

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={BUSINESS_HUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 gap-1 text-xs')}
        >
          {t('open')}
          <ArrowUpRight className="h-3 w-3" />
        </a>
        <Link
          href={ENTER_NUMBERS_HREF}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
        >
          {t('enterNumbers')}
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">{t(reminder ? 'reminder' : 'noApi')}</p>
      {waitlist && <p className="text-xs text-muted-foreground">{t('usOnlyAgent')}</p>}
    </section>
  );
}
