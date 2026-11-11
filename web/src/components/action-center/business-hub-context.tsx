'use client';

import { useTranslations } from 'next-intl';
import { ArrowUpRight, MessageSquareText } from 'lucide-react';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { BUSINESS_HUB_URL } from '@/lib/business-hub/links';
import { composeHref } from '@/lib/chat/compose-param';
import { cn } from '@/lib/utils';

/** The ChatGPT profile check's /command (skills/chatgpt-profile, Business Hub plan PR 7). */
const PROFILE_CHECK = '/chatgpt-profile';

/**
 * The ChatGPT Business Hub block of the setup action's drawer
 * (BUSINESS_HUB_ENABLED): Business Hub itself, a step away. A task's card
 * links its own address too, but only an absolute one, and the buttons that
 * follow here open pages of the app. There is no Business Hub API, so the
 * person marks each task done; outside the regions where claiming is open
 * (the payload's `variant`), Business Agents aren't offered.
 *
 * **Check what ChatGPT says** opens Chat with the ChatGPT profile check in
 * its box (/chatgpt-profile): the person reads it and sends it, and the run
 * is an ordinary Chat run on the AI budget. Only with the new Chat on for
 * the workspace, where the skill is.
 */
export function BusinessHubContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.businessHub');
  const waitlist = payload.variant === 'waitlist';
  const chatOn = useChatAgentic();

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
        {chatOn && (
          <Link
            href={composeHref(`${PROFILE_CHECK} ${t('checkText')}`)}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 gap-1 text-xs')}
          >
            <MessageSquareText className="h-3 w-3" />
            {t('check')}
          </Link>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('noApi')}</p>
      {waitlist && <p className="text-xs text-muted-foreground">{t('usOnlyAgent')}</p>}
    </section>
  );
}
