'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getMentionsPerception } from '@/lib/actions/mentions';
import { mentionsQuery, type MentionsFilters } from '@/lib/mentions-filters';
import type { MentionsPerception } from '@/lib/mentions-perception';
import { cn } from '@/lib/utils';
import { BrandShapeCard } from './_brand-shape';
import { CoMentionsCard, HeatmapCard, TermsCard } from './_perception-cards';

/** Typing in the search box reads once it pauses, not on every key. */
const READ_DELAY_MS = 250;

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
 * filter change; a newer change wins over a read still on its way.
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
  const common = useTranslations('common');
  const query = useMemo(() => mentionsQuery(filters), [filters]);
  const key = query ? JSON.stringify([brandId, query]) : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Try again reads the same filters once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key || !query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getMentionsPerception(brandId, query)
        .then((perception) => {
          if (!cancelled) setLoaded({ brandId, key, status: 'ok', perception });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ brandId, key, status: 'error' });
        });
    }, READ_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [brandId, key, query, attempt]);

  if (!query) return <Message>{t('pickDates')}</Message>;
  if (!loaded || loaded.brandId !== brandId) return <PerceptionSkeleton />;
  if (loaded.status === 'error') {
    return loaded.key === key ? (
      <Message>
        <p>{t('loadError')}</p>
        <Button
          className="mt-4 gap-2"
          size="sm"
          variant="outline"
          onClick={() => {
            setLoaded(null);
            setAttempt((n) => n + 1);
          }}
        >
          <RotateCw className="h-4 w-4" />
          {common('retry')}
        </Button>
      </Message>
    ) : (
      <PerceptionSkeleton />
    );
  }
  if (!loaded.perception) return <Message>{t('unavailable')}</Message>;

  const perception = loaded.perception;
  const stale = loaded.key !== key;
  const mentions = perception.entities.find((e) => e.isBrand)?.mentions ?? 0;

  return (
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
  );
}

function PerceptionSkeleton() {
  return (
    <div className="grid gap-3 xl:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[300px] rounded-xl" />
      ))}
    </div>
  );
}
