'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Maximize2 } from 'lucide-react';
import { useCaughtErrorText } from '@/hooks/use-server-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ResponseDetail } from '@/components/results/response-detail';
import { platformLabel } from '@/config/platform-labels';
import { numberFormat } from '@/lib/number-format';
import { cn } from '@/lib/utils';
import { getInsightsAnswers } from '@/lib/actions/insights-answers';
import { getPromptResultById, type PromptResultWithText } from '@/lib/actions/tracking';
import type { BreakdownFilters, BreakdownMetric } from '@/lib/insights-breakdown';
import type { InsightsAnswer, InsightsAnswersPage } from '@/lib/insights-answers';

/**
 * The breakdown panel's Answers tab: the answers behind the card's number,
 * for the same window and filters, 25 a page, newest first. Each opens in
 * full as on the prompt's page (ResponseDetail).
 */
export function AnswersTab({
  brandId,
  metric,
  filters,
}: {
  brandId: string;
  metric: BreakdownMetric;
  filters?: BreakdownFilters;
}) {
  const t = useTranslations('insights.breakdownSheet.answers');
  const caughtError = useCaughtErrorText();
  const f = numberFormat(useLocale());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InsightsAnswersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const filtersKey = useMemo(() => JSON.stringify(filters ?? {}), [filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInsightsAnswers(brandId, metric, filters, page)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(caughtError(err, t('loadFailed')));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // filtersKey is the stable dependency; `filters` is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, metric, filtersKey, page, caughtError, t]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('hint', { metric })}</p>

      {loading && (
        <div data-slot="answers-loading" className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {!loading && !error && data && data.answers.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</div>
      )}

      {!loading && !error && data && data.answers.length > 0 && (
        <>
          <ul className="divide-y overflow-hidden rounded-md border">
            {data.answers.map((a) => (
              <AnswerItem key={a.id} answer={a} onOpen={() => setOpenId(a.id)} />
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {t('range', {
                  from: f.number((data.page - 1) * data.pageSize + 1),
                  to: f.number(Math.min(data.page * data.pageSize, data.total)),
                  total: f.number(data.total),
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t('previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('next')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <FullAnswerDialog resultId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function AnswerItem({ answer: a, onOpen }: { answer: InsightsAnswer; onOpen: () => void }) {
  const t = useTranslations('insights.breakdownSheet.answers');
  const locale = useLocale();
  const when = new Date(a.createdAt).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <li data-slot="answer-row" className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 min-w-0 text-sm font-medium">{a.promptText}</p>
        <StatusBadge answer={a} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{platformLabel(a.platform)}</span>
        {a.region && <span>· {a.region}</span>}
        <span>· {when}</span>
        {a.status !== 'noAnswer' && (
          <span>
            · {t('sources', { count: a.sources })}
            {a.ownSources > 0 && ` (${t('ownSources', { count: a.ownSources })})`}
          </span>
        )}
      </div>
      <p className="line-clamp-3 text-xs text-muted-foreground">
        {a.status === 'noAnswer' ? t('noAnswerNote') : a.excerpt}
      </p>
      {a.status !== 'noAnswer' && (
        <Button variant="link" size="sm" className="h-auto gap-1 px-0 text-xs" onClick={onOpen}>
          <Maximize2 className="h-3 w-3" aria-hidden />
          {t('open')}
        </Button>
      )}
    </li>
  );
}

function StatusBadge({ answer: a }: { answer: InsightsAnswer }) {
  const t = useTranslations('insights.breakdownSheet.answers');
  const label =
    a.status === 'mentioned'
      ? a.position !== null
        ? t('mentionedAt', { position: a.position })
        : t('mentioned')
      : a.status === 'notMentioned'
        ? t('notMentioned')
        : t('noAnswer');
  return (
    <Badge
      variant="outline"
      data-status={a.status}
      className={cn(
        'shrink-0 whitespace-nowrap text-[10px]',
        a.status === 'mentioned' &&
          'border-green-600/30 bg-green-50 text-green-700 dark:border-green-400/30 dark:bg-green-950/40 dark:text-green-400',
        a.status === 'noAnswer' && 'border-dashed text-muted-foreground',
      )}
    >
      {label}
    </Badge>
  );
}

/** One answer in full, read when opened, as on the prompt's page. */
function FullAnswerDialog({ resultId, onClose }: { resultId: string | null; onClose: () => void }) {
  const t = useTranslations('insights.breakdownSheet.answers');
  const caughtError = useCaughtErrorText();
  // Keyed by the answer it was read for: another answer reads as loading.
  const [loaded, setLoaded] = useState<{
    id: string;
    result: PromptResultWithText | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!resultId) return;
    let cancelled = false;
    getPromptResultById(resultId)
      .then((res) => {
        if (!cancelled) setLoaded({ id: resultId, result: res, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({ id: resultId, result: null, error: caughtError(err, t('detailLoadFailed')) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resultId, caughtError, t]);

  const current = loaded && loaded.id === resultId ? loaded : null;
  const result = current?.result ?? null;
  const state = !current ? 'loading' : current.error ? 'error' : result ? 'ready' : 'missing';

  return (
    <Dialog open={resultId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="line-clamp-2 pe-6">
            {result?.promptText || t('detailTitle')}
          </DialogTitle>
        </DialogHeader>
        {state === 'loading' && (
          <div data-slot="answer-detail-loading" className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {state === 'error' && <p className="text-sm text-destructive">{current?.error}</p>}
        {state === 'missing' && (
          <p className="text-sm text-muted-foreground">{t('detailMissing')}</p>
        )}
        {state === 'ready' && result && <ResponseDetail result={result} variant="compact" />}
      </DialogContent>
    </Dialog>
  );
}
