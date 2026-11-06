'use client';

import { useTranslations } from 'next-intl';
import { TabError } from '@/components/brand-visibility/tab-error';

/** The Citations tab broke while drawing: the Overview and Mentions still open. */
export default function CitationsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('brandVisibility.readError');
  return <TabError {...props} title={t('citations')} />;
}
