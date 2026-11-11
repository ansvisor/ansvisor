'use client';

import { useTranslations } from 'next-intl';
import { ProfileCheckButton } from './business-hub-profile-check';
import { ArrowUpRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';
import { BUSINESS_HUB_URL } from '@/lib/business-hub/links';
import { cn } from '@/lib/utils';

/**
 * The ChatGPT Business Hub block of the setup action's drawer
 * (BUSINESS_HUB_ENABLED): Business Hub itself, a step away. A task's card
 * links its own address too, but only an absolute one, and the buttons that
 * follow here open pages of the app. There is no Business Hub API, so the
 * person marks each task done; outside the regions where claiming is open
 * (the payload's `variant`), Business Agents aren't offered.
 */
export function BusinessHubContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.businessHub');
  const waitlist = payload.variant === 'waitlist';

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
      <div className="flex flex-wrap gap-2">
        <ProfileCheckButton />
        <a
          href={BUSINESS_HUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 gap-1 text-xs')}
        >
          {t('open')}
          <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
      <p className="text-xs text-muted-foreground">{t('noApi')}</p>
      {waitlist && <p className="text-xs text-muted-foreground">{t('usOnlyAgent')}</p>}
    </section>
  );
}
