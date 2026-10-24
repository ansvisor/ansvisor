'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingDots } from '@/components/ui/loading-dots';
import { getBrandFacts, readBrandFactsAgain, setBrandFactStatus } from '@/lib/actions/brand-facts';
import {
  factValueText,
  isPrice,
  type BrandFact,
  type BrandFactsRead,
  type FactValue,
} from '@/lib/content/brand-facts';

/**
 * Brand settings › Brand facts (Quality spec §10, CE-047): the facts the API
 * read from the brand's own pricing, About and product pages, each with its
 * words on the page and where; a member approves or rejects each one (no
 * "approve all": the spec has each approved). Only approved facts still on
 * the site are compared with a page. "Read again" reads the site again, not
 * more than the API allows.
 */
export function BrandFactsTab({ brandId }: { brandId: string }) {
  const t = useTranslations('brands.settings.facts');
  const format = useFormatter();
  // Read again turns on when the API allows it, without a reload.
  const now = useNow({ updateInterval: 30_000 });
  const [read, setRead] = useState<BrandFactsRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getBrandFacts(brandId).then((result) => {
      if (cancelled) return;
      if ('error' in result) setFailed(true);
      else setRead(result);
    });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const readAgain = async () => {
    setReading(true);
    const result = await readBrandFactsAgain(brandId);
    setReading(false);
    if ('error' in result) {
      toast.error(t('readFailed'));
      return;
    }
    setRead(result);
  };

  const review = async (fact: BrandFact, status: 'approved' | 'rejected') => {
    setBusy(fact.id);
    const result = await setBrandFactStatus(fact.id, status);
    if ('error' in result) {
      setBusy(null);
      toast.error(t('reviewFailed'));
      return;
    }
    // Read as kept: an approval drops the approved facts it replaces.
    const again = await getBrandFacts(brandId);
    setBusy(null);
    if (!('error' in again)) setRead(again);
  };

  const valueOf = (fact: Pick<BrandFact, 'kind' | 'value' | 'quote'>) => {
    const text = factValueText(fact.kind, fact.value, fact.quote);
    if (fact.kind === 'trial') return t('trialDays', { days: Number(text) });
    if (!isPrice(fact)) return text;
    const { plan, period, billed, per } = fact.value;
    return [
      plan,
      `${text}${period ? ` ${t(`periods.${period}`)}` : ''}`,
      per ? t('perSeat') : null,
      billed ? t(`billed.${billed}`) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  if (failed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('loadFailed')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pending = read?.facts.filter((f) => f.status === 'pending') ?? [];
  const approved = read?.facts.filter((f) => f.status === 'approved') ?? [];
  const rejected = read?.facts.filter((f) => f.status === 'rejected') ?? [];
  const canReadAgain =
    !!read && !reading && (!read.recheckAt || Date.parse(read.recheckAt) <= now.getTime());

  const row = (fact: BrandFact) => (
    <li key={fact.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium [overflow-wrap:anywhere]">
          <span className="mr-1.5 text-xs font-normal text-muted-foreground">
            {t(`kinds.${fact.kind}`)}
          </span>
          {fact.kind === 'claim' ? `“${fact.quote}”` : valueOf(fact)}
          {fact.gone && (
            <Badge variant="outline" className="ml-2 align-middle text-[11px] font-normal">
              {t('gone')}
            </Badge>
          )}
        </p>
        {fact.kind !== 'claim' && (
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">“{fact.quote}”</p>
        )}
        <p className="text-xs text-muted-foreground">
          <a
            href={fact.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {t(`sources.${fact.sourceKind}`)}
          </a>
          {fact.replaces && (
            <>
              {' · '}
              {t('replaces', {
                value: valueOf({
                  kind: fact.kind,
                  value: fact.replaces.value as FactValue,
                  quote: '',
                }),
              })}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {fact.status !== 'approved' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={busy !== null}
            aria-label={t('approveFact', { fact: valueOf(fact) })}
            onClick={() => void review(fact, 'approved')}
          >
            {t('approve')}
          </Button>
        )}
        {fact.status !== 'rejected' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={busy !== null}
            aria-label={t('rejectFact', { fact: valueOf(fact) })}
            onClick={() => void review(fact, 'rejected')}
          >
            {t('reject')}
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!read ? (
          <div className="flex justify-center py-8">
            <LoadingDots size="md" label={t('loading')} className="text-muted-foreground" />
          </div>
        ) : read.noDomain ? (
          <p className="text-sm text-muted-foreground">{t('noDomain')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 text-xs text-muted-foreground">
                {read.checkedAt && (
                  <p>
                    {t('checked', {
                      date: format.dateTime(new Date(read.checkedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {read.pages.map((page) => (
                    <li key={page.kind}>
                      {t(`sources.${page.kind}`)}
                      {': '}
                      {page.url && page.status !== 'not_found' ? (
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-2 hover:underline"
                        >
                          {t(`pageStatus.${page.status}`)}
                        </a>
                      ) : (
                        t(`pageStatus.${page.status}`)
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!canReadAgain}
                title={canReadAgain ? undefined : t('readAgainSoon')}
                onClick={() => void readAgain()}
              >
                {reading && <LoadingDots />}
                {t('readAgain')}
              </Button>
            </div>

            {read.paused && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                {t('aiPaused')}
              </p>
            )}

            {read.facts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <>
                {pending.length > 0 && (
                  <section
                    aria-label={t('toApprove', { count: pending.length })}
                    className="space-y-2"
                  >
                    <h4 className="text-xs font-medium text-muted-foreground">
                      {t('toApprove', { count: pending.length })}
                    </h4>
                    <ul className="divide-y rounded-xl border">{pending.map(row)}</ul>
                  </section>
                )}
                {approved.length > 0 && (
                  <section aria-label={t('approved')} className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground">{t('approved')}</h4>
                    <ul className="divide-y rounded-xl border">{approved.map(row)}</ul>
                  </section>
                )}
                {rejected.length > 0 && (
                  <details className="space-y-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      {t('rejected', { count: rejected.length })}
                    </summary>
                    <ul className="mt-2 divide-y rounded-xl border">{rejected.map(row)}</ul>
                  </details>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
