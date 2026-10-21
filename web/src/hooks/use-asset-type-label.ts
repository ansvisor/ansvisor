'use client';

import { useTranslations } from 'next-intl';
import { assetKind, isEarnedAssetType } from '@/lib/content/asset-types';
import { siteTypeOf } from '@/lib/content/page-types';
import { useBrandStore } from '@/stores/use-brand-store';

/**
 * A Content Opportunity asset's type as the person reads it on the active
 * brand's kind of site ("Feature page", "Backlink"), an older type read as
 * the page type it stands for there; null for a type it doesn't know.
 */
export function useAssetTypeLabel(): (type: string | null | undefined) => string | null {
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const siteType = siteTypeOf(activeBrand ?? {});
  const t = useTranslations('content.assetType');
  const tTypes = useTranslations('contentEditor.pageTypes');
  return (type) => {
    const kind = assetKind(type, siteType);
    if (!kind) return null;
    return isEarnedAssetType(kind) ? t(kind) : tTypes(kind);
  };
}
