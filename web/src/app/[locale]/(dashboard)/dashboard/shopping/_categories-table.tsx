'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getFaviconUrl } from '@/lib/favicon';
import { formatNumber } from '@/lib/format';
import { priceText } from '@/lib/shopping/price';
import { cn } from '@/lib/utils';
import type { CategoryRow } from '@/lib/shopping/categories';

/**
 * The Categories table (ECOM-008): one row per catalog category, with its
 * shopping questions, the brand's share of their shelves, its products on
 * them, the rival with the most slots there and its products' AI revenue.
 * A category the brand barely shows in is marked "needs attention".
 */
export function CategoriesTable({
  categories,
  loading,
  failed,
}: {
  /** Null for a catalog without categories. */
  categories: CategoryRow[] | null;
  loading: boolean;
  failed: boolean;
}) {
  const t = useTranslations('shopping.categories');
  if (loading) return <Skeleton className="h-[240px] w-full" />;
  if (failed || !categories?.length) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        {failed ? t('failed') : t('empty')}
      </p>
    );
  }
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">{t('columns.category')}</TableHead>
            <TableHead className="text-right">{t('columns.share')}</TableHead>
            <TableHead className="text-right">{t('columns.onShelf')}</TableHead>
            <TableHead>{t('columns.rival')}</TableHead>
            <TableHead className="pr-4 text-right">{t('columns.revenue')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((row) => (
            <TableRow
              key={row.id}
              className={cn(row.needsAttention && 'bg-amber-500/5 hover:bg-amber-500/10')}
            >
              <TableCell className="max-w-[260px] pl-4">
                <p className="truncate text-sm font-medium" title={row.name}>
                  {row.leaf}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('prompts', { count: row.prompts })}
                  {row.needsAttention && (
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      {' · '}
                      {t('attention')}
                    </span>
                  )}
                </p>
              </TableCell>
              <TableCell className="text-right">
                {row.shelfShare === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="inline-flex items-center justify-end gap-2">
                    <span
                      aria-hidden
                      className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:inline-block"
                    >
                      <span
                        className={cn(
                          'block h-full rounded-full',
                          row.needsAttention ? 'bg-amber-500' : 'bg-primary',
                        )}
                        style={{ width: `${Math.round(row.shelfShare * 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{Math.round(row.shelfShare * 100)}%</span>
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.productsOnShelf)} / {formatNumber(row.products)}
              </TableCell>
              <TableCell className="max-w-[180px]">
                {row.topRival ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    {row.topRival.domain && (
                      // eslint-disable-next-line @next/next/no-img-element -- a rival's favicon
                      <img
                        src={getFaviconUrl(row.topRival.domain, 32)}
                        alt=""
                        className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        loading="lazy"
                      />
                    )}
                    <span className="truncate text-sm">{row.topRival.name}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="pr-4 text-right tabular-nums">
                {row.revenue ? priceText(Math.round(row.revenue.value), row.revenue.currency) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
