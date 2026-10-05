'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, FileText, Layers, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getOpportunityBasket } from '@/lib/actions/content';
import type {
  ContentOpportunityDecision,
  ContentOpportunitySourceData,
  OpportunityBasket,
} from '@/types';

const SCORE_PARTS = [
  ['demand', 40],
  ['visibilityGap', 30],
  ['competitorGap', 20],
  ['intent', 10],
] as const;

/** Why a cluster opportunity scored what it did: each component and its weight. */
export function ScoreBreakdown({ sourceData }: { sourceData: ContentOpportunitySourceData }) {
  const t = useTranslations('content.detail');
  const parts = sourceData.scoreComponents;
  if (!parts) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('scoreTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {SCORE_PARTS.map(([key, weight]) => (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span>{t(`score.${key}`)}</span>
              <span className="tabular-nums text-muted-foreground">
                {Math.round(parts[key])} · {t('scoreWeight', { weight })}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${Math.min(Math.max(parts[key], 0), 100)}%` }}
              />
            </div>
          </div>
        ))}
        {sourceData.windowDays && (
          <p className="text-[11px] text-muted-foreground">
            {t('scoreWindow', { days: sourceData.windowDays })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The prompts a cluster opportunity answers and the searches AI engines ran
 * for them, included and excluded, read live from the cluster.
 */
export function OpportunityBasketCard({ opportunityId }: { opportunityId: string }) {
  const t = useTranslations('content.detail');
  const [basket, setBasket] = useState<OpportunityBasket | null>(null);
  const [failed, setFailed] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => {
    getOpportunityBasket(opportunityId)
      .then(setBasket)
      .catch(() => setFailed(true));
  }, [opportunityId]);

  if (failed) return null;

  const included = basket?.queries.filter((q) => q.included) ?? [];
  const excluded = basket?.queries.filter((q) => !q.included) ?? [];
  const promptCount = basket?.clusters.reduce((s, c) => s + c.prompts.length, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">{t('basketTitle')}</CardTitle>
          {basket && (
            <span className="text-xs text-muted-foreground">
              {t('basketSummary', {
                prompts: promptCount,
                included: included.length,
                excluded: excluded.length,
              })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!basket ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            {basket.clusters.map((c) => (
              <div key={c.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{c.label}</p>
                  {c.topicName && (
                    <Badge variant="outline" className="text-[10px]">
                      {c.topicName}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{c.need}</p>
                <ul className="space-y-1 text-xs">
                  {c.prompts.map((p) => (
                    <li key={p.id} className="flex gap-2">
                      <span className="text-muted-foreground">•</span>
                      <span>{p.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {included.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">{t('basketIncluded')}</p>
                <div className="flex flex-wrap gap-1">
                  {included.map((q) => (
                    <Badge
                      key={q.query}
                      variant="outline"
                      className="text-xs border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400 gap-1"
                      title={q.reason}
                    >
                      <Search className="h-2.5 w-2.5 shrink-0" />
                      {q.query}
                      <span className="opacity-60 tabular-nums">×{q.timesSearched}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {excluded.length > 0 && (
              <div className="space-y-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setShowExcluded((v) => !v)}
                >
                  {showExcluded
                    ? t('basketHideExcluded')
                    : t('basketShowExcluded', { count: excluded.length })}
                </Button>
                {showExcluded && (
                  <ul className="space-y-1 text-xs">
                    {excluded.map((q) => (
                      <li key={q.query}>
                        <span className="text-muted-foreground line-through">{q.query}</span>
                        {q.reason && <span className="text-muted-foreground"> — {q.reason}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The brand's existing pages an opportunity is about, and what to do with them. */
export function TargetPagesCard({
  decision,
  sourceData,
}: {
  decision: ContentOpportunityDecision;
  sourceData: ContentOpportunitySourceData;
}) {
  const t = useTranslations('content');
  const pages = sourceData.targetPages ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">{t('detail.targetTitle')}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">
            {t(`decision.${decision}`)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{t(`decisionHint.${decision}`)}</p>
      </CardHeader>
      {pages.length > 0 && (
        <CardContent className="space-y-2">
          {pages.map((p) => (
            <a
              key={p.url}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start justify-between gap-3 rounded-md border p-2.5 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium line-clamp-1">{p.title || p.url}</p>
                <p className="text-xs text-muted-foreground truncate">{p.url}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t('detail.targetStats', {
                    citations: p.aiCitations,
                    sessions: p.gaSessions,
                  })}
                </p>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-1" />
            </a>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
