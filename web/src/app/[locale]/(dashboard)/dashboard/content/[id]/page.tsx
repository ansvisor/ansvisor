'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Send,
  Loader2,
  TrendingUp,
  Eye,
  Users,
  Search,
  Tag,
  Clock,
  X,
  Sparkles,
  FileText,
  Target,
  ListOrdered,
  Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import {
  getOpportunity,
  updateOpportunityStatus,
  sendToWebhook,
  generateBrief,
  getBriefQuota,
  type BriefQuota,
} from '@/lib/actions/content';
import type { ContentBrief, ContentOpportunity } from '@/types';
import { toast } from 'sonner';

const IMPACT_COLORS: Record<string, string> = {
  high: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  sent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  in_progress: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  done: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  dismissed: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
};

const INTENT_LABELS: Record<string, string> = {
  comparison: 'Comparison',
  'how-to': 'How-to',
  'what-is': 'What is',
  'best-top': 'Best / Top',
  'vs-review': 'vs. / Review',
  recommendation: 'Recommendation',
  'problem-solving': 'Problem Solving',
  other: 'Other',
};

function StatCard({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-lg border p-3', className)}>
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export default function ContentDetailPage() {
  const t = useTranslations('content');
  const params = useParams();
  const id = params.id as string;

  const [opportunity, setOpportunity] = useState<ContentOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [brief, setBrief] = useState<ContentBrief | null>(null);
  const [quota, setQuota] = useState<BriefQuota | null>(null);

  useEffect(() => {
    setLoading(true);
    getOpportunity(id)
      .then((opp) => {
        setOpportunity(opp);
        if (opp.brief) setBrief(opp.brief);
      })
      .catch((err) => {
        console.error('Failed to load opportunity:', err);
        toast.error('Failed to load opportunity');
      })
      .finally(() => setLoading(false));

    // Quota is informational — don't block the page if it fails.
    getBriefQuota()
      .then(setQuota)
      .catch(() => setQuota(null));
  }, [id]);

  const handleSend = async () => {
    setSending(true);
    try {
      const result = await sendToWebhook(id);
      if (!result.success) {
        toast.error(result.error || 'Failed to send');
        return;
      }
      toast.success('Sent to workflow!');
      const updated = await getOpportunity(id);
      setOpportunity(updated);
    } catch (err) {
      console.error('Send failed:', err);
      toast.error('Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleDismiss = async () => {
    try {
      await updateOpportunityStatus(id, 'dismissed');
      toast.success('Opportunity dismissed');
      const updated = await getOpportunity(id);
      setOpportunity(updated);
    } catch {
      toast.error('Failed to dismiss');
    }
  };

  const handleGenerateBrief = async () => {
    setGeneratingBrief(true);
    try {
      const result = await generateBrief(id);
      setBrief(result.brief);
      if (result.quota) setQuota(result.quota);
      toast.success('Content brief generated!');
    } catch (err) {
      console.error('Brief generation failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to generate brief');
      // Refresh the counter — the failure may have been a quota rejection.
      getBriefQuota()
        .then(setQuota)
        .catch(() => {});
    } finally {
      setGeneratingBrief(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!opportunity) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Opportunity not found.</p>
      </div>
    );
  }

  const sd = opportunity.sourceData;
  const quotaLimited = quota !== null && quota.limit !== -1;
  const quotaExhausted = quotaLimited && quota.remaining <= 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/content">
          <Button variant="ghost" size="icon" aria-label="Go back to content list">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight">{opportunity.title}</h1>
          {opportunity.description && (
            <p className="text-sm text-muted-foreground mt-1">{opportunity.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {opportunity.status === 'new' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDismiss}
                className="gap-2 text-muted-foreground"
              >
                <X className="h-4 w-4" />
                {t('dismiss')}
              </Button>
              <Button size="sm" onClick={handleSend} disabled={sending} className="gap-2">
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sending ? t('sending') : t('sendToWorkflow')}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {t(`type.${opportunity.type}` as 'type.owned' | 'type.earned')}
        </Badge>
        <Badge variant="outline" className={cn('text-xs', IMPACT_COLORS[opportunity.impact])}>
          {t(`impact.${opportunity.impact}` as 'impact.high' | 'impact.medium' | 'impact.low')}
        </Badge>
        <Badge variant="outline" className={cn('text-xs', STATUS_COLORS[opportunity.status])}>
          {t(`status.${opportunity.status}` as `status.${typeof opportunity.status}`)}
        </Badge>
        <Badge variant="outline" className="text-xs tabular-nums">
          Score: {Math.round(opportunity.opportunityScore)}
        </Badge>
        <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {new Date(opportunity.createdAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('detail.sourceData')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sd.promptText && (
              <StatCard icon={Search} label={t('detail.relatedPrompt')} value={sd.promptText} />
            )}

            <div className="grid grid-cols-2 gap-3">
              {sd.estAiVolume !== undefined && (
                <StatCard
                  icon={TrendingUp}
                  label={t('detail.estAiVolume')}
                  value={`~${sd.estAiVolume.toLocaleString()}/mo`}
                />
              )}
              {sd.visibilityScore !== undefined && (
                <StatCard
                  icon={Eye}
                  label={t('detail.visibility')}
                  value={`${Math.round(sd.visibilityScore)}%`}
                />
              )}
              {sd.competitorGap !== undefined && (
                <StatCard
                  icon={Users}
                  label={t('detail.competitorGap')}
                  value={`${sd.competitorGap > 0 ? '+' : ''}${Math.round(sd.competitorGap)}%`}
                />
              )}
              {sd.intent && (
                <StatCard
                  icon={Tag}
                  label={t('detail.intent')}
                  value={INTENT_LABELS[sd.intent] || sd.intent}
                />
              )}
            </div>

            {sd.keywords && sd.keywords.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">{t('detail.keywords')}</p>
                <div className="flex flex-wrap gap-1">
                  {sd.keywords.map((kw) => (
                    <Badge key={kw} variant="outline" className="text-xs">
                      {kw}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {sd.competitorsCited && sd.competitorsCited.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  {t('detail.competitorsCited')}
                </p>
                <div className="flex flex-wrap gap-1">
                  {sd.competitorsCited.map((comp) => (
                    <Badge
                      key={comp}
                      variant="outline"
                      className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    >
                      {comp}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {brief ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-medium">Content Brief</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">{brief.suggestedTitle}</h3>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge variant="outline" className="text-xs">
                    {brief.contentType.replace(/-/g, ' ')}
                  </Badge>
                  <Badge variant="outline" className="text-xs tabular-nums">
                    ~{brief.targetWordCount.toLocaleString()} words
                  </Badge>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Target className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium">Keywords</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {brief.targetKeywords.map((kw) => (
                    <Badge
                      key={kw}
                      variant="outline"
                      className="text-xs border-primary/30 bg-primary/5"
                    >
                      {kw}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">CTA</p>
                <p className="text-xs font-medium">{brief.callToAction}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              {quotaExhausted ? (
                <>
                  <Crown className="h-10 w-10 text-amber-500/60 mb-3" />
                  <h3 className="text-sm font-medium mb-1">Monthly Brief Limit Reached</h3>
                  <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                    You&apos;ve used all {quota.limit} content briefs included in your plan this
                    month. Upgrade for a higher limit, or wait until the 1st when your quota resets.
                  </p>
                  <Link href="/dashboard/settings?tab=billing">
                    <Button className="gap-2">
                      <Crown className="h-4 w-4" />
                      Upgrade Plan
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <Sparkles className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <h3 className="text-sm font-medium mb-1">No Content Brief Yet</h3>
                  <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                    Generate an AI-powered content brief with a suggested title, outline, target
                    keywords, and competitor insights.
                  </p>
                  <Button
                    onClick={handleGenerateBrief}
                    disabled={generatingBrief}
                    className="gap-2"
                  >
                    {generatingBrief ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {generatingBrief ? 'Generating...' : 'Generate Content Brief'}
                  </Button>
                  {quotaLimited && (
                    <p className="text-xs text-muted-foreground mt-3 tabular-nums">
                      {quota.remaining}/{quota.limit} briefs remaining this month
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Full Brief Detail (shown when brief exists) */}
      {brief && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-medium">Brief Outline</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              {brief.outline.map((section, idx) => (
                <div key={idx} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-sm font-medium mb-1.5">
                    {idx + 1}. {section.heading}
                  </p>
                  <ul className="space-y-1 ml-4">
                    {section.keyPoints.map((point, pIdx) => (
                      <li key={pIdx} className="text-xs text-muted-foreground list-disc">
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Competitor Insights</p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {brief.competitorInsights}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
