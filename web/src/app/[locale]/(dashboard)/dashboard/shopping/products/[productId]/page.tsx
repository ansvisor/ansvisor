'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { getShoppingProductDetail, type ShoppingProductDetail } from '@/lib/actions/shopping';
import { useBrandStore } from '@/stores/use-brand-store';
import { ProductDetailView } from '../../_product-detail';

/**
 * A product's page in Product Visibility (ECOM-011): where it stands on the
 * AI shelves of the questions it belongs on, and "Why not your product?":
 * it beside the product AI picked for the question it's missing most, row
 * by row, with its readiness and its AI visits and orders.
 */
export default function ShoppingProductPage() {
  const t = useTranslations('shopping.detail');
  const { productId } = useParams<{ productId: string }>();
  // Opened from the Shelf's "Why not you?": the shelf to explain first.
  const search = useSearchParams();
  const prompt = search.get('prompt');
  const platform = search.get('platform');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const { canUse } = useFeatureGate();
  const [read, setRead] = useState<{
    key: string;
    detail: ShoppingProductDetail | null | 'failed';
  } | null>(null);
  const key = `${activeBrandId}:${productId}:${prompt ?? ''}:${platform ?? ''}`;

  useEffect(() => {
    if (!activeBrandId || !productId) return;
    let cancelled = false;
    getShoppingProductDetail(
      activeBrandId,
      productId,
      { datePreset: '30d' },
      prompt ? { promptId: prompt, platform } : null,
    )
      .then((detail) => {
        if (!cancelled) setRead({ key, detail });
      })
      .catch((err) => {
        console.error('Failed to read the product:', err);
        if (!cancelled) setRead({ key, detail: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, productId, key, prompt, platform]);

  const back = (
    <Link
      href="/dashboard/shopping?tab=products"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t('back')}
    </Link>
  );
  const detail = read?.key === key ? read.detail : undefined;

  if (!canUse('shopping_analytics') || detail === null || detail === 'failed') {
    return (
      <div className="space-y-6">
        {back}
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {!canUse('shopping_analytics')
            ? t('locked')
            : detail === 'failed'
              ? t('failed')
              : t('notFound')}
        </p>
      </div>
    );
  }
  if (detail === undefined) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {back}
      <ProductDetailView detail={detail} brandId={activeBrandId ?? undefined} />
    </div>
  );
}
