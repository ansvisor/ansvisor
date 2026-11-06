'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { readKey } from '@/components/brand-visibility/read-cache';
import { ReadError } from '@/components/brand-visibility/read-error';
import { useBrandVisibilityShell } from '@/components/brand-visibility/shell-context';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { mentionsQuery, type MentionsFilters } from '@/lib/mentions-filters';
import type { MentionsPerception } from '@/lib/mentions-perception';
import { cn } from '@/lib/utils';
import { getMentionsPerception } from '@/lib/visibility-reads';
import { BrandShapeCard } from './_brand-shape';
import { CoMentionsCard, HeatmapCard, TermsCard } from './_perception-cards';
import { scheduleRead } from './_read-delay';

/** A read still on its way after this says it is still reading. */
const SLOW_MS = 4_000;

type Loaded =
  | { brandId: string; key: string; status: 'ok'; perception: MentionsPerception | null }
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
 * The Perception tab (MS-09), as in the mockup: what AI associates with the
 * brand and the brand's shape against its competitors, then the brand ×
 * attribute heat map and the competitors named beside it. One read per
 * filter change; a newer change wins over a read still on its way. A read
 * that fails is tried once more before the tab says so (a cold read past
 * the database's limit usually answers the second time), and a slow one
 * says it is still reading. Figures read before for the same brand and
 * filters (the tab opened again) show at once while they are read again.
 */
export function MentionsPerceptionTab({
  brandId,
  brand,
  filters,
}: {
  brandId: string;
  brand: string;
  filters: MentionsFilters;
}) {
  const t = useTranslations('mentions.perception');
  const { cache, shown } = useBrandVisibilityShell();
  const first = useRef(true);
  const query = useMemo(() => mentionsQuery(filters), [filters]);
  const key = query ? JSON.stringify([brandId, query]) : null;
  // Kept by the filters, not the query: a range's query moves with the clock.
  const keptKey = readKey('mentionsPerception', brandId, filters);
  const [read, setRead] = useState<Loaded | null>(null);
  // Try again reads the same filters once more.
  const [attempt, setAttempt] = useState(0);
  // The read (for these filters, this try) still on its way after SLOW_MS.
  const [slow, setSlow] = useState<string | null>(null);
  const tryKey = key ? `${key}#${attempt}` : null;

  useEffect(() => {
    if (!key || !query) return;
    let cancelled = false;
    const ask = () => getMentionsPerception(brandId, query);
    const cancelRead = scheduleRead(first, () => {
      ask()
        // Once more before saying it failed.
        .catch((err) => (cancelled ? Promise.reject(err) : ask()))
        .then((perception) => {
          cache.set(keptKey, perception);
          if (!cancelled) setRead({ brandId, key, status: 'ok', perception });
        })
        .catch(() => {
          if (!cancelled) setRead({ brandId, key, status: 'error' });
        });
    });
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(`${key}#${attempt}`);
    }, SLOW_MS);
    return () => {
      cancelled = true;
      cancelRead();
      clearTimeout(slowTimer);
      // Back on these filters later, the read starts over: not slow yet.
      setSlow((s) => (s === `${key}#${attempt}` ? null : s));
    };
  }, [brandId, key, keptKey, query, attempt, cache]);

  // This read's figures; until they are back, those kept for these filters
  // (the tab opened again, or filters picked again); else the last read's.
  const fresh = read?.key === key && read.status === 'ok';
  const kept = key && !fresh ? cache.get<MentionsPerception | null>(keptKey) : undefined;
  const loaded: Loaded | null =
    key && kept !== undefined ? { brandId, key, status: 'ok', perception: kept } : read;
  const showing = loaded?.status === 'ok' && loaded.brandId === brandId;
  useEffect(() => {
    if (showing) shown();
  }, [showing, shown]);

  const isSlow = slow !== null && slow === tryKey;
  const skeleton = <PerceptionSkeleton slow={isSlow} />;
  if (!query) return <Message>{t('pickDates')}</Message>;
  if (!loaded || loaded.brandId !== brandId) return skeleton;
  if (loaded.status === 'error') {
    return loaded.key === key ? (
      <ReadError
        title={t('loadError')}
        onRetry={() => {
          setRead(null);
          setAttempt((n) => n + 1);
        }}
      />
    ) : (
      skeleton
    );
  }
  if (!loaded.perception) return <Message>{t('unavailable')}</Message>;

  const perception = loaded.perception;
  const stale = loaded.key !== key;
  const mentions = perception.entities.find((e) => e.isBrand)?.mentions ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* The figures shown are the last filters': a slow read of the new ones says so. */}
      <SlowNote slow={stale && isSlow} />
      <section
        aria-label={t('sectionLabel')}
        aria-busy={stale}
        className={cn('flex flex-col gap-3 transition-opacity', stale && 'opacity-60')}
      >
        {mentions === 0 ? (
          <Message>{t('noMentions', { brand })}</Message>
        ) : (
          <>
            <div className="grid items-start gap-3 xl:grid-cols-2">
              <TermsCard perception={perception} brand={brand} />
              <BrandShapeCard perception={perception} brand={brand} />
            </div>
            <div className="grid items-start gap-3 xl:grid-cols-2">
              <HeatmapCard perception={perception} />
              <CoMentionsCard perception={perception} />
            </div>
            <p className="text-xs text-muted-foreground">{t('method')}</p>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Says a read is still on its way. Always in the page, empty until then, so
 * screen readers announce the words when they come.
 */
function SlowNote({ slow }: { slow: boolean }) {
  const t = useTranslations('mentions.perception');
  return (
    <p role="status" className={cn('text-sm text-muted-foreground', !slow && 'sr-only')}>
      {slow ? t('slow') : ''}
    </p>
  );
}

function PerceptionSkeleton({ slow }: { slow: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <SlowNote slow={slow} />
      <div className="grid gap-3 xl:grid-cols-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[300px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
