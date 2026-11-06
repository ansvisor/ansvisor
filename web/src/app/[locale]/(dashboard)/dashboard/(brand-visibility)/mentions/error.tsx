'use client';

import { useTranslations } from 'next-intl';
import { TabError } from '@/components/brand-visibility/tab-error';

/** The Mentions tab broke while drawing: the Overview and Citations still open. */
export default function MentionsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('brandVisibility.readError');
  return <TabError {...props} title={t('mentions')} />;
}
