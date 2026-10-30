'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { useUserRole } from '@/hooks/use-user-role';

/**
 * Whether an own key is a way to get more (CHAT-16 item 19): always before
 * Chat draws on the allowance (today's Agent Chat runs on one), then only
 * on Enterprise.
 */
export function ownKeyOffered(usage: { plan: string; chatMetered?: boolean }): boolean {
  return usage.plan === 'enterprise' || !usage.chatMetered;
}

/**
 * Where to get more AI usage, in the meter's popover and the used-up banner
 * (AI usage spec §3.1, §4): a bigger plan and the workspace's own key, both
 * an admin's to change, so nothing for other members (they are told to ask
 * one). Enterprise has no bigger plan to move to. In the free trial, more
 * comes with starting the plan, so the link says so. `primary` makes the
 * plan link the area's one black button. The own-key link only where an
 * own key helps (ownKeyOffered).
 */
export function AiUsageGetMore({
  plan,
  trial = false,
  chatMetered = false,
  primary,
  onFollow,
}: {
  plan: string;
  trial?: boolean;
  chatMetered?: boolean;
  primary: boolean;
  /** When a link is followed: the popover closes. */
  onFollow?: () => void;
}) {
  const t = useTranslations('aiUsage.getMore');
  const { canAdmin } = useUserRole();
  if (!canAdmin) return null;
  return (
    <>
      {(trial || plan !== 'enterprise') && (
        <Link
          href="/dashboard/settings/billing"
          onClick={onFollow}
          className={buttonVariants({ variant: primary ? 'default' : 'outline', size: 'sm' })}
        >
          {trial ? t('startPlan') : t('plan')}
        </Link>
      )}
      {ownKeyOffered({ plan, chatMetered }) && (
        <Link
          href="/dashboard/settings/ai-providers"
          onClick={onFollow}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('ownKey')}
        </Link>
      )}
    </>
  );
}
