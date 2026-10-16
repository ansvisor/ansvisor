'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { sendTopicGapToActionCenter, type TopicGapWindow } from '@/lib/actions/topic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { biggestGap, heatShade, topicHeatmap, type TopicCompetitors } from '@/lib/insights-topics';
import { TONE_TEXT } from './kpi-format';

/** Rows shown before "Show all". */
const VISIBLE_ROWS = 6;

/** A gap with one decimal, so the column lines up: "−29.0", "−20.3". */
const gapText = (gap: number) => `−${Math.abs(gap).toFixed(1)}`;

/**
 * Cell shades, light to dark: soft theme-relative tints, so they read in
 * both themes and a full table doesn't turn into dark blocks. The text keeps
 * its color on every shade.
 */
const SHADES = [
  'bg-muted/40 text-muted-foreground',
  'bg-foreground/[0.06] text-foreground',
  'bg-foreground/[0.12] text-foreground',
  'bg-foreground/[0.2] text-foreground',
  'bg-foreground/[0.32] text-foreground',
] as const;

/**
 * "Topics vs competitors" (VIS-010), as in the v2 mockup: a row per topic,
 * a column for you and each competitor on the trend (pinned, or the
 * strongest four), each cell the topic's Visibility score shaded light to
 * dark, and the gap to the topic's leader. A cell opens the topic.
 */
export function TopicHeatmap({
  topics,
  columns,
  window,
  className,
}: {
  topics: TopicCompetitors[];
  /** You first, then the competitors on the trend: `'you'` or a competitor id. */
  columns: { key: string; name: string }[];
  /** The window and filters the map was loaded with, for "Send biggest gap". */
  window: TopicGapWindow;
  className?: string;
}) {
  const t = useTranslations('insights.topicMap');
  const router = useRouter();
  const [sending, setSending] = useState(false);
  // Expanded for this data only: another brand or range starts folded.
  const [expandedFor, setExpandedFor] = useState<TopicCompetitors[] | null>(null);
  const expanded = expandedFor === topics;

  const rows = topicHeatmap(
    topics,
    columns.map((c) => c.key),
  );
  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  // The tones spread over the scores of every row, so folding doesn't shift them.
  const named = rows.flatMap((r) => r.scores).filter((v) => v > 0);
  const [low, high] = [Math.min(...named), Math.max(...named)];
  const target = biggestGap(rows);
  const targetCompetitor = target && columns.find((c) => c.key === target.leader)?.name;

  const sendBiggestGap = async () => {
    if (!target) return;
    setSending(true);
    try {
      const result = await sendTopicGapToActionCenter(target.topicId, target.leader, window);
      if ('error' in result) {
        // The page's numbers can be older than the server's: a newer run may
        // have closed the gap since it loaded.
        if (result.code === 'stale') toast.error(t('gapChanged'));
        else toast.error(t('sendFailed'), { description: result.error });
        return;
      }
      toast.success(
        result.created
          ? t('sent', { no: result.actionNo })
          : t('alreadySent', { no: result.actionNo }),
        {
          action: {
            label: t('openAction'),
            onClick: () =>
              router.push(`/dashboard/action-center/actions?action=${result.actionId}`),
          },
        },
      );
    } catch {
      toast.error(t('sendFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
          {/* The hint sits on a wrapper: a disabled button shows no tooltip. */}
          <span
            title={
              target
                ? t('sendGapTitle', {
                    topic: target.name,
                    competitor: targetCompetitor ?? '',
                    gap: Math.abs(target.gap!).toFixed(1),
                  })
                : t('noGap')
            }
          >
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={!target || sending}
              onClick={sendBiggestGap}
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              {t('sendGap')}
            </Button>
          </span>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {/* Fixed layout: every brand column gets the same width, as in the mockup. */}
        <table className="w-full min-w-[520px] table-fixed text-sm" aria-label={t('tableLabel')}>
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-[30%] py-2 pr-3 text-left font-medium">{t('topic')}</th>
              {columns.map((c) => (
                <th key={c.key} className="px-1 py-2 text-center font-medium">
                  <span className="block truncate" title={c.name}>
                    {c.key === 'you' ? t('you') : c.name}
                  </span>
                </th>
              ))}
              <th className="w-24 py-2 pl-2 text-right font-medium">{t('gap')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.topicId} className="border-b last:border-b-0">
                <td className="truncate py-1.5 pr-3 font-medium" title={row.name}>
                  <Link href={`/dashboard/topics/${row.topicId}`} className="hover:underline">
                    {row.name}
                  </Link>
                </td>
                {row.scores.map((value, i) => (
                  <td key={columns[i].key} className="px-1 py-1.5">
                    {/* The topic name is the keyboard stop; cells are a mouse shortcut to it. */}
                    <Link
                      href={`/dashboard/topics/${row.topicId}`}
                      tabIndex={-1}
                      title={t('openTopic', { topic: row.name })}
                      className={cn(
                        'block rounded-md px-1 py-1.5 text-center font-semibold tabular-nums transition-opacity hover:opacity-80',
                        SHADES[heatShade(value, low, high)],
                        // Too few answers to read much into: shown, but faded.
                        row.status === 'lowSample' && 'opacity-50',
                      )}
                    >
                      {value.toFixed(1)}
                    </Link>
                  </td>
                ))}
                <td
                  className={cn(
                    'whitespace-nowrap py-1.5 pl-2 text-right font-semibold tabular-nums',
                    row.status === 'lead'
                      ? TONE_TEXT.good
                      : row.status === 'behind'
                        ? TONE_TEXT.bad
                        : 'text-xs font-normal text-muted-foreground',
                  )}
                >
                  {row.status === 'lead'
                    ? t('lead')
                    : row.status === 'behind'
                      ? gapText(row.gap!)
                      : t('lowSample')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > VISIBLE_ROWS && (
          <button
            type="button"
            onClick={() => setExpandedFor(expanded ? null : topics)}
            className="mt-1.5 w-full py-1 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? t('showLess') : t('showAll', { count: rows.length })}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
