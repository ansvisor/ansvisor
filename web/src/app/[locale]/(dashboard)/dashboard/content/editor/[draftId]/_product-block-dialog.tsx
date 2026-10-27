'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  getProductsForBlock,
  searchCatalogProducts,
  type CatalogProductHit,
} from '@/lib/actions/shopping-path';
import { MAX_BLOCK_PRODUCTS, productBlockHtml } from '@/lib/content/product-block';
import { priceText } from './_shopping-path';

/**
 * + Insert › Products (shopping path, part 5): the person searches the
 * brand's catalog by name and picks one to four products; Insert puts them
 * on the line as an HTML block, a card for one, a grid for more, each with
 * its picture, name and price, linked to its page.
 */
export function ProductBlockDialog({
  brandId,
  onInsert,
  onClose,
}: {
  brandId: string;
  onInsert: (code: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contentEditor.editor.productBlock');
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CatalogProductHit[] | null>(null);
  const [picked, setPicked] = useState<CatalogProductHit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
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
  }, [query, brandId]);

  const isPicked = (id: string) => picked.some((p) => p.id === id);
  const toggle = (hit: CatalogProductHit) =>
    setPicked((now) =>
      now.some((p) => p.id === hit.id)
        ? now.filter((p) => p.id !== hit.id)
        : now.length < MAX_BLOCK_PRODUCTS
          ? [...now, hit]
          : now,
    );

  const insert = async () => {
    setBusy(true);
    try {
      const products = await getProductsForBlock(
        brandId,
        picked.map((p) => p.id),
      );
      const code = productBlockHtml(
        products.flatMap((p) =>
          p.url ? [{ title: p.title, url: p.url, image: p.image, price: priceText(p) }] : [],
        ),
      );
      if (!code) {
        toast.error(t('noLink'));
        return;
      }
      onInsert(code);
      onClose();
    } catch (err) {
      console.error('Failed to read the products:', err);
      toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg" initialFocus={inputRef}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { max: MAX_BLOCK_PRODUCTS })}</DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          type="search"
          value={query}
          maxLength={100}
          placeholder={t('placeholder')}
          aria-label={t('searchLabel')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hits && hits.length === 0 && <p className="text-xs text-muted-foreground">{t('empty')}</p>}
        {hits && hits.length > 0 && (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {hits.map((hit) => {
              const on = isPicked(hit.id);
              return (
                <li key={hit.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={!on && picked.length >= MAX_BLOCK_PRODUCTS}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                    onClick={() => toggle(hit)}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {t('picked', { count: picked.length, max: MAX_BLOCK_PRODUCTS })}
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button disabled={!picked.length || busy} onClick={() => void insert()}>
            {t('insert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
