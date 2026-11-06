'use client';

import { useTranslations } from 'next-intl';
import { TabError } from '@/components/brand-visibility/tab-error';

/** The Overview broke while drawing: Mentions and Citations still open. */
export default function OverviewError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('brandVisibility.readError');
  return <TabError {...props} title={t('overview')} />;
}
