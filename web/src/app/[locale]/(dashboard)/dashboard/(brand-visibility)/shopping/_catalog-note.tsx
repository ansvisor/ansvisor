'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { CatalogSource } from '@/lib/catalog';
import { CATALOG_SETTINGS_PATH } from '@/lib/content/feed-match';

/**
 * My Products' note (#1270), for a brand with no catalog source yet: the
 * table is the products AI shopping cards showed, not the catalog, and what
 * connecting a catalog does (the Content Editor's price, GTIN and stock
 * check, CE-053). Shown only once the sources are read (the page's own
 * read, useProductSources) and there are none; null, while they're read or
 * when they couldn't be, shows nothing.
 */
export function CatalogNote({ sources }: { sources: CatalogSource[] | null }) {
  const t = useTranslations('shopping');
  if (!sources || sources.length > 0) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {t.rich('connectCatalog', {
        link: (chunks) => (
          <Link
            href={CATALOG_SETTINGS_PATH}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
