'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';

/**
 * The link to a new brand (/dashboard/brands/new). On a read-only workspace
 * (plan not active) it opens the upgrade dialog instead of the page.
 */
export function AddBrandLink({ className, children }: { className?: string; children: ReactNode }) {
  const { isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  return (
    <Link
      href="/dashboard/brands/new"
      className={className}
      onClick={(e) => {
        if (!isLocked) return;
        e.preventDefault();
        openUpgrade(tActions('addBrands'));
      }}
    >
      {children}
    </Link>
  );
}
