'use client';

import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { batchProgress, type Batch } from '@/lib/audit/batch-progress';
import { formatNumber } from '@/lib/format';

/**
 * A bulk audit's progress above the lists: "12 of 235 done · about 70 min
 * left" with a bar, and This batch, which lists only the batch's pages in
 * Pages (running ones first). Once the batch is done it says so, until
 * dismissed. `now` is the page's clock, so the estimate moves with each read.
 */
export function BatchProgress({
  batch,
  now,
  thisBatch,
  onToggleThisBatch,
  onDismiss,
}: {
  batch: Batch;
  now: number;
  /** Pages lists only this batch's pages. */
  thisBatch: boolean;
  onToggleThisBatch: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('audit.batch');
  const { done, total, fraction, minutesLeft } = batchProgress(batch, now);
  const percent = Math.round(fraction * 100);

  return (
    <Card role="status" aria-label={t('title')}>
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!batch.finished && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <p className="text-sm">
            {batch.finished ? (
              <span className="font-medium">{t('finished', { total })}</span>
            ) : (
              <>
                <span className="font-medium tabular-nums">
                  {t('progress', { done: formatNumber(done), total: formatNumber(total) })}
                </span>
                <span className="text-muted-foreground">
                  {' · '}
                  {minutesLeft === null
                    ? t('estimating')
                    : t('timeLeft', { minutes: formatNumber(minutesLeft) })}
                </span>
              </>
            )}
          </p>
          <div className="ms-auto flex items-center gap-1">
            <Button
              variant={thisBatch ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              aria-pressed={thisBatch}
              title={t('thisBatchTip')}
              onClick={onToggleThisBatch}
            >
              {thisBatch ? t('allPages') : t('thisBatch')}
            </Button>
            {batch.finished && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={t('dismiss')}
                onClick={onDismiss}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div
          role="progressbar"
          aria-label={t('title')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
