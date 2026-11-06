'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Brand Visibility's tab skeletons, shaped like each tab's content: shown by
 * the tab's loading.tsx while its route loads, and by the tab itself until
 * its first read is back, so a tab never shows an empty state before its
 * data has come back empty.
 */

function Loading({ children, testId }: { children: React.ReactNode; testId: string }) {
  const t = useTranslations('brandVisibility');
  return (
    <div role="status" aria-busy="true" data-testid={testId} className="space-y-6">
      <span className="sr-only">{t('loading')}</span>
      {children}
    </div>
  );
}

/** A filter bar's dropdowns. */
function FilterBarSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-wrap items-end gap-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-40" />
        </div>
      ))}
    </div>
  );
}

function KpiCardsSkeleton({ count, className }: { count: number; className: string }) {
  return (
    <div className={className} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardContent className="space-y-2 pt-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** The Overview: its filters, the summary line, the KPI cards, the trend beside the leaderboard. */
export function OverviewSkeleton() {
  return (
    <Loading testId="overview-skeleton">
      <FilterBarSkeleton count={4} />
      <Skeleton className="h-5 w-2/3" aria-hidden />
      <KpiCardsSkeleton
        count={5}
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5"
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5" aria-hidden>
        <Skeleton className="h-[360px] rounded-xl lg:col-span-3" />
        <Skeleton className="h-[360px] rounded-xl lg:col-span-2" />
      </div>
    </Loading>
  );
}

/** Mentions: its own tabs, its filters, then its Overview's cards. */
export function MentionsSkeleton() {
  return (
    <Loading testId="mentions-skeleton">
      <Skeleton className="h-8 w-72" aria-hidden />
      <FilterBarSkeleton count={4} />
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
    </Loading>
  );
}

/** Citations: its filters, the three KPI cards, then the sources table. */
export function CitationsSkeleton({ filters = true }: { filters?: boolean }) {
  return (
    <Loading testId="citations-skeleton">
      {filters && <FilterBarSkeleton count={5} />}
      <KpiCardsSkeleton count={3} className="grid gap-4 sm:grid-cols-3" />
      <Card aria-hidden>
        <CardContent className="pt-6">
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </Loading>
  );
}

/** Product Visibility: its views, its filters, the Shelf's four KPI cards, then its two cards. */
export function ProductsSkeleton() {
  return (
    <Loading testId="products-skeleton">
      <Skeleton className="h-8 w-96 max-w-full" aria-hidden />
      <Skeleton className="h-14 w-full rounded-lg" aria-hidden />
      <KpiCardsSkeleton count={4} className="grid grid-cols-2 gap-4 lg:grid-cols-4" />
      <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
        <Skeleton className="h-[220px] rounded-xl" />
        <Skeleton className="h-[220px] rounded-xl" />
      </div>
    </Loading>
  );
}
