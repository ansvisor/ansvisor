'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { useUserRole } from '@/hooks/use-user-role';
import { StartPlanNow, StartPlanNowButton } from './start-plan-now';

/**
 * Where to get more AI usage, in the meter's popover and the used-up banner
 * (AI usage spec §3.1, §4): a bigger plan and the workspace's own key, both
 * an admin's to change, so nothing for other members (they are told to ask
 * one). Enterprise has no bigger plan to move to. In the free trial, more
 * comes with starting the plan: Start my plan now ends the trial here.
 * `primary` makes the plan button the area's one black button.
 */
export function AiUsageGetMore({
  plan,
  trial = false,
  primary,
  onFollow,
  onStartPlan,
}: {
  plan: string;
  trial?: boolean;
  primary: boolean;
  /** When a link is followed: the popover closes. */
  onFollow?: () => void;
  /**
   * Start my plan now in a popover, which holds the dialog outside itself:
   * without it, the button brings its own dialog.
   */
  onStartPlan?: () => void;
}) {
  const t = useTranslations('aiUsage.getMore');
  const { canAdmin } = useUserRole();
  if (!canAdmin) return null;
  return (
    <>
      {trial ? (
        onStartPlan ? (
          <StartPlanNowButton variant={primary ? 'default' : 'outline'} onClick={onStartPlan} />
        ) : (
          <StartPlanNow variant={primary ? 'default' : 'outline'} />
        )
      ) : (
        plan !== 'enterprise' && (
          <Link
            href="/dashboard/settings/billing"
            onClick={onFollow}
            className={buttonVariants({ variant: primary ? 'default' : 'outline', size: 'sm' })}
          >
            {t('plan')}
          </Link>
        )
      )}
      <Link
        href="/dashboard/settings/ai-providers"
        onClick={onFollow}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        {t('ownKey')}
      </Link>
    </>
  );
}
