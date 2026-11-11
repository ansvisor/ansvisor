'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Info, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUserRole } from '@/hooks/use-user-role';
import {
  deleteBusinessHubSnapshot,
  getBusinessHubCard,
  type BusinessHubCard as CardData,
} from '@/lib/actions/business-hub';
import { changeOf, isTrackedTopic, type BusinessHubEntry } from '@/lib/business-hub/numbers';
import { numberFormat } from '@/lib/number-format';
import { readUrlParam, writeUrlParams } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { BusinessHubDialog } from './_business-hub-dialog';
import { TONE_TEXT } from './kpi-format';

/** Where a topic chip's Suggest prompts goes: Prompts › Suggestions, its Business Hub dialog. */
const SUGGEST_HREF = '/dashboard/prompts/suggestions?source=business_hub&hub=1';

/** "Nov 10", in the reader's language, read as the UTC day it is. */
function dayLabel(day: string, locale: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** One number, with its change against the entry before of the same length. */
function Metric({
  label,
  hint,
  value,
  previous,
  text,
  changeTitle,
  locale,
}: {
  label: string;
  hint?: string;
  value: number | null;
  previous: number | null;
  /** What shows in place of a missing number. */
  text: string;
  changeTitle: string | null;
  locale: string;
}) {
  const f = numberFormat(locale);
  const change = changeOf(value, previous);
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div className="min-w-0">
        <p className="text-[13px]">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
        {value === null ? (
          <span className="text-xs text-muted-foreground">{text}</span>
        ) : (
          <span className="text-sm font-semibold">
            {f.number(value, Number.isInteger(value) ? 0 : 1)}
          </span>
        )}
        {change !== null && (
          <span
            title={changeTitle ?? undefined}
            className={cn(
              'w-12 text-right text-[11.5px] font-medium',
              TONE_TEXT[change > 0 ? 'good' : change < 0 ? 'bad' : 'neutral'],
            )}
          >
            {f.signed(Math.round(change * 10) / 10)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Visibility's ChatGPT Business Hub card (behind BUSINESS_HUB_ENABLED):
 * the numbers a member copied from Business Hub's Insights beside
 * Ansvisor's own ChatGPT numbers for the same days, each with its change
 * against the entry before of the same length, and the line on why they
 * differ. It reads on its own, so a failed read hides the card and never
 * the page. It shows only once ChatGPT is tracked and the brand has an
 * entry, its setup action's Claim task is done, or the page was opened to
 * enter numbers (?businessHub=enter, which opens the dialog). Every member
 * enters and edits numbers; admins and managers delete them.
 */
export function BusinessHubCard({ brandId, className }: { brandId: string; className?: string }) {
  const t = useTranslations('insights.businessHub');
  const locale = useLocale();
  const { canManage } = useUserRole();
  const [card, setCard] = useState<CardData | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; entry: BusinessHubEntry | null }>({
    open: false,
    entry: null,
  });
  const [listOpen, setListOpen] = useState(false);
  const readId = useRef(0);
  // Read once on mount: the link's ask, kept until the card has opened the dialog.
  const asked = useRef<boolean | null>(null);

  const load = useCallback(async () => {
    const id = ++readId.current;
    if (asked.current === null) asked.current = readUrlParam('businessHub') === 'enter';
    try {
      const next = await getBusinessHubCard(brandId, { asked: asked.current });
      if (id !== readId.current) return;
      setCard(next);
      if (asked.current && next.show) {
        asked.current = false;
        writeUrlParams({ businessHub: null });
        setDialog({ open: true, entry: null });
      }
    } catch {
      // A failed read hides the card; the page goes on.
      if (id === readId.current) setCard(null);
    }
  }, [brandId]);

  useEffect(() => {
    setCard(null);
    void load();
  }, [load]);

  if (!card?.show) return null;
  const { latest, previous, ours, oursPrevious, entries } = card;
  const changeTitle = previous
    ? t('changeTitle', { days: previous.periodDays, end: dayLabel(previous.periodEnd, locale) })
    : null;
  const hubEmpty =
    latest !== null &&
    latest.mentions === null &&
    latest.websiteClicks === null &&
    latest.profileViews === null;

  const remove = async (entry: BusinessHubEntry) => {
    const result = await deleteBusinessHubSnapshot(entry.id).catch(() => ({
      error: 'failed' as const,
    }));
    if ('error' in result) {
      toast.error(t('entries.deleteFailed'));
      return;
    }
    toast.success(t('entries.deleted'));
    void load();
  };

  return (
    <Card className={cn('flex flex-col', className)} data-testid="business-hub-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
            {latest && (
              <p className="text-xs text-muted-foreground">
                {t('period', { days: latest.periodDays, end: dayLabel(latest.periodEnd, locale) })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {entries.length > 0 && (
              <Popover open={listOpen} onOpenChange={setListOpen}>
                <PopoverTrigger
                  render={
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" />
                  }
                >
                  {t('allEntries')}
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-2">
                  <p className="px-1 pb-1 text-xs font-medium">{t('entries.title')}</p>
                  <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                    {entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-2 rounded px-1 py-1 text-xs hover:bg-muted/60"
                      >
                        <span className="min-w-0 truncate">
                          {t('period', {
                            days: entry.periodDays,
                            end: dayLabel(entry.periodEnd, locale),
                          })}
                          <span className="text-muted-foreground">
                            {' '}
                            · {t(`entries.source.${entry.source}`)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('entries.edit')}
                            title={t('entries.edit')}
                            onClick={() => {
                              setListOpen(false);
                              setDialog({ open: true, entry });
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {canManage && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={t('entries.deleteLabel', {
                                days: entry.periodDays,
                                end: dayLabel(entry.periodEnd, locale),
                              })}
                              title={t('entries.delete')}
                              onClick={() => void remove(entry)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!canManage && (
                    <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                      {t('entries.managersDelete')}
                    </p>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setDialog({ open: true, entry: null })}
            >
              {t('enter')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {!latest ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <section aria-label={t('hub')}>
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('hub')}
                </h3>
                <p className="mb-1 text-[11px] text-muted-foreground">{t('hubHint')}</p>
                {hubEmpty && <p className="text-xs text-muted-foreground">{t('partial')}</p>}
                <Metric
                  label={t('metrics.mentions')}
                  hint={t('metrics.mentionsHint')}
                  value={latest.mentions}
                  previous={previous?.mentions ?? null}
                  text={t('notShown')}
                  changeTitle={changeTitle}
                  locale={locale}
                />
                <Metric
                  label={t('metrics.websiteClicks')}
                  value={latest.websiteClicks}
                  previous={previous?.websiteClicks ?? null}
                  text={t('notShown')}
                  changeTitle={changeTitle}
                  locale={locale}
                />
                <Metric
                  label={t('metrics.profileViews')}
                  value={latest.profileViews}
                  previous={previous?.profileViews ?? null}
                  text={t('notShown')}
                  changeTitle={changeTitle}
                  locale={locale}
                />
              </section>
              <section aria-label={t('ours')}>
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('ours')}
                </h3>
                <p className="mb-1 text-[11px] text-muted-foreground">{t('oursHint')}</p>
                {ours && ours.answers === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('noAnswers')}</p>
                ) : (
                  ours && (
                    <>
                      <Metric
                        label={t('metrics.visibility')}
                        value={ours.visibility}
                        previous={oursPrevious?.visibility ?? null}
                        text="—"
                        changeTitle={changeTitle}
                        locale={locale}
                      />
                      <Metric
                        label={t('metrics.named')}
                        hint={t('of', { count: ours.answers })}
                        value={ours.named}
                        previous={oursPrevious?.named ?? null}
                        text="—"
                        changeTitle={changeTitle}
                        locale={locale}
                      />
                      <Metric
                        label={t('metrics.cited')}
                        value={ours.cited}
                        previous={oursPrevious?.cited ?? null}
                        text="—"
                        changeTitle={changeTitle}
                        locale={locale}
                      />
                    </>
                  )
                )}
                {ours && (
                  <Metric
                    label={t('metrics.visits')}
                    value={ours.visits}
                    previous={oursPrevious?.visits ?? null}
                    text={t('notRead')}
                    changeTitle={changeTitle}
                    locale={locale}
                  />
                )}
              </section>
            </div>
            {latest.topics.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('topics')}
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {latest.topics.map((topic) => {
                    const tracked = isTrackedTopic(topic, card.trackedTopics);
                    return (
                      <li
                        key={topic}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
                      >
                        <span className="min-w-0 truncate" title={topic}>
                          {topic}
                        </span>
                        {tracked ? (
                          <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">
                            {t('tracked')}
                          </span>
                        ) : (
                          canManage && (
                            <Link
                              href={SUGGEST_HREF}
                              className="text-[10.5px] font-medium text-primary hover:underline"
                            >
                              {t('suggestPrompts')}
                            </Link>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div className="mt-auto space-y-1 rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
              <p className="flex flex-wrap items-center gap-x-1.5">
                <span>{t('note')}</span>
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
                      />
                    }
                  >
                    <Info className="h-3 w-3" />
                    {t('howTheyDiffer')}
                  </PopoverTrigger>
                  <PopoverContent className="w-80 space-y-2 text-xs">
                    <p>{t('definitions')}</p>
                    <p>{t('clicksNote')}</p>
                  </PopoverContent>
                </Popover>
              </p>
              <p>{t('clicksNote')}</p>
            </div>
          </>
        )}
      </CardContent>
      <BusinessHubDialog
        brandId={brandId}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        entry={dialog.entry}
        entries={entries}
        onSaved={() => void load()}
      />
    </Card>
  );
}
