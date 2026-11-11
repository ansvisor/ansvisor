'use client';

import { useTranslations } from 'next-intl';
import { MessageSquareText } from 'lucide-react';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { composeHref } from '@/lib/chat/compose-param';
import { cn } from '@/lib/utils';

/** The ChatGPT profile check's /command (skills/chatgpt-profile, Business Hub plan PR 7). */
export const PROFILE_CHECK = '/chatgpt-profile';

/**
 * **Check what ChatGPT says**, in the setup action's Business Hub block
 * (business-hub-context.tsx): Chat with the ChatGPT profile check in its box.
 * The person reads it and sends it; the run is an ordinary Chat run on the
 * AI budget. Only with the new Chat on for the workspace, where the skill
 * is; the action itself shows only with BUSINESS_HUB_ENABLED on, as the
 * skill does.
 */
export function ProfileCheckButton() {
  const t = useTranslations('actionCenter.actionsPage.drawer.businessHub');
  const chatOn = useChatAgentic();
  if (!chatOn) return null;
  return (
    <Link
      href={composeHref(`${PROFILE_CHECK} ${t('checkText')}`)}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 gap-1 text-xs')}
    >
      <MessageSquareText className="h-3 w-3" />
      {t('check')}
    </Link>
  );
}
