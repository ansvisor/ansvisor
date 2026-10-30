'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { useUserRole } from '@/hooks/use-user-role';
import { useGetMore } from './get-more-context';

/**
 * Where to get more AI usage, in the meter's popover and the used-up banner
 * (AI usage spec §3.1, §4; CHAT-18 §B item 6). With Chat on, Get more AI
 * credits opens the Get more window, for every member: the others see the
 * packs there and ask an Admin. Otherwise a bigger plan, an admin's to
 * change, and nothing for other members (they are told to ask one);
 * Enterprise has no bigger plan to move to. In the free trial, more comes
 * with starting the plan, so the link says so (the trial can't buy packs).
 * Use your own key: Enterprise's while Chat draws on the AI budget, and
 * every plan's while it doesn't (DECISIONS S; the same rule as
 * ownKeyOffered in feature/own-keys-enterprise-only: keep one once both
 * land). `primary` makes the first one the area's one black button.
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
  /** Chat draws on the AI budget (CHAT_AGENTIC on). */
  chatMetered?: boolean;
  primary: boolean;
  /** When a link is followed: the popover closes. */
  onFollow?: () => void;
}) {
  const t = useTranslations('aiUsage.getMore');
  const { canAdmin } = useUserRole();
  const openGetMore = useGetMore();
  const getMore = openGetMore && !trial ? openGetMore : null;
  if (!canAdmin && !getMore) return null;
  const ownKey = canAdmin && (plan === 'enterprise' || !chatMetered);
  return (
    <>
      {getMore ? (
        <Button
          size="sm"
          variant={primary ? 'default' : 'outline'}
          data-action="credits.getMore"
          onClick={() => {
            onFollow?.();
            getMore('ai');
          }}
        >
          {t('credits')}
        </Button>
      ) : (
        (trial || plan !== 'enterprise') && (
          <Link
            href="/dashboard/settings/billing"
            onClick={onFollow}
            className={buttonVariants({ variant: primary ? 'default' : 'outline', size: 'sm' })}
          >
            {trial ? t('startPlan') : t('plan')}
          </Link>
        )
      )}
      {ownKey && (
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
