'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  CHOOSE_PLAN_HREF,
  ReadOnlyAction,
  useAskAdmin,
  useUpgradeDialog,
} from '@/components/providers/upgrade-dialog-provider';
import { useUserRole } from '@/hooks/use-user-role';
import type { ReadOnlyReason } from '@/lib/billing/subscription-access';

/**
 * A thin band across the top of the dashboard while the workspace is
 * read-only: that it is, and the way out — See plans (the upgrade dialog; not
 * on Billing, which has them) or, for a payment being retried, Update payment
 * method for admins and an admin to ask for everyone else. Nothing while the
 * plan is active.
 */
export function ReadOnlyBanner() {
  const state = useUpgradeDialog();
  if (!state?.isLocked) return null;
  return <Band reason={state.reason} adminName={state.adminName} openUpgrade={state.openUpgrade} />;
}

function Band({
  reason,
  adminName,
  openUpgrade,
}: {
  reason: ReadOnlyReason;
  adminName: string | null;
  openUpgrade: () => void;
}) {
  const t = useTranslations('readOnly');
  const { canAdmin } = useUserRole();
  const pathname = usePathname();
  const ask = useAskAdmin(reason, adminName);
  const payment = reason === 'payment_failed';

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <p className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
        {t(`banner.${reason}`)}
        {payment && !canAdmin && <> {ask}</>}
      </p>
      {payment ? (
        canAdmin && <ReadOnlyAction reason={reason} variant="outline" size="sm" />
      ) : pathname.startsWith(CHOOSE_PLAN_HREF) ? null : (
        <Button variant="outline" size="sm" onClick={() => openUpgrade()}>
          {t('banner.seePlans')}
        </Button>
      )}
    </div>
  );
}
