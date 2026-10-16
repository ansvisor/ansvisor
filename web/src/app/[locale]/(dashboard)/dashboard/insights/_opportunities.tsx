'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2, MessageCircle, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCompactNumber } from '@/lib/format';
import { trackSuggestions } from '@/lib/actions/prompt-suggestions';
import {
  opportunities,
  topicStandings,
  type Opportunity,
  type OpportunitySuggestion,
} from '@/lib/insights-opportunities';
import type { TopicCompetitors } from '@/lib/insights-topics';

/** Items shown, as in the mockup; "See all" opens the rest. */
const VISIBLE_ITEMS = 4;

const SUGGESTIONS_HREF = '/dashboard/prompts/suggestions';

/**
 * Opportunities (VIS-011), as in the v2 mockup: what to track next, from the
 * stored prompt suggestions. A topic item tracks all its suggested prompts
 * (Track 23), a prompt item the one. Both stay within the plan's prompt
 * locations: the server checks every prompt and stops when they're full.
 */
export function Opportunities({
  suggestions,
  trackedTopicIds,
  topics,
  entities,
  slotsLeft,
  onTracked,
  className,
}: {
  suggestions: OpportunitySuggestion[];
  trackedTopicIds: string[] | null;
  /** The heat map's data, for who leads each topic; null where it isn't loaded. */
  topics: TopicCompetitors[] | null;
  /** The trend's brands, for the names of the competitors leading topics. */
  entities: { key: string; name: string; isOwnBrand: boolean }[] | null;
  /** Prompt locations left on the plan; null when unlimited. */
  slotsLeft: number | null;
  onTracked: (count: number) => void;
  className?: string;
}) {
  const t = useTranslations('insights.opportunities');
  const router = useRouter();
  const [trackedIds, setTrackedIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const result = useMemo(() => {
    const names = Object.fromEntries(
      (entities ?? []).filter((e) => !e.isOwnBrand).map((e) => [e.key, e.name]),
    );
    return opportunities(
      suggestions.filter((s) => !trackedIds.has(s.id)),
      topicStandings(topics, names, trackedTopicIds && new Set(trackedTopicIds)),
    );
  }, [suggestions, trackedIds, topics, entities, trackedTopicIds]);
  const planFull = slotsLeft !== null && slotsLeft <= 0;

  const track = async (item: Opportunity) => {
    setBusy(item.key);
    try {
      const {
        trackedIds: done,
        skippedIds,
        error,
        code,
      } = await trackSuggestions(item.suggestionIds);
      // Skipped ones were accepted or dismissed elsewhere: they leave the list too.
      if (done.length + skippedIds.length > 0) {
        setTrackedIds((prev) => new Set([...prev, ...done, ...skippedIds]));
      }
      if (done.length > 0) onTracked(done.length);
      const open = { label: t('openPrompts'), onClick: () => router.push('/dashboard/prompts') };
      if (!error && done.length === 0) {
        toast.info(t('alreadyHandled'));
      } else if (!error) {
        toast.success(t('tracked', { count: done.length }), { action: open });
      } else if (code === 'plan_limit' && done.length > 0) {
        toast.warning(
          t('trackedPartly', { tracked: done.length, total: item.suggestionIds.length }),
          { action: open },
        );
      } else if (code === 'plan_limit') {
        toast.error(t('planFull'));
      } else {
        toast.error(t('trackFailed'), { description: error });
      }
    } catch {
      toast.error(t('trackFailed'));
    } finally {
      setBusy(null);
    }
  };

  const meta = (item: Opportunity): string => {
    const volume = t('volume', { volume: formatCompactNumber(item.volume) });
    if (item.kind === 'prompt') return [volume, t('notTracked')].join(' · ');
    const s = item.standing;
    const standing =
      s.kind === 'competitor'
        ? s.name
          ? t('competitorLeads', { name: s.name })
          : t('leaderScore', { score: s.score.toFixed(1) })
        : s.kind === 'you'
          ? t('youLead')
          : s.kind === 'notTracked'
            ? t('notTracked')
            : null;
    return [t('prompts', { count: item.suggestionIds.length }), volume, standing]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
          {result.status === 'ready' && (
            <Link
              href={SUGGESTIONS_HREF}
              className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('seeAll')}
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {result.status === 'ready' ? (
          <ul className="divide-y" aria-label={t('listLabel')}>
            {result.items.slice(0, VISIBLE_ITEMS).map((item) => {
              const isTopic = item.kind === 'topic';
              const Icon = isTopic ? Tag : MessageCircle;
              const count = item.suggestionIds.length;
              return (
                <li
                  key={item.key}
                  className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">{isTopic ? t('topicKind') : t('promptKind')}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium" title={item.title}>
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {meta(item)}
                    </span>
                  </span>
                  {/* The hint sits on a wrapper: a disabled button shows no tooltip. */}
                  <span
                    className="shrink-0"
                    title={
                      planFull
                        ? t('planFull')
                        : isTopic
                          ? t('trackCountHint', { count, topic: item.title })
                          : t('trackHint')
                    }
                  >
                    <Button
                      size="sm"
                      className="h-7 gap-1.5 px-2.5 text-xs"
                      disabled={planFull || busy !== null}
                      onClick={() => track(item)}
                    >
                      {/* Track N adds one prompt at a time, so a big topic takes a moment. */}
                      {busy === item.key && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      )}
                      {isTopic ? t('trackCount', { count }) : t('track')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <p className="max-w-xs text-xs text-muted-foreground">
              {/* Tracking the last item empties the list: that's done, not "nothing fits". */}
              {result.status === 'noneRelevant' && trackedIds.size > 0
                ? t('allTracked')
                : t(result.status)}
            </p>
            <Link
              href={SUGGESTIONS_HREF}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('openSuggestions')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
