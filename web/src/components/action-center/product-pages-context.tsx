'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { setProductGroupSize } from '@/lib/actions/action-center';
import { pagePath } from '@/lib/content/overlap';
import { priceText } from '@/lib/shopping/price';
import { cn } from '@/lib/utils';

/** The group sizes a person picks from (server action-center/product-page-groups.js). */
export const GROUP_SIZES = [3, 5, 10] as const;
const DEFAULT_GROUP_SIZE = 5;

export interface ProductPage {
  url: string;
  title: string;
  prompts: number;
  aiVisits: number;
  orders: number;
  revenue: number | null;
  currency: string | null;
}

const count = (value: unknown) => Math.max(0, Number(value) || 0);

/** The payload's products (payload.products), best first, read defensively. */
export function productPagesOf(payload: Record<string, unknown>): ProductPage[] {
  const raw = Array.isArray(payload.products) ? payload.products : [];
  return raw.flatMap((item) => {
    const p = (item ?? {}) as Record<string, unknown>;
    if (typeof p.url !== 'string' || !/^https?:\/\//i.test(p.url)) return [];
    const revenue = p.revenue === null || p.revenue === undefined ? null : Number(p.revenue);
    return [
      {
        url: p.url,
        title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : pagePath(p.url),
        prompts: count(p.prompts),
        aiVisits: count(p.aiVisits),
        orders: count(p.orders),
        revenue: revenue !== null && Number.isFinite(revenue) && revenue > 0 ? revenue : null,
        currency: typeof p.currency === 'string' ? p.currency : null,
      },
    ];
  });
}

/** The group size the action works on: one of GROUP_SIZES, else the default. */
export function groupSizeOf(payload: Record<string, unknown>): number {
  const size = Number(payload.groupSize);
  return (GROUP_SIZES as readonly number[]).includes(size) ? size : DEFAULT_GROUP_SIZE;
}

/**
 * A product pages action (G21, AC plan P-6, spec §6.1): an online store's
 * products AI shopping answers show or that sell, best first, and how many
 * of them it works on now. 3, 5 or 10 at a time: the person picks, and the
 * action's pages, count and Start now follow. The rest wait as Next.
 */
export function ProductPagesContext({
  payload,
  brandId,
  actionId,
  editable,
  onChanged,
}: {
  payload: Record<string, unknown>;
  brandId: string;
  actionId: string;
  /** Open, and the person may change it. */
  editable: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.productPages');
  const products = productPagesOf(payload);
  const size = groupSizeOf(payload);
  const [busy, setBusy] = useState(false);

  const pick = async (next: number) => {
    if (busy || next === size) return;
    setBusy(true);
    try {
      await setProductGroupSize(brandId, actionId, next);
      toast.success(t('groupSizeSaved', { size: next }));
      await onChanged();
    } catch {
      toast.error(t('groupSizeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const row = (product: ProductPage) => (
    <li key={product.url} className="rounded-md border px-3 py-2 text-xs">
      <p className="truncate font-medium" title={product.title}>
        {product.title}
      </p>
      <p className="truncate font-mono text-muted-foreground" title={product.url}>
        {pagePath(product.url)}
      </p>
      <p className="mt-0.5 tabular-nums text-muted-foreground">
        {t('figures', { prompts: product.prompts })}
      </p>
      <p className="tabular-nums text-muted-foreground">
        {t('sales', { orders: product.orders, aiVisits: product.aiVisits })}
        {product.revenue !== null &&
          ` · ${t('revenue', { revenue: priceText(product.revenue, product.currency) })}`}
      </p>
    </li>
  );

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('why')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t('groupSize')}</span>
        <div role="group" aria-label={t('groupSize')} className="inline-flex rounded-md border">
          {GROUP_SIZES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === size}
              disabled={!editable || busy}
              onClick={() => void pick(option)}
              className={cn(
                'px-2.5 py-1 text-xs tabular-nums first:rounded-l-md last:rounded-r-md disabled:cursor-not-allowed',
                option === size
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t('groupSizeLabel', { size: option })}
            </button>
          ))}
        </div>
      </div>
      {products.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('inGroup')}</p>
          <ul className="mt-1.5 space-y-1.5">{products.slice(0, size).map(row)}</ul>
        </div>
      )}
      {products.length > size && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('next')}</p>
          <ul className="mt-1.5 space-y-1.5 opacity-80">{products.slice(size).map(row)}</ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('startNow')}</p>
    </section>
  );
}
