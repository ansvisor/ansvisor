'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Lock, LockOpen, Plus, RefreshCw, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingDots } from '@/components/ui/loading-dots';
import {
  buildDraftShoppingPath,
  getDraftShoppingPath,
  saveDraftShoppingPath,
  searchCatalogProducts,
  type CatalogProductHit,
} from '@/lib/actions/shopping-path';
import {
  placementOf,
  withAdded,
  withLocked,
  withRemoved,
  type NoPathReason,
  type ShoppingPath,
  type ShoppingProduct,
} from '@/lib/content/shopping-path';
import { pagePath } from '@/lib/content/overlap';

/** A product's price as the catalog has it, in its currency; null without one. */
export function priceText(product: Pick<ShoppingProduct, 'price' | 'salePrice' | 'currency'>) {
  const amount = product.salePrice ?? product.price;
  if (amount == null) return null;
  try {
    return product.currency
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency }).format(
          amount,
        )
      : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount);
  } catch {
    // A currency code Intl doesn't know: the amount and the code as the catalog has them.
    return `${amount} ${product.currency}`;
  }
}

type PathState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; path: ShoppingPath | null; none: NoPathReason | null };

/**
 * Brief › Shopping path (shopping path, part 3): on an online shop, the
 * category page and the catalog products this page links, picked by the
 * API for its topic (in stock, accepted by Merchant Center), with where each
 * goes. The person locks, swaps, removes or adds a product; Pick again
 * builds it anew, their choices kept. Shown for a page type that takes one
 * on an e-commerce brand.
 */
