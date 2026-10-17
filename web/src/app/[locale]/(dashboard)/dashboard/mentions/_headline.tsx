'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { mentionPlatformLabel, mentionsHeadline } from '@/lib/mentions-headline';
import type { MentionsOverview } from '@/lib/mentions-overview';
import {
  arrowChange,
  dayLabel,
  signedChange,
  signedValue,
  TONE_TEXT,
} from '../insights/kpi-format';

/** "Oct 16, 9:40 AM": the 24h view's bounds, in local time. */
function momentLabel(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The Overview's summary line (MS-06), as in the mockup: net sentiment and
 * its change, the platform behind most of it, and the brands AI names you
 * beside. Written from the aggregates by a fixed template, never an LLM, and
 * says so with the window and the responses it rests on.
 */
export function Headline({ overview, brand }: { overview: MentionsOverview; brand: string }) {
  const t = useTranslations('mentions.overview.headline');
  const locale = useLocale();
  const { net, lowSample, netChange, mover, companions } = mentionsHeadline(overview);
  const { window: w, current } = overview;
  const b = (chunks: React.ReactNode) => <b className="font-semibold">{chunks}</b>;

  const period = w.source === 'answers' ? t('period24h') : t('period', { days: w.days });
  const change = arrowChange(netChange, locale);
  const range =
    w.source === 'answers'
      ? `${momentLabel(w.from, locale)} – ${momentLabel(w.to, locale)}`
      : `${dayLabel(w.dayFrom, locale)} – ${dayLabel(w.dayTo, locale)}`;

  return (
    <section
      aria-label={t('label')}
      className="rounded-xl border border-l-[3px] border-l-foreground bg-card px-4 py-3 text-sm"
    >
      <p>
        {net === null
          ? t('noMentions', { brand })
          : change
            ? t.rich('netChange', {
                net: signedValue(net, locale),
                change: change.text,
                period,
                b,
                tone: (chunks) => (
                  <span className={cn('font-medium', TONE_TEXT[change.tone])}>{chunks}</span>
                ),
              })
            : lowSample
              ? t.rich('netLowSample', {
                  net: signedValue(net, locale),
                  count: current.mentions,
                  b,
                })
              : t.rich('net', { net: signedValue(net, locale), b })}
        {mover && (
          <>
            {' '}
            {t.rich(mover.change < 0 ? 'moverDown' : 'moverUp', {
              platform: mentionPlatformLabel(mover.platform),
              change: signedChange(mover.change, locale),
              b,
            })}
          </>
        )}
        {companions.length > 0 && (
          <>
            {' '}
            {companions.length === 1
              ? t.rich('companionsOne', { brand, first: companions[0], b })
              : t.rich('companionsTwo', { brand, first: companions[0], second: companions[1], b })}
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('basis', {
          range,
          answers: current.answers,
          mentions: current.mentions,
        })}
      </p>
    </section>
  );
}
