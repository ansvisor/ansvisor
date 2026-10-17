'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { numberFormat } from '@/lib/number-format';
import { wholeNet } from '@/lib/mentions-headline';
import {
  isLowSample,
  mentionRate,
  sentimentSplit,
  type MentionsOverview,
} from '@/lib/mentions-overview';
import { signedValue, TONE_TEXT } from '../insights/kpi-format';
import { SentimentSplitBar } from './_sentiment-split';

/**
 * "Competitor framing" (MS-06): your brand, then each competitor with its
 * mentions, its rate over the same responses, and how many of those name you
 * too. Sentiment is stored toward your brand only, so a competitor's tone
 * stays "—" until it is measured; the strength and weakness columns come
 * with the themes.
 */
export function CompetitorTable({
  overview,
  brand,
  className,
}: {
  overview: Pick<MentionsOverview, 'current' | 'competitors'>;
  brand: string;
  className?: string;
}) {
  const t = useTranslations('mentions.overview.competitors');
  const locale = useLocale();
  const f = numberFormat(locale);
  const { current: cur } = overview;
  const ownRate = mentionRate(cur);
  const split = sentimentSplit(cur);
  const net = wholeNet(cur);
  const rateOf = (mentions: number) => (cur.answers > 0 ? (mentions * 100) / cur.answers : null);
  const competitors = [...overview.competitors].sort((a, b) => b.mentions - a.mentions);
  const pct = (n: number | null) => (n === null ? '—' : f.percent(n, 1));
  const dash = <span className="text-muted-foreground">—</span>;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm" aria-label={t('tableLabel')}>
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 text-left font-medium">{t('brand')}</th>
              <th className="w-24 px-2 py-2 text-right font-medium">{t('mentions')}</th>
              <th className="w-20 px-2 py-2 text-right font-medium">{t('rate')}</th>
              <th className="w-40 px-2 py-2 text-left font-medium">{t('sentiment')}</th>
              <th className="w-16 px-2 py-2 text-right font-medium">{t('net')}</th>
              <th className="w-40 py-2 pl-2 text-right font-medium">{t('sameAnswer')}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b bg-muted/40 last:border-b-0">
              <td className="py-2.5 pr-3 font-semibold">
                <span className="inline-flex items-center gap-2">
                  {brand}
                  <span className="rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                    {t('you')}
                  </span>
                </span>
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">{f.number(cur.mentions)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{pct(ownRate)}</td>
              <td className="px-2 py-2.5">{split ? <SentimentSplitBar split={split} /> : dash}</td>
              <td
                className={cn(
                  'px-2 py-2.5 text-right font-semibold tabular-nums',
                  net === null || isLowSample(cur)
                    ? 'text-muted-foreground'
                    : TONE_TEXT[net > 0 ? 'good' : net < 0 ? 'bad' : 'neutral'],
                )}
              >
                {net === null ? '—' : signedValue(net, locale)}
              </td>
              <td className="py-2.5 pl-2 text-right">{dash}</td>
            </tr>
            {competitors.map((c) => (
              <tr key={c.competitorId} className="border-b last:border-b-0">
                <td className="py-2.5 pr-3">{c.name}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{f.number(c.mentions)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{pct(rateOf(c.mentions))}</td>
                <td className="px-2 py-2.5">{dash}</td>
                <td className="px-2 py-2.5 text-right">{dash}</td>
                <td className="py-2.5 pl-2 text-right tabular-nums">{f.number(c.coMentions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          {competitors.length === 0 ? t('none') : t('ownSentimentOnly')}
        </p>
      </CardContent>
    </Card>
  );
}
