'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getGoogleAccountsOverview,
  type BrandGoogleRow,
  type BrandGoogleUse,
} from '@/lib/actions/integrations';

/**
 * Settings › Integrations' overview of Google per brand (BRAND-ACCESS §3.3,
 * PR 15): which Google account each brand reads Search Console and
 * Analytics from. A brand changes it in its own settings (Integrations).
 * Nothing while there's one brand or none: the cards above say it all.
 */
export function GoogleAccountsOverview({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useTranslations('settings.googleOverview');
  const [rows, setRows] = useState<BrandGoogleRow[] | null>(null);

  useEffect(() => {
    let live = true;
    getGoogleAccountsOverview()
      .then((read) => live && setRows(read))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (!rows || rows.length < 2) return null;

  const cell = (use: BrandGoogleUse) => {
    if (use.kind === 'none') return <span className="text-muted-foreground">{t('none')}</span>;
    const name =
      use.kind === 'workspace'
        ? t('workspace')
        : use.label
          ? use.label
          : use.sharedWith > 0
            ? t('ownShared', { count: use.sharedWith })
            : t('own');
    return (
      <span>
        {name}
        {!use.connected && (
          <span className="block text-xs text-amber-700 dark:text-amber-400">{t('reconnect')}</span>
        )}
      </span>
    );
  };

  return (
    <section className="space-y-2" aria-label={t('title')}>
      <div>
        <h3 className="text-sm font-medium">{t('title')}</h3>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('brand')}</TableHead>
              <TableHead>Search Console</TableHead>
              <TableHead>Analytics</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.brandId}>
                <TableCell className="font-medium">{row.brandName}</TableCell>
                <TableCell className="text-sm">{cell(row.gsc)}</TableCell>
                <TableCell className="text-sm">{cell(row.ga)}</TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/dashboard/brands/${row.brandId}/settings?tab=integrations`}
                    className="text-xs font-medium underline-offset-2 hover:underline"
                  >
                    {t('change')}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
