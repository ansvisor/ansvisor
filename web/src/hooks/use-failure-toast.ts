'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-failure';

/**
 * A failed call as a toast (BUG-001): the reason in plain words and the one
 * thing to do about it — sign in again, switch brand, reload, or upgrade.
 */
export function useFailureToast() {
  const t = useTranslations('apiFailure');
  const router = useRouter();
  return useCallback(
    (failure: ApiFailure, options: { id?: string | number; description?: string } = {}) => {
      const action = (() => {
        switch (failure) {
          case 'session':
            return { label: t('signIn'), onClick: () => router.push('/sign-in') };
          case 'workspace':
            return { label: t('yourBrands'), onClick: () => router.push('/dashboard/brands') };
          case 'not_found':
            return { label: t('reload'), onClick: () => window.location.reload() };
          case 'plan':
          case 'limit':
            return {
              label: t('upgrade'),
              onClick: () => router.push('/dashboard/settings/billing'),
            };
          case 'busy':
          case 'failed':
            return undefined;
        }
      })();
      toast.error(t(failure), { ...options, ...(action ? { action } : {}) });
    },
    [t, router],
  );
}
