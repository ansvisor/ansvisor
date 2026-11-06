'use client';

import { useTranslations } from 'next-intl';
import { TabError } from '@/components/brand-visibility/tab-error';

/** The Product Visibility tab broke while drawing: the other tabs still open. */
export default function ProductsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('brandVisibility.readError');
  return <TabError {...props} title={t('products')} />;
}