export function ShoppingPathSection({
  draftId,
  brandId,
  pageType,
}: {
  draftId: string;
  brandId: string;
  pageType: string | null;
}) {
  const t = useTranslations('contentEditor.editor.shopping');
  const [state, setState] = useState<PathState>({ status: 'loading' });
  const [busy, setBusy] = useState<'build' | 'save' | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CatalogProductHit[] | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const read = await getDraftShoppingPath(draftId);
      setState(read ? { status: 'ready', path: read.path, none: null } : { status: 'failed' });
    } catch (err) {
      console.error('Failed to read the shopping path:', err);
      setState({ status: 'failed' });
    }
  }, [draftId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Add product: the catalog's products whose name holds what's typed.
  useEffect(() => {
    if (!adding || query.trim().length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCatalogProducts(brandId, query).then(
        (found) => {
          if (!cancelled) setHits(found);
        },
        () => {
          if (!cancelled) setHits([]);
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [adding, query, brandId]);

  /** Builds the path again from the catalog, after `change` is saved when there's one. */
  const build = async (change?: ShoppingPath) => {
    setBusy('build');
    try {
      if (change) await saveDraftShoppingPath(draftId, change);
      const result = await buildDraftShoppingPath(draftId, brandId);
      if ('error' in result) toast.error(t('buildFailed'));
      else
        setState({ status: 'ready', path: result.path, none: result.path ? null : result.reason });
    } catch (err) {
      console.error('Failed to build the shopping path:', err);
      toast.error(t('saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  /** Saves a change made here (a lock, a removal), shown at once. */
  const save = async (next: ShoppingPath) => {
    const before = state;
    setState({ status: 'ready', path: next, none: null });
    setBusy('save');
    try {
      await saveDraftShoppingPath(draftId, next);
    } catch (err) {
      console.error('Failed to save the shopping path:', err);
      toast.error(t('saveFailed'));
      setState(before);
    } finally {
      setBusy(null);
    }
  };

  const header = (path: ShoppingPath | null) => (
    <div className="flex items-center gap-2">
      <ShoppingBag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <span className="flex-1" />
      {path && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={busy !== null}
          onClick={() => void build()}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {busy === 'build' ? t('building') : t('rebuild')}
        </Button>
      )}
    </div>
  );

  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-4" aria-busy="true">
        <LoadingDots className="text-muted-foreground" />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {t('loadError')}
        <button type="button" className="font-medium underline" onClick={() => void load()}>
          {t('retry')}
        </button>
      </p>
    );
  }

  const { path, none } = state;
  if (!path) {
    return (
      <section className="space-y-2 rounded-lg border p-3" aria-label={t('title')}>
        {header(null)}
        <p className="text-xs text-muted-foreground">{none ? t(`noPath.${none}`) : t('empty')}</p>
        {!none && (
          <Button size="sm" disabled={busy !== null} onClick={() => void build()}>
            {busy === 'build' ? t('building') : t('build')}
          </Button>
        )}
      </section>
    );
  }

  const locked = new Set(path.locked);
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label={t('title')}>
      {header(path)}
      <p className="text-xs text-muted-foreground">{t('description')}</p>

      <div className="space-y-1 rounded-md border p-2.5">
        <p className="text-xs text-muted-foreground">{t('category')}</p>
        {path.categories.length ? (
          path.categories.map((category) => (
            <div key={category.url} className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{category.name}</span>
                <a
                  href={category.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground underline underline-offset-4"
                >
                  {pagePath(category.url)}
                </a>
              </div>
              <p className="text-xs">{t('categoryPlace')}</p>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{t('noCategory')}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t('products', { count: path.products.length })}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          aria-expanded={adding}
          disabled={busy !== null}
          onClick={() => {
            setAdding(!adding);
            setQuery('');
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('add')}
        </Button>
      </div>

      {adding && (
        <div className="space-y-1.5">
          <Input
            type="search"
            value={query}
            maxLength={100}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {hits && hits.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('searchEmpty')}</p>
          )}
          {hits && hits.length > 0 && (
            <ul className="divide-y rounded-md border">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="w-full px-2.5 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                    disabled={busy !== null}
                    aria-label={t('addThis', { title: hit.title })}
                    onClick={() => {
                      setAdding(false);
                      setQuery('');
                      void build(withAdded(path, hit.id));
                    }}
                  >
                    {hit.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {path.products.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('noProducts')}</p>
      ) : (
        <ul className="space-y-2">
          {path.products.map((product, index) => {
            // The page type as it is now: it may have changed since the path was built.
            const place = placementOf(pageType ?? path.pageType, index);
            const isLocked = locked.has(product.id);
            const price = priceText(product);
            return (
              <li key={product.id} className="flex items-start gap-2.5 rounded-md border p-2.5">
                {product.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a store's own image, any host
                  <img
                    src={product.image}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-md border object-cover"
                  />
                ) : (
                  <div className="h-11 w-11 shrink-0 rounded-md bg-muted" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <a
                      href={product.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium hover:underline"
                    >
                      {product.title}
                    </a>
                    {price && <span className="text-xs text-muted-foreground">{price}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={
                        product.availability === 'limited_availability'
                          ? 'rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400'
                          : 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400'
                      }
                    >
                      {product.availability === 'limited_availability'
                        ? t('stock.limited_availability')
                        : t('stock.in_stock')}
                    </span>
                    {product.issues.length > 0 && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                        {t('issues', {
                          count: product.issues.length,
                          first: product.issues[0].attribute ?? product.issues[0].code,
                        })}
                      </span>
                    )}
                    {isLocked && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t('locked')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(`place.${place.key}`, { n: place.n })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    aria-pressed={isLocked}
                    aria-label={
                      isLocked
                        ? t('unlock', { title: product.title })
                        : t('lock', { title: product.title })
                    }
                    disabled={busy !== null}
                    onClick={() => void save(withLocked(path, product.id, !isLocked))}
                  >
                    {isLocked ? (
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    aria-label={t('swapLabel', { title: product.title })}
                    disabled={busy !== null}
                    onClick={() => void build(withRemoved(path, product.id))}
                  >
                    {t('swap')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    aria-label={t('removeLabel', { title: product.title })}
                    disabled={busy !== null}
                    onClick={() => void save(withRemoved(path, product.id))}
                  >
                    {t('remove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {path.leftOut.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('leftOut')}</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {path.leftOut.map((item) => (
              <li key={item.id}>
                {item.title} · {t(`reason.${item.reason}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('lockHint')}</p>
    </section>
  );
}
