'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { readKey } from '@/components/brand-visibility/read-cache';
import { ReadError } from '@/components/brand-visibility/read-error';
import { useBrandVisibilityShell } from '@/components/brand-visibility/shell-context';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { mentionsQuery, type MentionsFilters } from '@/lib/mentions-filters';
import type { MentionsOverview } from '@/lib/mentions-overview';
import { cn } from '@/lib/utils';
import { getMentionsOverview } from '@/lib/visibility-reads';
import { CompetitorTable } from './_competitor-table';
import { Headline } from './_headline';
import { OverviewKpis } from './_overview-kpis';
import { PlatformTable } from './_platform-table';
import { scheduleRead } from './_read-delay';
import { TrendCard } from './_trend-card';

type Loaded =
  | { brandId: string; key: string; status: 'ok'; overview: MentionsOverview | null }
  | { brandId: string; key: string; status: 'error' };

function Message({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * The Overview tab (MS-06), top-down as in the mockup: the summary line, the
 * KPI cards, the trend beside the platform table, and the competitor
 * framing. One read per filter change; a newer change wins over a read
 * still on its way. Figures read before for the same brand and filters (the
 * tab opened again) show at once while they are read again, quietly.
 */
export function MentionsOverviewTab({
  brandId,
  brand,
  filters,
}: {
  brandId: string;
  brand: string;
  filters: MentionsFilters;
}) {
  const t = useTranslations('mentions.overview');
  const { cache, shown } = useBrandVisibilityShell();
  const query = useMemo(() => mentionsQuery(filters), [filters]);
  const key = query ? JSON.stringify([brandId, query]) : null;
  // Kept by the filters, not the query: a range's query moves with the clock.
  const keptKey = readKey('mentionsOverview', brandId, filters);
  const [read, setRead] = useState<Loaded | null>(null);
  // Retry reads the same filters once more.
  const [attempt, setAttempt] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    if (!key || !query) return;
    let cancelled = false;
    const cancelRead = scheduleRead(first, () => {
      getMentionsOverview(brandId, query)
        .then((overview) => {
          cache.set(keptKey, overview);
          if (!cancelled) setRead({ brandId, key, status: 'ok', overview });
        })
        .catch(() => {
          if (!cancelled) setRead({ brandId, key, status: 'error' });
        });
    });
    return () => {
      cancelled = true;
      cancelRead();
    };
  }, [brandId, key, keptKey, query, attempt, cache]);

  // This read's figures; until they are back, those kept for these filters
  // (the tab opened again, or filters picked again); else the last read's.
  const fresh = read?.key === key && read.status === 'ok';
  const kept = key && !fresh ? cache.get<MentionsOverview | null>(keptKey) : undefined;
  const loaded: Loaded | null =
    key && kept !== undefined ? { brandId, key, status: 'ok', overview: kept } : read;
  const showing = loaded?.status === 'ok' && loaded.brandId === brandId;
  useEffect(() => {
    if (showing) shown();
  }, [showing, shown]);

  if (!query) return <Message>{t('pickDates')}</Message>;
  // Another brand's figures are never shown under this one's name.
  if (!loaded || loaded.brandId !== brandId) return <OverviewSkeleton />;
  if (loaded.status === 'error') {
    // A failed read gives way to the skeleton once a newer one is on its way.
    return loaded.key === key ? (
      <ReadError
        title={t('loadError')}
        onRetry={() => {
          setRead(null);
          setAttempt((n) => n + 1);
        }}
      />
    ) : (
      <OverviewSkeleton />
    );
  }
  if (!loaded.overview) return <Message>{t('unavailable')}</Message>;

  const overview = loaded.overview;
  // The last read stays on screen, dimmed, while a newer one is on its way.
  const stale = loaded.key !== key;
  return (
    <section
      aria-label={t('sectionLabel')}
      aria-busy={stale}
      className={cn('flex flex-col gap-3 transition-opacity', stale && 'opacity-60')}
    >
      {overview.current.answers === 0 ? (
        <Message>{t('empty')}</Message>
      ) : (
        <>
          <Headline overview={overview} brand={brand} />
          <OverviewKpis overview={overview} brand={brand} />
          {/* Each card keeps its own height: the table grows with the platforms. */}
          <div className="grid items-start gap-3 xl:grid-cols-2">
            <TrendCard overview={overview} />
            <PlatformTable rows={overview.platforms} />
          </div>
          <CompetitorTable overview={overview} brand={brand} />
        </>
      )}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-[72px] w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[124px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Skeleton className="h-[300px] rounded-xl" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    </div>
  );
}
