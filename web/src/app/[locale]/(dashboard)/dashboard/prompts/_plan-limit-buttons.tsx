'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { CONTACT_SALES_URL, PLANS } from '@/config/plans';
import { track } from '@/lib/analytics';
import { useUpgradeWallShown } from '@/lib/friction-events';

const BILLING = '/dashboard/settings?tab=billing';

/**
 * Where to go past the plan's prompt limit, with SIMPLE_NAV (Simplify PR 16,
 * replacing _prompt-limit-actions.tsx): Starter sees Growth's limit in
 * billing; Growth and Enterprise (custom limits) are raised by Ansvisor, so
 * they contact us. Self-hosted has no limit and no button. Each showing
 * counts as an upgrade wall, as before.
 */
export function PlanLimitButtons({
  planId,
  source,
  growthPrompts = PLANS.growth.limits.maxPrompts,
  size = 'default',
}: {
  planId: string;
  /** Where it shows, for `prompt_limit_see_growth`. */
  source: 'dialog' | 'import' | 'suggestions' | 'locations';
  growthPrompts?: number;
  /** Small beside the add paths' notes, as _prompt-limit-actions.tsx was. */
  size?: 'default' | 'sm';
}) {
  const t = useTranslations('prompts.waiting.dialog');
  useUpgradeWallShown(
    planId === 'self_hosted'
      ? null
      : { reason: 'plan_limit', feature: 'max_prompts', source: 'prompts' },
  );
  if (planId === 'self_hosted') return null;
  if (planId === 'starter') {
    return (
      <Link
        href={BILLING}
        onClick={() => track('prompt_limit_see_growth', { source })}
        className={buttonVariants({ variant: 'outline', size })}
      >
        {t('seeGrowth', { count: growthPrompts })}
      </Link>
    );
  }
  return (
    <a
      href={CONTACT_SALES_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonVariants({ variant: 'outline', size })}
    >
      {t('contact')}
      <ExternalLink />
    </a>
  );
}
