'use client';

import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { PageType } from '@/lib/content/drafts';
import type { MixRow, PlanResults } from '@/lib/content/plan-mix';
import type { PlanPeriod } from '@/lib/content/plan';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The AI results strip (CE-014): what visitors from AI assistants did on the
 * site in the period. Key events need Google Analytics; orders and revenue
 * show when its property reports purchases.
 */
export function AiResultsStrip({ results, days }: { results: PlanResults; days: PlanPeriod }) {
  const t = useTranslations('contentEditor.plan.results');
  const parts = [t('visits', { count: results.visits, value: formatNumber(results.visits) })];
  if (results.analytics) {
    parts.push(
      t('keyEvents', { count: results.keyEvents, value: formatNumber(results.keyEvents) }),
    );
    if (results.purchases) {
      parts.push(
        t('orders', { count: results.transactions, value: formatNumber(results.transactions) }),
        t('revenue', { value: formatNumber(Math.round(results.revenue)) }),
      );
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm">
      <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{t('label', { days })}</span>
      <span className="font-medium">{parts.join(' · ')}</span>
      {!results.analytics && (
        <span className="text-muted-foreground">
          {t.rich('needsAnalytics', {
            link: (chunks) => (
              <Link
                href="/dashboard/traffic"
                className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </span>
      )}
    </div>
  );
}

/**
 * "What AI cites in your topics" (CE-014): per page type, the share of AI
 * citations (light bar) and the type's share of the brand's own cited pages
 * (dark bar), two mixes of 100 each, with a gap flagged in amber. A row
 * filters the priority list to its type; clicking it again clears it.
 */
export function PageTypeMix({
  rows,
  covered,
  selected,
  onSelect,
}: {
  rows: MixRow[];
  /** The share of all the period's citations the shares are of, in whole percent. */
  covered: number;
  selected: PageType | null;
  onSelect: (type: PageType | null) => void;
}) {
  const t = useTranslations('contentEditor.plan.mix');
  const tTypes = useTranslations('contentEditor.pageTypes');
  // The most cited type fills the track; the others are drawn to its scale.
  const scale = Math.max(1, ...rows.map((r) => r.aiShare));

  return (
    <section aria-labelledby="plan-mix-title" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="plan-mix-title" className="text-sm font-medium">
          {t('title')}
        </h2>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm bg-muted-foreground/30" />
            {t('aiShare')}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm bg-foreground" />
            {t('yourShare')}
          </span>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((row) => (
            <li key={row.pageType}>
              <button
                type="button"
                aria-pressed={selected === row.pageType}
                onClick={() => onSelect(selected === row.pageType ? null : row.pageType)}
                className={cn(
                  'grid w-full grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,12rem)_1fr_5.5rem_8rem]',
                  selected === row.pageType && 'bg-muted/60',
                )}
              >
                <span className="truncate">{tTypes(row.pageType)}</span>
                <span aria-hidden className="relative h-2 rounded-full bg-muted">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/30"
                    style={{ width: `${(row.aiShare / scale) * 100}%` }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-foreground"
                    style={{ width: `${(row.yourShare / scale) * 100}%` }}
                  />
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  {t('shares', { ai: row.aiShare, yours: row.yourShare })}
                  {/* On a phone the gap goes under the shares. */}
                  {row.gap && (
                    <span className="block font-medium text-amber-700 sm:hidden dark:text-amber-400">
                      {t('gap', { count: row.pages })}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'hidden text-right text-xs sm:block',
                    row.gap
                      ? 'font-medium text-amber-700 dark:text-amber-400'
                      : 'text-muted-foreground',
                  )}
                >
                  {row.gap ? t('gap', { count: row.pages }) : t('pages', { count: row.pages })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && covered < 100 && (
        <p className="text-xs text-muted-foreground">{t('covered', { pct: covered })}</p>
      )}
    </section>
  );
}
