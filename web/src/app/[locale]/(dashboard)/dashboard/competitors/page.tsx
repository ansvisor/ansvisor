'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useUserRole } from '@/hooks/use-user-role';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import {
  getCompetitors,
  getMergedCompetitors,
  addCompetitor,
  deleteCompetitor,
  getCompetitorTimeline,
} from '@/lib/actions/competitor';
import type { CompetitorTimeline } from '@/lib/competitor-timeline';
import { CompetitorTimelineCard } from './_timeline-card';
import type { SuggestedCompetitor } from '@/lib/ai-brand-setup';
import { SuggestCompetitorsDialog } from './_suggest-competitors-dialog';
import {
  getCompetitorComparison,
  getHeadToHeadComparison,
  getHeadToHeadRuns,
  type CompetitorComparisonData,
} from '@/lib/actions/tracking';
import {
  foldScores,
  type HeadToHeadData,
  type HeadToHeadGroup,
  type HeadToHeadRun,
} from '@/lib/head-to-head';
import { rankWithYou } from '@/lib/competitors/grid-rank';
import { toCsv } from '@/lib/csv';
import { slugify } from '@/lib/slug';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/url-state';
import { DateRangeFilter, type DateRangePreset } from '@/components/filters/date-range-filter';
import { getDateRange } from '@/lib/date-range';
import { useChatPageContext, useChatPanel } from '@/components/chat/panel/chat-panel-context';
import { rangeChipLabel } from '@/lib/chat/page-context';
import { viewRows } from '@/lib/chat/page-view';
import { MODEL_LABELS } from '@/config/platform-labels';
import { PLANS } from '@/config/plans';
import { usePlanContext } from '@/components/providers/plan-provider';
import { breakdownForPlan, planEngineKeys } from '@/lib/competitors/plan-engines';
import type { Competitor } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { exportFileName } from '@/lib/white-label/export-name';
import { AIProviderAvatar, resolveAIProvider } from '@/components/ai-provider-avatar';
import { BrandAvatar } from '@/components/brand-avatar';
import { engineCount, engineRows, lowSample } from '@/lib/competitors/prompt-engines';
import {
  PROMPT_PAGE_SIZE,
  caseRepeats,
  listPrompts,
  promptCategories,
  type PromptSort,
} from '@/lib/competitors/prompt-list';
import {
  Plus,
  Sparkles,
  Trash2,
  Loader2,
  Users,
  Crown,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Swords,
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  ChevronDown,
  Eye,
  Download,
  Tag,
  Merge,
  MessageSquarePlus,
} from 'lucide-react';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';
import {
  CompetitorTypeBadge,
  CompetitorTypePicker,
  SetCompetitorTypeDialog,
  competitorTypeIsValid,
} from '@/components/competitors/competitor-type';
import {
  NO_COMPETITOR_TYPE,
  competitorTypeLabel,
  competitorTypeOptions,
  groupCompetitorsByType,
  matchesCompetitorType,
} from '@/lib/competitor-types';
import {
  CompetitorAliases,
  DuplicateHint,
  MergeCompetitorsDialog,
  MergedCompetitorsSection,
  UnmergeCompetitorDialog,
} from '@/components/competitors/merge-competitors';
import {
  likelyDuplicates,
  mergedMatch,
  type CompetitorAlias,
  type MergedCompetitor,
} from '@/lib/competitor-merge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Shared Visual Components (mirroring Insights) ───────────────────────────

function getModelDisplayName(model: string, platform?: string): string {
  // In h2h data, platform is already resolved (e.g. "ChatGPT", "Perplexity")
  // so use it directly if available
  if (platform) {
    const modelName = MODEL_LABELS[model];
    return modelName && modelName !== platform ? `${platform} · ${modelName}` : platform;
  }
  return MODEL_LABELS[model] ?? model;
}

function ModelBadge({ model, platform }: { model: string; platform?: string }) {
  const provider = resolveAIProvider(model, platform);
  return (
    <span className="inline-flex items-center gap-1.5">
      <AIProviderAvatar provider={provider} />
      <span className="text-xs">{getModelDisplayName(model, platform)}</span>
    </span>
  );
}

/** A score from fewer than 10 runs (D8, UX audit CP-05). */
function LowSampleBadge() {
  const t = useTranslations('competitors');
  return (
    <Badge
      variant="outline"
      data-slot="low-sample"
      title={t('h2h.lowSampleTip')}
      className="border-amber-200 bg-amber-50 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
    >
      {t('h2h.lowSample')}
    </Badge>
  );
}

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs capitalize',
        sentiment === 'positive' &&
          'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
        sentiment === 'neutral' &&
          'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        sentiment === 'negative' &&
          'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      {sentiment}
    </Badge>
  );
}

// ─── Plan Gate ────────────────────────────────────────────────────────────────

function PlanGateOverlay() {
  const t = useTranslations('competitors');
  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </HeaderWithAiUsage>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
            <Crown className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold">{t('upgradeTitle')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('upgradeDescription')}</p>
          <Badge variant="outline" className="mt-4">
            <Crown className="me-1 h-3 w-3" />
            {t('upgradeRequiredPlan')}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── No Brand ─────────────────────────────────────────────────────────────────

function NoBrandSelected() {
  const t = useTranslations('competitors');
  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </HeaderWithAiUsage>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white mb-4">
            <AlertCircle className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">{t('noBrandTitle')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('noBrandDescription')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

/** Without onAdd (a member who isn't an admin or a manager) there's nothing to start with here. */
function EmptyState({ onAdd, onSuggest }: { onAdd?: () => void; onSuggest?: () => void }) {
  const t = useTranslations('competitors');
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white mb-4">
          <Users className="h-7 w-7 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{t('emptyTitle')}</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('emptyDescription')}</p>
        {onAdd && onSuggest && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button className="gap-2" onClick={onAdd}>
              <Plus className="h-4 w-4" />
              {t('addCompetitor')}
            </Button>
            <Button variant="outline" className="gap-2" onClick={onSuggest}>
              <Sparkles className="h-4 w-4" />
              {t('suggestCompetitors')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Add Dialog ───────────────────────────────────────────────────────────────

function AddCompetitorDialog({
  open,
  onOpenChange,
  onAdd,
  typeOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, domain: string, type: string | null) => Promise<void>;
  /** The types the brand's picker offers (competitorTypeOptions). */
  typeOptions: readonly string[];
}) {
  const t = useTranslations('competitors');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName('');
    setDomain('');
    setType(null);
    setPickerKey((k) => k + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !competitorTypeIsValid(type)) return;
    setSaving(true);
    try {
      await onAdd(name.trim(), domain.trim(), type?.trim() || null);
      reset();
      onOpenChange(false);
    } catch {
      toast.error(t('addError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('addCompetitor')}</DialogTitle>
            <DialogDescription>{t('addDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="comp-name">{t('name')}</Label>
              <Input
                id="comp-name"
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="comp-domain">{t('domain')}</Label>
              <Input
                id="comp-domain"
                placeholder={t('domainPlaceholder')}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="comp-type">{t('type.label')}</Label>
              <CompetitorTypePicker
                key={pickerKey}
                id="comp-type"
                value={type}
                options={typeOptions}
                onChange={setType}
                disabled={saving}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !competitorTypeIsValid(type)}>
              {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diff Indicator ───────────────────────────────────────────────────────────

function DiffBadge({ diff }: { diff: number }) {
  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-green-600 dark:text-green-400">
        <ArrowUpRight className="h-3 w-3" />+{diff}
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600 dark:text-red-400">
        <ArrowDownRight className="h-3 w-3" />
        {diff}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus className="h-3 w-3" />0
    </span>
  );
}

// ─── Competitor Cards (Management) ────────────────────────────────────────────

/** A card's numbers: the Visibility score and its parts, over the picker's period. */
interface CardStats {
  score: number | null;
  mentionAnswers: number;
  citationAnswers: number;
  positionFactor: number | null;
  visiblePrompts: number;
  promptCount: number;
  mentions: number;
  citations: number;
}

/** Its place by Visibility score (UX audit CP-06): "#2", blank when not ranked. */
function RankNumber({ rank }: { rank: number | null }) {
  const t = useTranslations('competitors');
  return (
    <span
      data-slot="grid-rank"
      className="w-6 shrink-0 text-center text-xs font-medium text-muted-foreground tabular-nums"
      aria-label={rank ? t('rank.label', { rank }) : undefined}
    >
      {rank ? t('rank.short', { rank }) : ''}
    </span>
  );
}

/** The card's score and prompt count, marked when too few prompts name it to rank (D8). */
function CardScore({
  stats,
  period,
  lowSample,
}: {
  stats: CardStats | null;
  period: string;
  lowSample: boolean;
}) {
  const t = useTranslations('competitors');
  const tMetrics = useTranslations('metrics');
  if (!stats) {
    return (
      <div className="text-end">
        <span className="text-xs text-muted-foreground">{t('noData')}</span>
      </div>
    );
  }
  return (
    <div
      className="text-end"
      title={t('card.scoreTip', {
        mentionAnswers: stats.mentionAnswers,
        citationAnswers: stats.citationAnswers,
        position: stats.positionFactor?.toFixed(2) ?? '—',
        mentions: stats.mentions,
        citations: stats.citations,
      })}
    >
      <div className="text-sm font-semibold tabular-nums">{stats.score ?? '—'}</div>
      {/* Which prompts the count is out of (UX audit CP-03, decision D4). */}
      <div
        className="text-[10px] text-muted-foreground tabular-nums"
        title={tMetrics('promptsAnswered', { count: stats.promptCount, period })}
      >
        {t('card.prompts', { visible: stats.visiblePrompts, count: stats.promptCount })}
      </div>
      {lowSample && (
        <div
          data-slot="low-sample"
          title={t('rank.lowSampleTip')}
          className="text-[10px] text-amber-700 dark:text-amber-400"
        >
          {t('rank.lowSample')}
        </div>
      )}
    </div>
  );
}

/** The brand's own card in the grid, in its place by score ("You"). */
function YouCard({
  name,
  stats,
  rank,
  lowSample,
  period,
}: {
  name: string;
  stats: CardStats | null;
  rank: number | null;
  lowSample: boolean;
  period: string;
}) {
  const t = useTranslations('competitors');
  return (
    <div
      data-slot="you-card"
      className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 p-3"
    >
      <RankNumber rank={rank} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {t('rank.you')}
          </Badge>
        </div>
      </div>
      <CardScore stats={stats} period={period} lowSample={lowSample} />
    </div>
  );
}

function CompetitorCard({
  competitor,
  aliases,
  stats,
  isSelected,
  onSelect,
  onSetType,
  onDelete,
  deleting,
  period,
  rank = null,
  lowSample = false,
}: {
  competitor: Competitor;
  /** The names and domains merged into it (00543), counted as its own. */
  aliases?: readonly CompetitorAlias[];
  stats: CardStats | null;
  /** Its place by Visibility score, null when not ranked (CP-06). */
  rank?: number | null;
  lowSample?: boolean;
  isSelected: boolean;
  onSelect: () => void;
  /** Absent for a member who isn't an admin or a manager: no Set type button. */
  onSetType?: () => void;
  /** Absent for a member who isn't an admin or a manager: no delete button. */
  onDelete?: () => void;
  deleting: boolean;
  /** The picker's range in words ("the last 30 days"), for the prompt count's tooltip. */
  period: string;
}) {
  const t = useTranslations('competitors');

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 rounded-lg border p-3 transition-colors cursor-pointer hover:bg-accent/50',
        isSelected && 'border-primary bg-primary/5 ring-1 ring-primary/20',
      )}
      onClick={onSelect}
    >
      <RankNumber rank={rank} />
      {/* Its favicon, then its initials: never a generic globe (UX audit CP-14). */}
      <BrandAvatar
        name={competitor.name}
        primaryDomain={competitor.domain || undefined}
        className="h-9 w-9 shrink-0 rounded-md"
        fallbackClassName="rounded-md text-xs"
      />

      <div className="flex-1 min-w-0">
        {/* Selected shows as the card's border, so the name keeps its width (UX audit CP-10). */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" title={competitor.name}>
            {competitor.name}
          </span>
          {isSelected && <span className="sr-only">{t('selected')}</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs text-muted-foreground truncate">{competitor.domain || '—'}</span>
          <CompetitorTypeBadge type={competitor.type} className="shrink-0" />
        </div>
        <CompetitorAliases name={competitor.name} aliases={aliases} />
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <CardScore stats={stats} period={period} lowSample={lowSample} />
      </div>

      {/* Its buttons over the card's corner on hover or focus: they take no width from the name (CP-10). */}
      {(onSetType || onDelete) && (
        <div
          data-slot="card-actions"
          className="absolute end-1 top-1 flex gap-0.5 rounded-md bg-card/95 shadow-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        >
          {onSetType && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('type.setFor', { name: competitor.name })}
              title={t('type.setFor', { name: competitor.name })}
              className="h-7 w-7 text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onSetType();
              }}
            >
              <Tag className="h-3.5 w-3.5" />
            </Button>
          )}

          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('delete')}
              title={t('delete')}
              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Head-to-Head: Platform Breakdown ─────────────────────────────────────────

function PlatformBreakdown({
  data,
  brandName,
  competitorName,
}: {
  data: HeadToHeadData;
  brandName: string;
  competitorName: string;
}) {
  const t = useTranslations('competitors');
  const { planId, isCloud, allowedModelIds } = usePlanContext();
  // Only the engines the plan tracks, those without answers too (UX audit CP-04).
  const { rows, notInPlan } = breakdownForPlan(
    data.platformRows,
    isCloud ? planEngineKeys(PLANS[planId]?.limits.allowedScrapers, allowedModelIds) : null,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('h2h.platformBreakdown')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {rows.map((row) => {
            const max = Math.max(row.brandScore, row.competitorScore, 1);
            const name = (
              <span className="font-medium">
                {row.platform}
                {row.provider === 'copilot' && (
                  <span className="font-normal text-muted-foreground"> {t('h2h.viaBing')}</span>
                )}
              </span>
            );
            if (row.noAnswers) {
              return (
                <div
                  key={row.platform}
                  data-slot="engine-no-answers"
                  className="flex items-center justify-between text-xs"
                >
                  {name}
                  <span className="text-muted-foreground">{t('h2h.noAnswersEngine')}</span>
                </div>
              );
            }
            return (
              <div key={row.platform} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  {name}
                  <DiffBadge diff={row.diff} />
                </div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 flex gap-1">
                    <div
                      className="h-2 rounded-full bg-blue-500 dark:bg-blue-400 transition-all"
                      style={{ width: `${(row.brandScore / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums w-10 text-end font-medium">
                    {row.brandScore}
                  </span>
                </div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 flex gap-1">
                    <div
                      className="h-2 rounded-full bg-orange-400 dark:bg-orange-500 transition-all"
                      style={{ width: `${(row.competitorScore / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums w-10 text-end font-medium">
                    {row.competitorScore}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-4 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400" />
            {brandName}
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-orange-400 dark:bg-orange-500" />
            {competitorName}
          </div>
        </div>
        {notInPlan.length > 0 && (
          <p data-slot="engines-not-in-plan" className="mt-2 text-[11px] text-muted-foreground">
            {t('h2h.notInPlan', { engines: notInPlan.join(', ') })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Head-to-Head: Grouped Prompt Comparison ─────────────────────────────────

interface PromptComparisonGroup {
  promptId: string;
  promptText: string;
  promptCategory?: string;
  groups: HeadToHeadGroup[];
  runs: number;
  latestAt: string;
  avgBrandScore: number;
  avgCompetitorScore: number;
  avgDiff: number;
}

/** Fold engine groups into one row per prompt, weighting each engine by its runs. */
function groupH2HByPrompt(groups: HeadToHeadGroup[]): PromptComparisonGroup[] {
  const map = new Map<string, HeadToHeadGroup[]>();
  for (const g of groups) {
    const arr = map.get(g.promptId) || [];
    arr.push(g);
    map.set(g.promptId, arr);
  }
  return Array.from(map.entries())
    .map(([promptId, items]) => {
      const runs = items.reduce((s, g) => s + g.runs, 0);
      // The prompt's scores over all its engines' answers (UX audit CP-01).
      const { brandScore: avgB, competitorScore: avgC, diff } = foldScores(items);
      return {
        promptId,
        promptText: items[0].promptText,
        promptCategory: items[0].promptCategory,
        groups: [...items].sort((a, b) => b.brandScore - a.brandScore),
        runs,
        latestAt: items.reduce((max, g) => (g.latestAt > max ? g.latestAt : max), ''),
        avgBrandScore: avgB,
        avgCompetitorScore: avgC,
        avgDiff: diff,
      };
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

type LoadRuns = (group: HeadToHeadGroup, limit: number) => Promise<HeadToHeadRun[]>;

const RUN_HISTORY_LIMIT = 50;

function ModelSubGroup({
  group,
  expanded,
  onToggle,
  onViewResult,
  loadRuns,
  brandName,
  competitorName,
  showModel = false,
}: {
  group: HeadToHeadGroup;
  expanded: boolean;
  onToggle: () => void;
  onViewResult: (resultId: string) => void;
  loadRuns: LoadRuns;
  brandName: string;
  competitorName: string;
  /** Its location shows twice under its engine: name the model (CP-05). */
  showModel?: boolean;
}) {
  const t = useTranslations('competitors');
  const hasHistory = group.runs > 1;
  const model = MODEL_LABELS[group.modelUsed] ?? group.modelUsed;
  const [runs, setRuns] = useState<HeadToHeadRun[] | null>(null);
  const [runsFailed, setRunsFailed] = useState(false);
  const [openingLatest, setOpeningLatest] = useState(false);

  useEffect(() => {
    if (!expanded || !hasHistory || runs !== null) return;
    let cancelled = false;
    setRunsFailed(false);
    loadRuns(group, RUN_HISTORY_LIMIT)
      .then((loaded) => {
        if (!cancelled) setRuns(loaded);
      })
      .catch(() => {
        if (!cancelled) setRunsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, hasHistory, runs, group, loadRuns]);

  const viewLatest = async () => {
    if (openingLatest) return;
    setOpeningLatest(true);
    try {
      const [latest] = runs ?? (await loadRuns(group, 1));
      if (latest) onViewResult(latest.resultId);
    } catch {
      toast.error(t('h2h.loadError'));
    } finally {
      setOpeningLatest(false);
    }
  };

  return (
    <div className="rounded-md border bg-background/50">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2 transition-colors select-none',
          hasHistory ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default',
        )}
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            !expanded && '-rotate-90',
            !hasHistory && 'opacity-0',
          )}
        />
        {/* A location under its engine (CP-05): the engine is the heading above. */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {group.region ?? t('h2h.noLocation')}
          </Badge>
          {showModel && model && <span className="text-[10px] text-muted-foreground">{model}</span>}
          <span className="text-[10px] text-muted-foreground tabular-nums ms-1">
            {t('h2h.runs', { count: group.runs })}
          </span>
          {lowSample(group.runs) && <LowSampleBadge />}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-end">
            <p className="text-[10px] text-muted-foreground">{t('h2h.you')}</p>
            <p className="text-xs font-semibold tabular-nums">{group.brandScore}</p>
          </div>
          <div className="text-end">
            <p className="text-[10px] text-muted-foreground">{t('h2h.them')}</p>
            <p className="text-xs font-semibold tabular-nums">{group.competitorScore}</p>
          </div>
          <div className="text-end min-w-[48px]">
            <p className="text-[10px] text-muted-foreground">{t('h2h.diff')}</p>
            <DiffBadge diff={group.diff} />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="View latest AI response"
            disabled={openingLatest}
            onClick={(e) => {
              e.stopPropagation();
              void viewLatest();
            }}
            aria-label="View latest AI response"
          >
            {openingLatest ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {expanded && hasHistory && (
        <div className="border-t bg-muted/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
            Previous runs
          </p>
          {runsFailed ? (
            <p className="py-2 text-xs text-muted-foreground">{t('h2h.loadError')}</p>
          ) : runs === null ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] h-7">Date</TableHead>
                  <TableHead className="text-[10px] h-7 text-center">{brandName}</TableHead>
                  <TableHead className="text-[10px] h-7 text-center">{competitorName}</TableHead>
                  <TableHead className="text-[10px] h-7 text-center">{t('h2h.diff')}</TableHead>
                  <TableHead className="text-[10px] h-7 text-center">Sentiment</TableHead>
                  <TableHead className="text-[10px] h-7 w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((row) => (
                  <TableRow key={row.resultId} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground py-1.5">
                      {formatTimestamp(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-center py-1.5 text-xs font-semibold tabular-nums">
                      {row.brandScore}
                    </TableCell>
                    <TableCell className="text-center py-1.5 text-xs font-semibold tabular-nums">
                      {row.competitorScore}
                    </TableCell>
                    <TableCell className="text-center py-1.5">
                      <DiffBadge
                        diff={Math.round((row.brandScore - row.competitorScore) * 10) / 10}
                      />
                    </TableCell>
                    <TableCell className="text-center py-1.5">
                      <SentimentBadge sentiment={row.sentiment} />
                    </TableCell>
                    <TableCell className="text-center py-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="View AI response"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewResult(row.resultId);
                        }}
                        aria-label="View AI response"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

function PromptComparisonGrouped({
  groups: engineGroups,
  brandName,
  competitorName,
  onViewResult,
  loadRuns,
}: {
  groups: HeadToHeadGroup[];
  brandName: string;
  competitorName: string;
  onViewResult: (resultId: string) => void;
  loadRuns: LoadRuns;
}) {
  const t = useTranslations('competitors');
  const all = groupH2HByPrompt(engineGroups);
  // Search, sort, category and pages (UX audit CP-12).
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PromptSort>('recent');
  const [category, setCategory] = useState('');
  const [shown, setShown] = useState(PROMPT_PAGE_SIZE);
  const categories = promptCategories(all);
  const listed = listPrompts(all, { query, category, sort });
  const groups = listed.slice(0, shown);
  const repeats = caseRepeats(all);
  const sortItems = [
    { value: 'recent', label: t('h2h.list.sortRecent') },
    { value: 'diff', label: t('h2h.list.sortDiff') },
  ];
  const categoryItems = [
    { value: '', label: t('h2h.list.allCategories') },
    ...categories.map((name) => ({ value: name, label: name })),
  ];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleModel = (id: string) =>
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (all.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t('h2h.noPromptData')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div data-slot="prompt-list-controls" className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PROMPT_PAGE_SIZE);
          }}
          placeholder={t('h2h.list.search')}
          aria-label={t('h2h.list.search')}
          data-action="competitors.searchPrompts"
          className="h-8 w-full text-xs sm:w-64"
        />
        <Select
          items={sortItems}
          value={sort}
          onValueChange={(next: string | null) => setSort(next === 'diff' ? 'diff' : 'recent')}
        >
          <SelectTrigger size="sm" className="text-xs" aria-label={t('h2h.list.sortLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {categories.length > 0 && (
          <Select
            items={categoryItems}
            value={category}
            onValueChange={(next: string | null) => {
              setCategory(next ?? '');
              setShown(PROMPT_PAGE_SIZE);
            }}
          >
            <SelectTrigger size="sm" className="text-xs" aria-label={t('h2h.list.categoryLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryItems.map((item) => (
                <SelectItem key={item.value || ' all'} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="text-xs text-muted-foreground tabular-nums" data-slot="prompt-list-count">
          {t('h2h.list.count', { shown: groups.length, total: listed.length })}
        </span>
      </div>
      {repeats > 0 && (
        <p data-slot="prompt-case-repeats" className="text-xs text-muted-foreground">
          {t('h2h.list.caseRepeats', { count: repeats })}
        </p>
      )}
      {listed.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('h2h.list.noMatch')}</p>
      )}
      {groups.map((group) => {
        const isOpen = expanded.has(group.promptId);
        const modelGroups = group.groups;
        return (
          <div key={group.promptId} className="rounded-lg border overflow-hidden">
            {/* Group Header */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggle(group.promptId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(group.promptId);
                }
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/50 transition-colors cursor-pointer select-none"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  !isOpen && '-rotate-90',
                )}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-1">{group.promptText}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {group.promptCategory && (
                    <Badge variant="outline" className="text-[10px]">
                      {group.promptCategory}
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {t('h2h.promptCounts', {
                      engines: engineCount(modelGroups),
                      runs: group.runs,
                    })}
                  </span>
                  {lowSample(group.runs) && <LowSampleBadge />}
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-end">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.you')}</p>
                  <p className="text-sm font-semibold tabular-nums">{group.avgBrandScore}</p>
                </div>
                <div className="text-end">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.them')}</p>
                  <p className="text-sm font-semibold tabular-nums">{group.avgCompetitorScore}</p>
                </div>
                <div className="text-end min-w-[48px]">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.diff')}</p>
                  <DiffBadge diff={group.avgDiff} />
                </div>
              </div>
            </div>

            {/* Platform/Model sub-groups */}
            {isOpen && (
              <div className="border-t px-3 py-2 space-y-3 bg-muted/10">
                {/* Each engine once, its locations under it (UX audit CP-05). */}
                {(() => {
                  const { engines, twice } = engineRows(modelGroups);
                  return engines.map((engine) => (
                    <div key={engine.platform} data-slot="h2h-engine" className="space-y-1.5">
                      <div className="flex items-center gap-3 px-1">
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <ModelBadge model={engine.platform} platform={engine.platform} />
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {t('h2h.engineCounts', {
                              locations: engine.locations,
                              runs: engine.runs,
                            })}
                          </span>
                          {lowSample(engine.runs) && <LowSampleBadge />}
                        </div>
                        <div className="flex items-center gap-4 shrink-0 pe-10">
                          <p className="text-xs font-semibold tabular-nums">{engine.brandScore}</p>
                          <p className="text-xs font-semibold tabular-nums">
                            {engine.competitorScore}
                          </p>
                          <div className="min-w-[48px] text-end">
                            <DiffBadge diff={engine.diff} />
                          </div>
                        </div>
                      </div>
                      {engine.rows.map((mg) => {
                        const compositeKey = `${group.promptId}::${mg.rawPlatform ?? ''}|${mg.rawModelUsed ?? ''}|${mg.region ?? ''}`;
                        return (
                          <ModelSubGroup
                            key={compositeKey}
                            group={mg}
                            expanded={expandedModels.has(compositeKey)}
                            onToggle={() => toggleModel(compositeKey)}
                            onViewResult={onViewResult}
                            loadRuns={loadRuns}
                            brandName={brandName}
                            competitorName={competitorName}
                            showModel={twice.has(mg)}
                          />
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        );
      })}
      {listed.length > groups.length && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-action="competitors.morePrompts"
          className="w-full text-xs"
          onClick={() => setShown((n) => n + PROMPT_PAGE_SIZE)}
        >
          {t('h2h.list.more', { count: Math.min(PROMPT_PAGE_SIZE, listed.length - groups.length) })}
        </Button>
      )}
    </div>
  );
}

// ─── Gap / Strength Cards ─────────────────────────────────────────────────────

interface GapStrengthGroup {
  promptId: string;
  promptText: string;
  items: HeadToHeadGroup[];
  avgBrandScore: number;
  avgCompetitorScore: number;
  avgDiff: number;
}

function groupGapStrengthByPrompt(items: HeadToHeadGroup[]): GapStrengthGroup[] {
  const map = new Map<string, HeadToHeadGroup[]>();
  for (const item of items) {
    const arr = map.get(item.promptId) || [];
    arr.push(item);
    map.set(item.promptId, arr);
  }
  return Array.from(map.entries())
    .map(([promptId, groupItems]) => {
      // The prompt's scores over its gap (or strength) engines' answers.
      const { brandScore: avgB, competitorScore: avgC, diff } = foldScores(groupItems);
      return {
        promptId,
        promptText: groupItems[0].promptText,
        items: groupItems,
        avgBrandScore: avgB,
        avgCompetitorScore: avgC,
        avgDiff: diff,
      };
    })
    .sort((a, b) => a.avgDiff - b.avgDiff);
}

/**
 * A gap's next steps (UX audit CP-09): Create action and Ask Chat open Chat's
 * side panel with the gap written in its box, for the person to send. Chat's
 * Send to Action Center writes the action's tasks, checks for an action that
 * already covers it and asks before creating. Nothing where the panel isn't.
 */
function GapNextSteps({
  promptText,
  platforms,
  you,
  them,
  competitorName,
}: {
  promptText: string;
  platforms: string[];
  you: number;
  them: number;
  competitorName: string;
}) {
  const t = useTranslations('competitors');
  const panel = useChatPanel();
  if (!panel?.available) return null;
  const values = {
    competitor: competitorName,
    prompt: promptText,
    you,
    them,
    platforms: platforms.join(', '),
    count: platforms.length,
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-action="competitors.gapCreateAction"
        title={t('h2h.gapPanelTip')}
        className="h-7 gap-1.5 bg-background text-xs"
        onClick={(e) => {
          e.stopPropagation();
          panel.fill(t('h2h.gapCreateText', values));
        }}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t('h2h.gapCreateAction')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-action="competitors.gapAskChat"
        title={t('h2h.gapPanelTip')}
        className="h-7 gap-1.5 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          panel.fill(t('h2h.gapAskText', values));
        }}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
        {t('h2h.gapAskChat')}
      </Button>
    </div>
  );
}

function GapStrengthList({
  items,
  type,
  competitorName,
}: {
  items: HeadToHeadGroup[];
  type: 'gap' | 'strength';
  competitorName: string;
}) {
  const t = useTranslations('competitors');
  const isGap = type === 'gap';
  const groups = groupGapStrengthByPrompt(items);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        {isGap ? t('h2h.noGaps') : t('h2h.noStrengths')}
      </div>
    );
  }

  // For strengths, reverse so best performers appear first
  const sorted = isGap ? groups : [...groups].reverse();

  return (
    <div className="space-y-2">
      {sorted.map((group, i) => {
        const isOpen = expanded.has(group.promptId);
        const hasMultiple = group.items.length > 1;

        return (
          <div
            key={group.promptId}
            className={cn(
              'rounded-lg border overflow-hidden',
              isGap
                ? 'border-red-200/50 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/20'
                : 'border-green-200/50 bg-green-50/50 dark:border-green-900/30 dark:bg-green-950/20',
            )}
          >
            {/* Group Header */}
            <div
              role={hasMultiple ? 'button' : undefined}
              tabIndex={hasMultiple ? 0 : undefined}
              onClick={() => hasMultiple && toggle(group.promptId)}
              onKeyDown={(e) => {
                if (hasMultiple && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  toggle(group.promptId);
                }
              }}
              className={cn(
                'flex items-start gap-3 p-3',
                hasMultiple &&
                  'cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors select-none',
              )}
            >
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold mt-0.5',
                  isGap
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                    : 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400',
                )}
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {hasMultiple && (
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                        !isOpen && '-rotate-90',
                      )}
                    />
                  )}
                  <p className="text-sm line-clamp-2">{group.promptText}</p>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>
                    {t('h2h.you')}: {group.avgBrandScore}
                  </span>
                  <span>
                    {t('h2h.them')}: {group.avgCompetitorScore}
                  </span>
                  {hasMultiple ? (
                    <span>{group.items.length} models</span>
                  ) : group.items[0].modelUsed || group.items[0].platform ? (
                    <ModelBadge
                      model={group.items[0].modelUsed || group.items[0].platform}
                      platform={group.items[0].platform}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                  {!hasMultiple && group.items[0].latestAt && (
                    <span className="text-muted-foreground">
                      {new Date(group.items[0].latestAt).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </div>
                {isGap && (
                  <GapNextSteps
                    promptText={group.promptText}
                    platforms={[...new Set(group.items.map((item) => item.platform))]}
                    you={group.avgBrandScore}
                    them={group.avgCompetitorScore}
                    competitorName={competitorName}
                  />
                )}
              </div>
              <div className="shrink-0">
                <DiffBadge diff={group.avgDiff} />
              </div>
            </div>

            {/* Expanded: per-model breakdown */}
            {isOpen && hasMultiple && (
              <div className="border-t px-3 pb-3 pt-2 space-y-1.5">
                {group.items.map((item, j) => (
                  <div
                    key={`${item.promptId}-${item.modelUsed}-${j}`}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-xs',
                      isGap
                        ? 'bg-red-100/50 dark:bg-red-900/20'
                        : 'bg-green-100/50 dark:bg-green-900/20',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      {item.modelUsed || item.platform ? (
                        <ModelBadge
                          model={item.modelUsed || item.platform}
                          platform={item.platform}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                    {item.region && (
                      <Badge variant="outline" className="text-[10px]">
                        {item.region}
                      </Badge>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {t('h2h.you')}: {item.brandScore}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('h2h.them')}: {item.competitorScore}
                    </span>
                    {item.latestAt && (
                      <span className="text-muted-foreground whitespace-nowrap">
                        {new Date(item.latestAt).toLocaleDateString('en-US', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    )}
                    <DiffBadge diff={Math.round(item.diff)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Head-to-Head Section ─────────────────────────────────────────────────────

function HeadToHeadSection({
  data,
  brandName,
  competitorName,
  loadRuns,
}: {
  data: HeadToHeadData;
  brandName: string;
  competitorName: string;
  loadRuns: LoadRuns;
}) {
  const t = useTranslations('competitors');
  const router = useRouter();
  const overallDiff = Math.round((data.brandAvg - data.competitorAvg) * 10) / 10;
  // The Visibility score, as the cards show it: 0–100, no "%" (decisions D1–D3).
  const outOf = <span className="ms-1 text-sm font-normal text-muted-foreground">/100</span>;

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Target className="h-3.5 w-3.5" />
              {t('h2h.yourAvg')}
            </div>
            <div className="text-2xl font-bold tabular-nums" title={t('h2h.scoreTip')}>
              {data.brandAvg}
              {outOf}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Swords className="h-3.5 w-3.5" />
              {t('h2h.theirAvg')}
            </div>
            <div className="text-2xl font-bold tabular-nums" title={t('h2h.scoreTip')}>
              {data.competitorAvg}
              {outOf}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              {overallDiff >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {t('h2h.overallDiff')}
            </div>
            <div
              className={cn(
                'text-2xl font-bold tabular-nums',
                overallDiff > 0 && 'text-green-600 dark:text-green-400',
                overallDiff < 0 && 'text-red-600 dark:text-red-400',
              )}
            >
              {overallDiff > 0 ? '+' : ''}
              {t('h2h.points', { value: overallDiff })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Platform Breakdown */}
        <PlatformBreakdown data={data} brandName={brandName} competitorName={competitorName} />

        {/* Gaps & Strengths */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-4">
            <Tabs defaultValue="gaps">
              <TabsList className="mb-3">
                <TabsTrigger value="gaps" className="gap-1.5 text-xs">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {t('h2h.gaps')} ({data.gaps.length})
                </TabsTrigger>
                <TabsTrigger value="strengths" className="gap-1.5 text-xs">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {t('h2h.strengths')} ({data.strengths.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="gaps">
                <GapStrengthList items={data.gaps} type="gap" competitorName={competitorName} />
              </TabsContent>
              <TabsContent value="strengths">
                <GapStrengthList
                  items={data.strengths}
                  type="strength"
                  competitorName={competitorName}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Grouped Prompt-by-Prompt Comparison */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('h2h.promptByPrompt')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('h2h.promptByPromptDesc')}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <PromptComparisonGrouped
            groups={data.groups}
            brandName={brandName}
            competitorName={competitorName}
            onViewResult={(resultId) => router.push(`/dashboard/insights/${resultId}`)}
            loadRuns={loadRuns}
          />
        </CardContent>
      </Card>
    </div>
  );
}

type CompetitorDatePreset = Exclude<DateRangePreset, '24h'>;

/** The type filter's All types: no stored type starts with a space (00542). */
const ALL_TYPES = ' all';

const COMPETITOR_DATE_PRESETS: readonly CompetitorDatePreset[] = [
  '7d',
  '30d',
  '90d',
  'all',
  'custom',
];

/** The days each fixed preset covers, as getDateRange counts them. */
const PRESET_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

function competitorComparisonWindow(
  preset: CompetitorDatePreset,
  custom: { from: string; to: string },
) {
  const range = getDateRange(preset, custom);
  // Always provide a days window so competitor_aggregates_daily is used, even
  // for all-time and partially specified custom ranges.
  return { ...range, days: range.days ?? {} };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const BENCHMARK_EXPORT_HEADERS = [
  'name',
  'is_own_brand',
  'type',
  'visibility_score',
  'visible_prompts',
  'prompt_count',
  'mention_answers',
  'citation_answers',
  'mentions',
  'citations',
];

const HEAD_TO_HEAD_EXPORT_HEADERS = [
  'prompt',
  'platform',
  'model',
  'region',
  'runs',
  'brand_score',
  'competitor_score',
  'difference',
  'latest_at',
];

function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function CompetitorsPage() {
  const t = useTranslations('competitors');
  const common = useTranslations('common');
  const { canUse, isCloud } = useFeatureGate();
  const brand = useBrandStore((s) => s.getActiveBrand());

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [comparisonData, setComparisonData] = useState<CompetitorComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [datePreset, setDatePreset] = useState<CompetitorDatePreset>('30d');
  const tMetrics = useTranslations('metrics');
  // The picker's range in words, for the counts it scopes (UX audit CP-03).
  const periodWords =
    datePreset === 'all'
      ? tMetrics('period.all')
      : datePreset === 'custom'
        ? tMetrics('period.custom')
        : tMetrics('period.lastDays', { days: { '7d': 7, '30d': 30, '90d': 90 }[datePreset] });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateParamsReady, setDateParamsReady] = useState(false);
  const competitorsRequestId = useRef(0);
  const comparisonRequestId = useRef(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [suggestDialogOpen, setSuggestDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Competitor | null>(null);
  // Competitor types (00542): the one whose type is being set, the list's
  // filter and whether it is grouped by type.
  const [typeFor, setTypeFor] = useState<Competitor | null>(null);
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [groupByType, setGroupByType] = useState(false);
  // Merging duplicates (00543): the brand's merged competitors, the Merge
  // dialog (mounted fresh each time, with the competitors it starts from),
  // the one being unmerged and the "may be the same company" pairs put off.
  const [merged, setMerged] = useState<MergedCompetitor[]>([]);
  const [mergeDialog, setMergeDialog] = useState<{ key: number; ids: string[] } | null>(null);
  const [unmergeFor, setUnmergeFor] = useState<MergedCompetitor | null>(null);
  const [hintsPutOff, setHintsPutOff] = useState<string[]>([]);
  // A read-only workspace (plan not active): Add, Suggest (it asks the AI as
  // it opens) and Delete open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Admins and managers add and remove competitors; others only read them.
  const { canManage } = useUserRole();
  const openAdd = guard(() => setDialogOpen(true), { action: tActions('addCompetitors') });
  const openSuggest = guard(() => setSuggestDialogOpen(true), {
    action: tActions('suggestCompetitors'),
  });

  // Head-to-head
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);
  // ?competitor=<id> (#893): the head-to-head selection survives a refresh and
  // can be linked to, e.g. from the Insights leaderboard. Read after mount;
  // applied once the brand's competitors are known, so an unknown id is ignored.
  const [linkedCompetitorId, setLinkedCompetitorId] = useState<string | null>(null);

  useEffect(() => {
    setLinkedCompetitorId(readUrlParam('competitor') || null);
    setDatePreset(readUrlChoice('preset', COMPETITOR_DATE_PRESETS, '30d'));
    setDateFrom(readUrlParam('from'));
    setDateTo(readUrlParam('to'));
    setDateParamsReady(true);
  }, []);

  useEffect(() => {
    if (!dateParamsReady) return;
    writeUrlParams({ preset: datePreset, from: dateFrom, to: dateTo }, { preset: '30d' });
  }, [dateParamsReady, dateFrom, datePreset, dateTo]);

  const selectCompetitor = useCallback((id: string | null) => {
    setSelectedCompetitorId(id);
    writeUrlParams({ competitor: id });
  }, []);
  const [h2hData, setH2hData] = useState<HeadToHeadData | null>(null);
  const [h2hLoading, setH2hLoading] = useState(false);
  // The selected competitor's pages over time (learning C3), kept with whose they are.
  const [timeline, setTimeline] = useState<{
    competitorId: string;
    data: CompetitorTimeline | 'failed';
  } | null>(null);

  const loadCompetitors = useCallback(async () => {
    if (!brand) return;
    const requestId = ++competitorsRequestId.current;
    setLoading(true);
    try {
      const [comps, mergedComps] = await Promise.all([
        getCompetitors(brand.id),
        // The Merged competitors list and the cards' other names; the page works without them.
        getMergedCompetitors(brand.id).catch(() => [] as MergedCompetitor[]),
      ]);
      if (requestId !== competitorsRequestId.current) return;
      setCompetitors(comps);
      setMerged(mergedComps);
    } catch {
      if (requestId === competitorsRequestId.current) toast.error(t('loadError'));
    } finally {
      if (requestId === competitorsRequestId.current) setLoading(false);
    }
  }, [brand, t]);

  const loadComparison = useCallback(async () => {
    const requestId = ++comparisonRequestId.current;
    if (!brand || !dateParamsReady) return;

    // Custom is not a query until both bounds are selected. Keep the previous
    // comparison visible rather than accidentally turning an incomplete range
    // into an unbounded all-time read.
    if (datePreset === 'custom' && (!dateFrom || !dateTo)) {
      setComparisonLoading(false);
      return;
    }

    setComparisonLoading(true);
    try {
      const comparison = await getCompetitorComparison(
        brand.id,
        competitorComparisonWindow(datePreset, { from: dateFrom, to: dateTo }),
      );
      if (requestId !== comparisonRequestId.current) return;
      setComparisonData(comparison.brands.length > 1 ? comparison : null);
    } catch {
      if (requestId === comparisonRequestId.current) toast.error(t('loadError'));
    } finally {
      if (requestId === comparisonRequestId.current) setComparisonLoading(false);
    }
  }, [brand, dateFrom, dateParamsReady, datePreset, dateTo, t]);

  useEffect(() => {
    loadCompetitors();
  }, [loadCompetitors]);

  useEffect(() => {
    loadComparison();
  }, [loadComparison]);

  useEffect(() => {
    if (!linkedCompetitorId || loading) return;
    selectCompetitor(
      competitors.some((c) => c.id === linkedCompetitorId) ? linkedCompetitorId : null,
    );
    setLinkedCompetitorId(null);
  }, [linkedCompetitorId, loading, competitors, selectCompetitor]);

  // Load head-to-head when a competitor is selected, over the picker's days as
  // the cards above (UX audit CP-02); again when the range changes.
  const h2hRequestId = useRef(0);
  const loadH2H = useCallback(
    async (competitorId: string) => {
      const requestId = ++h2hRequestId.current;
      if (!brand || !dateParamsReady) return;
      // An incomplete custom range is not a query yet: the last one stays.
      if (datePreset === 'custom' && (!dateFrom || !dateTo)) return;
      setH2hLoading(true);
      setH2hData(null);
      try {
        const { days } = competitorComparisonWindow(datePreset, { from: dateFrom, to: dateTo });
        const data = await getHeadToHeadComparison(brand.id, competitorId, days);
        if (requestId === h2hRequestId.current) setH2hData(data);
      } catch {
        if (requestId === h2hRequestId.current) toast.error(t('h2h.loadError'));
      } finally {
        if (requestId === h2hRequestId.current) setH2hLoading(false);
      }
    },
    [brand, dateFrom, dateParamsReady, datePreset, dateTo, t],
  );

  useEffect(() => {
    if (selectedCompetitorId) {
      loadH2H(selectedCompetitorId);
    } else {
      setH2hData(null);
    }
  }, [selectedCompetitorId, loadH2H]);

  useEffect(() => {
    if (!brand || !selectedCompetitorId) return;
    let cancelled = false;
    const competitorId = selectedCompetitorId;
    getCompetitorTimeline(brand.id, competitorId).then(
      (data) => {
        if (!cancelled) setTimeline({ competitorId, data });
      },
      (err) => {
        console.error('Failed to load the competitor timeline:', err);
        if (!cancelled) setTimeline({ competitorId, data: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [brand, selectedCompetitorId]);

  const loadRuns = useCallback(
    (group: HeadToHeadGroup, limit: number) => {
      if (!brand || !selectedCompetitorId) return Promise.resolve([]);
      const { dateFrom: from, dateTo: to } = competitorComparisonWindow(datePreset, {
        from: dateFrom,
        to: dateTo,
      });
      return getHeadToHeadRuns(
        brand.id,
        selectedCompetitorId,
        {
          promptId: group.promptId,
          rawPlatform: group.rawPlatform,
          rawModelUsed: group.rawModelUsed,
          region: group.region ?? null,
        },
        limit,
        { dateFrom: from, dateTo: to },
      );
    },
    [brand, dateFrom, datePreset, dateTo, selectedCompetitorId],
  );

  // Chat's side panel sees the page (the owner's plan of 2026-11-16, step 9): its period, the
  // competitors listed by id with their domains, and the one open for the head-to-head (its id
  // is in the URL, ?competitor=; its name comes with it).
  const tChatRange = useTranslations('chatPanel.range');
  const openCompetitor = competitors.find((c) => c.id === selectedCompetitorId) ?? null;
  useChatPageContext(
    brand
      ? {
          pageName: t('title'),
          dateRange: {
            from: datePreset === 'custom' ? dateFrom : datePreset,
            to: datePreset === 'custom' ? dateTo : null,
            label: rangeChipLabel(datePreset, { from: dateFrom, to: dateTo }, (key, values) =>
              tChatRange(key, values),
            ),
          },
          view: {
            ...(loading
              ? {}
              : {
                  rows: viewRows(competitors, (c) => ({
                    ref: c.id,
                    label: c.domain ? `${c.name} (${c.domain})` : c.name,
                  })),
                  total: competitors.length,
                }),
            ...(openCompetitor
              ? { open: { ref: openCompetitor.id, label: openCompetitor.name } }
              : {}),
          },
        }
      : null,
  );

  if (isCloud && !canUse('competitor_tracking')) {
    return <PlanGateOverlay />;
  }

  if (!brand) return <NoBrandSelected />;

  // Build score map from comparison data. The headline number is the AI
  // Visibility Score — the same metric as the Insights leaderboard — with
  // coverage kept for the sub-line and components in the tooltip.
  const scoreMap = new Map<string, CardStats>();
  // The brand's own numbers, for its card among them (UX audit CP-06).
  let ownStats: CardStats | null = null;
  if (comparisonData) {
    for (const entry of comparisonData.brands) {
      const stats: CardStats = {
        score: entry.score,
        mentionAnswers: entry.mentionAnswers,
        citationAnswers: entry.citationAnswers,
        positionFactor: entry.positionFactor,
        visiblePrompts: entry.visiblePrompts,
        promptCount: entry.promptCount,
        mentions: entry.totalMentions,
        citations: entry.totalCitations,
      };
      if (entry.isOwnBrand) ownStats = stats;
      else scoreMap.set(entry.name, stats);
    }
  }

  async function handleAdd(name: string, domain: string, type: string | null) {
    if (!brand) return;
    // One merged into another (00543) already counts there: never a second copy.
    const alias = mergedMatch({ name, domain }, merged);
    if (alias) {
      toast.info(
        t('merge.addMerged', {
          name: alias.name,
          kept: alias.mergedIntoName || t('merged.anotherCompetitor'),
        }),
      );
      return;
    }
    await addCompetitor(brand.id, { name, domain, type });
    toast.success(t('addSuccess'));
    void loadCompetitors();
    void loadComparison();
  }

  async function handleAddSuggested(
    suggestions: SuggestedCompetitor[],
  ): Promise<{ added: number; failed: number }> {
    if (!brand) return { added: 0, failed: suggestions.length };

    const results = await Promise.allSettled(
      suggestions.map((suggestion) =>
        addCompetitor(brand.id, { name: suggestion.name, domain: suggestion.domain }),
      ),
    );
    const added = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - added;

    if (added > 0) {
      // Refresh in place rather than toggling the page-wide initial loader:
      // the suggestion dialog should remain open when some inserts fail.
      try {
        const comparisonPromise =
          datePreset === 'custom' && (!dateFrom || !dateTo)
            ? Promise.resolve(null)
            : getCompetitorComparison(
                brand.id,
                competitorComparisonWindow(datePreset, { from: dateFrom, to: dateTo }),
              );
        const [currentCompetitors, comparison] = await Promise.all([
          getCompetitors(brand.id),
          comparisonPromise,
        ]);
        setCompetitors(currentCompetitors);
        if (comparison) {
          setComparisonData(comparison.brands.length > 1 ? comparison : null);
        }
      } catch {
        toast.error(t('loadError'));
      }
    }
    return { added, failed };
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteCompetitor(id);
      toast.success(t('deleteSuccess'));
      if (selectedCompetitorId === id) {
        selectCompetitor(null);
      }
      void loadCompetitors();
      void loadComparison();
    } catch {
      toast.error(t('deleteError'));
    } finally {
      setDeleting(null);
    }
  }

  const selectedCompetitor = competitors.find((c) => c.id === selectedCompetitorId);
  const today = new Date().toISOString().slice(0, 10);

  // Types: offered in the pickers, and the list's filter and groups once any
  // competitor has one. A brand that never sets one sees the list as before.
  const typeOptions = competitorTypeOptions(competitors);
  const anyTyped = competitors.some((c) => c.type);
  // The filter offers the types the brand's competitors have, and No type
  // while some have none; a type no competitor has any more falls back to all.
  const typeFilterItems = [
    { value: ALL_TYPES, label: t('type.filterAll') },
    ...typeOptions
      .filter((type) => competitors.some((c) => c.type === type))
      .map((type) => ({ value: type, label: competitorTypeLabel(type) ?? type })),
    ...(competitors.some((c) => !c.type)
      ? [{ value: NO_COMPETITOR_TYPE, label: t('type.none') }]
      : []),
  ];
  const activeTypeFilter =
    anyTyped && typeFilterItems.some((item) => item.value === typeFilter) ? typeFilter : ALL_TYPES;
  const listedCompetitors = competitors.filter((c) =>
    matchesCompetitorType(c.type, activeTypeFilter === ALL_TYPES ? '' : activeTypeFilter),
  );
  const typeOf = (competitorId: string | undefined) =>
    competitors.find((c) => c.id === competitorId)?.type ?? null;

  // Merging (00543): each kept competitor's other names, and the first pair
  // that may be one company, for admins and managers, unless put off.
  const aliasesOf = (competitorId: string): CompetitorAlias[] =>
    merged.filter((m) => m.mergedIntoId === competitorId);
  const hint = canManage
    ? (likelyDuplicates(competitors).find((pair) => !hintsPutOff.includes(pair.join(' '))) ?? null)
    : null;
  const nameOf = (competitorId: string) =>
    competitors.find((c) => c.id === competitorId)?.name ?? '';
  const openMerge = guard(
    (ids: string[] = []) => setMergeDialog((prev) => ({ key: (prev?.key ?? 0) + 1, ids })),
    { action: tActions('mergeCompetitors') },
  );
  const openUnmerge = guard((competitor: MergedCompetitor) => setUnmergeFor(competitor), {
    action: tActions('unmergeCompetitors'),
  });

  async function handleMerged(keptId: string, mergedIds: string[]) {
    if (selectedCompetitorId && mergedIds.includes(selectedCompetitorId)) selectCompetitor(keptId);
    await loadCompetitors();
    void loadComparison();
  }

  async function exportBenchmark() {
    if (!brand || !comparisonData?.brands.length) return;
    const rows = comparisonData.brands.map((e) => ({
      name: e.name,
      is_own_brand: e.isOwnBrand,
      type: e.isOwnBrand ? '' : (competitorTypeLabel(typeOf(e.competitorId)) ?? ''),
      visibility_score: e.score ?? '',
      visible_prompts: e.visiblePrompts,
      prompt_count: e.promptCount,
      mention_answers: e.mentionAnswers,
      citation_answers: e.citationAnswers,
      mentions: e.totalMentions,
      citations: e.totalCitations,
    }));
    downloadCsv(
      toCsv(rows, BENCHMARK_EXPORT_HEADERS),
      await exportFileName(`${brand.slug}_competitors_${today}.csv`),
    );
  }

  async function exportHeadToHead() {
    if (!brand || !h2hData?.groups.length || !selectedCompetitor) return;
    const rows = h2hData.groups.map((g) => ({
      prompt: g.promptText,
      platform: g.platform,
      model: g.modelUsed,
      region: g.region ?? '',
      runs: g.runs,
      brand_score: g.brandScore,
      competitor_score: g.competitorScore,
      difference: g.diff,
      latest_at: g.latestAt,
    }));
    downloadCsv(
      toCsv(rows, HEAD_TO_HEAD_EXPORT_HEADERS),
      await exportFileName(
        `${brand.slug}_head-to-head_${slugify(selectedCompetitor.name)}_${today}.csv`,
      ),
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <HeaderWithAiUsage>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('description')}</p>
          </div>
        </HeaderWithAiUsage>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header as on Visibility (UX audit CP-11): the title and the page's buttons on
          its row, the meter and Ask Chat at its end; the date range on its own row under it. */}
      <HeaderWithAiUsage>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('description')}</p>
          </div>
          {canManage && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" className="gap-2" onClick={openSuggest}>
                <Sparkles className="h-4 w-4" />
                {t('suggestCompetitors')}
              </Button>
              <Button className="gap-2" onClick={openAdd}>
                <Plus className="h-4 w-4" />
                {t('addCompetitor')}
              </Button>
            </div>
          )}
        </div>
      </HeaderWithAiUsage>
      <div data-slot="competitors-filters" className="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          value={datePreset}
          presets={COMPETITOR_DATE_PRESETS}
          onChange={setDatePreset}
          from={dateFrom}
          to={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
        />
        {comparisonLoading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      {competitors.length === 0 ? (
        <EmptyState
          onAdd={canManage ? openAdd : undefined}
          onSuggest={canManage ? openSuggest : undefined}
        />
      ) : (
        <>
          {/* Competitor List */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" />
                  {t('trackedCompetitors')}
                  <Badge variant="secondary" className="text-xs">
                    {competitors.length}
                  </Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                  {canManage && competitors.length >= 2 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      title={t('merge.openHint')}
                      onClick={() => openMerge()}
                    >
                      <Merge className="h-4 w-4" />
                      {t('merge.open')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={exportBenchmark}
                    disabled={!comparisonData?.brands.length}
                  >
                    <Download className="h-4 w-4" />
                    {common('exportCsv')}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('selectToCompare')}{' '}
                {/* The range the cards and the head-to-head read (UX audit CP-08). */}
                {datePreset === 'all'
                  ? t('windowAllTime')
                  : datePreset === 'custom'
                    ? t('windowSelectedRange')
                    : t('windowLastDays', { days: PRESET_DAYS[datePreset] })}
              </p>
              {hint && (
                <DuplicateHint
                  a={nameOf(hint[0])}
                  b={nameOf(hint[1])}
                  onMerge={() => openMerge([...hint])}
                  onDismiss={() => setHintsPutOff((prev) => [...prev, hint.join(' ')])}
                />
              )}
              {anyTyped && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Select
                    items={typeFilterItems}
                    value={activeTypeFilter}
                    onValueChange={(next: string | null) => setTypeFilter(next ?? ALL_TYPES)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full text-xs sm:w-56"
                      aria-label={t('type.filterLabel')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {typeFilterItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant={groupByType ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    aria-pressed={groupByType}
                    onClick={() => setGroupByType((on) => !on)}
                  >
                    <Tag className="h-3.5 w-3.5" />
                    {t('type.groupByType')}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {listedCompetitors.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t('type.noneOfType')}
                </p>
              ) : (
                <div className="space-y-4">
                  {(groupByType && anyTyped
                    ? groupCompetitorsByType(listedCompetitors)
                    : [{ type: undefined, items: listedCompetitors }]
                  ).map((group) => (
                    <section
                      key={group.type === undefined ? ' all' : (group.type ?? ' none')}
                      className="space-y-2"
                      aria-label={
                        group.type === undefined
                          ? undefined
                          : (competitorTypeLabel(group.type) ?? t('type.none'))
                      }
                    >
                      {group.type !== undefined && (
                        <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          {competitorTypeLabel(group.type) ?? t('type.none')}
                          <span className="tabular-nums">
                            {t('type.groupCount', { count: group.items.length })}
                          </span>
                        </h3>
                      )}
                      {/* By Visibility score, You in its place, each ranked (UX audit CP-06). */}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {rankWithYou(
                          group.items,
                          (comp) => scoreMap.get(comp.name) ?? null,
                          (comp) => comp.name,
                          ownStats,
                        ).map(({ item: comp, rank, lowSample }) =>
                          comp === null ? (
                            <YouCard
                              key=" you"
                              name={brand.name}
                              stats={ownStats}
                              rank={rank}
                              lowSample={lowSample}
                              period={periodWords}
                            />
                          ) : (
                            <CompetitorCard
                              key={comp.id}
                              rank={rank}
                              lowSample={lowSample}
                              period={periodWords}
                              competitor={comp}
                              aliases={aliasesOf(comp.id)}
                              stats={scoreMap.get(comp.name) ?? null}
                              isSelected={selectedCompetitorId === comp.id}
                              onSelect={() =>
                                selectCompetitor(selectedCompetitorId === comp.id ? null : comp.id)
                              }
                              onSetType={
                                canManage
                                  ? guard(() => setTypeFor(comp), {
                                      action: tActions('setCompetitorTypes'),
                                    })
                                  : undefined
                              }
                              onDelete={
                                canManage
                                  ? guard(() => setConfirmDelete(comp), {
                                      action: tActions('deleteCompetitors'),
                                    })
                                  : undefined
                              }
                              deleting={deleting === comp.id}
                            />
                          ),
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              )}
              {merged.length > 0 && (
                <div className="mt-4">
                  <MergedCompetitorsSection
                    merged={merged}
                    onUnmerge={canManage ? openUnmerge : undefined}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Head-to-Head Section */}
          {selectedCompetitorId && (
            <>
              <div className="flex items-center gap-2 pt-2">
                <Swords className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  {t('h2h.title', {
                    brand: brand.name,
                    competitor: selectedCompetitor?.name ?? '',
                  })}
                </h2>
                <CompetitorTypeBadge type={selectedCompetitor?.type} />
                <Button
                  variant="outline"
                  size="sm"
                  className="ms-auto gap-2"
                  onClick={exportHeadToHead}
                  disabled={h2hLoading || !h2hData?.groups.length}
                >
                  <Download className="h-4 w-4" />
                  {common('exportCsv')}
                </Button>
              </div>

              {h2hLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : h2hData && h2hData.groups.length > 0 ? (
                <HeadToHeadSection
                  data={h2hData}
                  brandName={brand.name}
                  competitorName={selectedCompetitor?.name ?? ''}
                  loadRuns={loadRuns}
                />
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <Swords className="h-8 w-8 text-muted-foreground mb-3" />
                    <h3 className="text-sm font-semibold">{t('h2h.noDataTitle')}</h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      {t('h2h.noDataDescription')}
                    </p>
                  </CardContent>
                </Card>
              )}

              <CompetitorTimelineCard
                timeline={timeline?.competitorId === selectedCompetitorId ? timeline.data : null}
                brandName={brand.name}
                competitorName={selectedCompetitor?.name ?? ''}
              />
            </>
          )}
        </>
      )}

      <AddCompetitorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={handleAdd}
        typeOptions={typeOptions}
      />

      <SetCompetitorTypeDialog
        brandId={brand.id}
        competitor={typeFor}
        options={typeOptions}
        onOpenChange={(open) => {
          if (!open) setTypeFor(null);
        }}
        onSaved={(changed) =>
          setCompetitors((prev) => prev.map((c) => changed.find((next) => next.id === c.id) ?? c))
        }
      />

      <SuggestCompetitorsDialog
        open={suggestDialogOpen}
        onOpenChange={setSuggestDialogOpen}
        brand={brand}
        existingCompetitors={[
          ...competitors,
          // Merged ones (00543) aren't suggested again: they count for the one kept.
          ...merged.map((m) => ({
            id: m.id,
            brandId: brand.id,
            name: m.name,
            domain: m.domain,
            type: m.type,
          })),
        ]}
        onAddSelected={handleAddSuggested}
      />

      {mergeDialog && (
        <MergeCompetitorsDialog
          key={mergeDialog.key}
          brandId={brand.id}
          competitors={competitors}
          initialIds={mergeDialog.ids}
          open
          onOpenChange={(open) => {
            if (!open) setMergeDialog(null);
          }}
          onMerged={handleMerged}
        />
      )}

      <UnmergeCompetitorDialog
        brandId={brand.id}
        competitor={unmergeFor}
        onOpenChange={(open) => {
          if (!open) setUnmergeFor(null);
        }}
        onUnmerged={() => {
          void loadCompetitors();
          void loadComparison();
        }}
      />

      <ConfirmDeleteCompetitorDialog
        competitor={confirmDelete}
        mergedCount={confirmDelete ? aliasesOf(confirmDelete.id).length : 0}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        onConfirm={async () => {
          if (!confirmDelete) return;
          const id = confirmDelete.id;
          setConfirmDelete(null);
          await handleDelete(id);
        }}
        deleting={confirmDelete !== null && deleting === confirmDelete.id}
      />
    </div>
  );
}

function ConfirmDeleteCompetitorDialog({
  competitor,
  mergedCount = 0,
  onOpenChange,
  onConfirm,
  deleting,
}: {
  competitor: Competitor | null;
  /** How many competitors are merged into it (00543): removed with it. */
  mergedCount?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  const t = useTranslations('competitors');
  const name = competitor?.name ?? '';

  return (
    <Dialog open={competitor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            {t('confirmDeleteTitle', { name })}
          </DialogTitle>
          <DialogDescription>
            {t('confirmDeleteDescription', { name })}
            {mergedCount > 0 && <> {t('merge.deleteNote', { count: mergedCount })}</>}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            <Trash2 className="me-1.5 h-4 w-4" />
            {t('confirmDeleteAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
