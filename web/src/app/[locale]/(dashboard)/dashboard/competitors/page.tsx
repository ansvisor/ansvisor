'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { getCompetitors, addCompetitor, deleteCompetitor } from '@/lib/actions/competitor';
import {
  getCompetitorComparison,
  getHeadToHeadComparison,
  type CompetitorComparisonData,
  type HeadToHeadData,
  type HeadToHeadPromptRow,
} from '@/lib/actions/tracking';
import { getFaviconUrl } from '@/lib/favicon';
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
import { AIProviderAvatar, resolveAIProvider } from '@/components/ai-provider-avatar';
import {
  Plus,
  Trash2,
  Loader2,
  Users,
  Globe,
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
  HelpCircle,
} from 'lucide-react';

// ─── Shared Visual Components (mirroring Insights) ───────────────────────────

const MODEL_DISPLAY_NAME: Record<string, string> = {
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-5-chat-latest': 'ChatGPT',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-opus-4-6': 'Claude Opus',
  'claude-haiku-4-5': 'Claude Haiku',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'grok-3': 'Grok',
  'grok-4-auto': 'Grok',
  'chatgpt-web': 'ChatGPT',
  'perplexity-web': 'Perplexity',
  'google-aio': 'Google AI Overview',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'gemini-web': 'Gemini',
};

function getModelDisplayName(model: string, platform?: string): string {
  // In h2h data, platform is already resolved (e.g. "ChatGPT", "Perplexity")
  // so use it directly if available
  if (platform) {
    const modelName = MODEL_DISPLAY_NAME[model];
    return modelName && modelName !== platform ? `${platform} · ${modelName}` : platform;
  }
  return MODEL_DISPLAY_NAME[model] ?? model;
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

function VisibilityBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            score >= 60 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-medium tabular-nums">{Math.round(score)}</span>
    </div>
  );
}

function InfoTip({ content }: { content: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        className="inline-flex items-center cursor-help"
      >
        <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
      </span>
      {pos &&
        createPortal(
          <div
            style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
            className="pointer-events-none fixed z-[9999] w-56 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

function ColHead({
  children,
  tooltip,
  className,
}: {
  children: React.ReactNode;
  tooltip?: string;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
        {children}
        {tooltip && <InfoTip content={tooltip} />}
      </span>
    </TableHead>
  );
}

// ─── Plan Gate ────────────────────────────────────────────────────────────────

function PlanGateOverlay() {
  const t = useTranslations('competitors');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
            <Crown className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold">{t('upgradeTitle')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('upgradeDescription')}</p>
          <Badge variant="outline" className="mt-4">
            <Crown className="mr-1 h-3 w-3" />
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations('competitors');
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white mb-4">
          <Users className="h-7 w-7 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{t('emptyTitle')}</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('emptyDescription')}</p>
        <Button className="mt-6 gap-2" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          {t('addCompetitor')}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Add Dialog ───────────────────────────────────────────────────────────────

function AddCompetitorDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, domain: string) => Promise<void>;
}) {
  const t = useTranslations('competitors');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setName('');
    setDomain('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onAdd(name.trim(), domain.trim());
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

function CompetitorCard({
  competitor,
  stats,
  isSelected,
  onSelect,
  onDelete,
  deleting,
}: {
  competitor: Competitor;
  stats: { avg: number; mentions: number; citations: number } | null;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
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
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        {competitor.domain ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={getFaviconUrl(competitor.domain)}
            alt=""
            className="h-5 w-5 rounded-sm"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.style.display = 'none';
              el.parentElement!.innerHTML =
                '<svg class="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" /></svg>';
            }}
          />
        ) : (
          <Globe className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{competitor.name}</span>
          {isSelected && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {t('selected')}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate block">
          {competitor.domain || '—'}
        </span>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {stats ? (
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums">{stats.avg}%</div>
            <div className="text-[10px] text-muted-foreground">
              {stats.mentions}m · {stats.citations}c
            </div>
          </div>
        ) : (
          <div className="text-right">
            <span className="text-xs text-muted-foreground">{t('noData')}</span>
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label={t('delete')}
          title={t('delete')}
          className="h-7 w-7 opacity-0 group-hover:opacity-70 hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity"
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
      </div>
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('h2h.platformBreakdown')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.platformRows.map((row) => {
            const max = Math.max(row.brandScore, row.competitorScore, 1);
            return (
              <div key={row.platform} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{row.platform}</span>
                  <DiffBadge diff={row.diff} />
                </div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 flex gap-1">
                    <div
                      className="h-2 rounded-full bg-blue-500 dark:bg-blue-400 transition-all"
                      style={{ width: `${(row.brandScore / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums w-8 text-right font-medium">
                    {row.brandScore}%
                  </span>
                </div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 flex gap-1">
                    <div
                      className="h-2 rounded-full bg-orange-400 dark:bg-orange-500 transition-all"
                      style={{ width: `${(row.competitorScore / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums w-8 text-right font-medium">
                    {row.competitorScore}%
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
      </CardContent>
    </Card>
  );
}

// ─── Head-to-Head: Grouped Prompt Comparison ─────────────────────────────────

interface PromptComparisonGroup {
  promptId: string;
  promptText: string;
  promptCategory?: string;
  rows: HeadToHeadData['promptRows'];
  avgBrandScore: number;
  avgCompetitorScore: number;
  avgDiff: number;
}

function groupH2HByPrompt(rows: HeadToHeadData['promptRows']): PromptComparisonGroup[] {
  const map = new Map<string, HeadToHeadData['promptRows']>();
  for (const r of rows) {
    const arr = map.get(r.promptId) || [];
    arr.push(r);
    map.set(r.promptId, arr);
  }
  return Array.from(map.entries()).map(([promptId, items]) => {
    const avgB = Math.round(items.reduce((s, r) => s + r.brandScore, 0) / items.length);
    const avgC = Math.round(items.reduce((s, r) => s + r.competitorScore, 0) / items.length);
    return {
      promptId,
      promptText: items[0].promptText,
      promptCategory: items[0].promptCategory,
      rows: items,
      avgBrandScore: avgB,
      avgCompetitorScore: avgC,
      avgDiff: avgB - avgC,
    };
  });
}

interface ModelComparisonGroup {
  key: string;
  platform: string;
  modelUsed: string;
  region?: string;
  rows: HeadToHeadPromptRow[];
  latest: HeadToHeadPromptRow;
  avgBrandScore: number;
  avgCompetitorScore: number;
  avgDiff: number;
}

function groupH2HByModel(rows: HeadToHeadPromptRow[]): ModelComparisonGroup[] {
  const map = new Map<string, HeadToHeadPromptRow[]>();
  for (const r of rows) {
    const key = `${r.platform}|${r.modelUsed ?? ''}|${r.region ?? ''}`;
    const arr = map.get(key) || [];
    arr.push(r);
    map.set(key, arr);
  }

  return Array.from(map.entries())
    .map(([key, items]) => {
      const sorted = [...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const latest = sorted[0];
      const avgB = Math.round(sorted.reduce((s, r) => s + r.brandScore, 0) / sorted.length);
      const avgC = Math.round(sorted.reduce((s, r) => s + r.competitorScore, 0) / sorted.length);
      return {
        key,
        platform: latest.platform,
        modelUsed: latest.modelUsed,
        region: latest.region,
        rows: sorted,
        latest,
        avgBrandScore: avgB,
        avgCompetitorScore: avgC,
        avgDiff: avgB - avgC,
      } satisfies ModelComparisonGroup;
    })
    .sort((a, b) => b.avgBrandScore - a.avgBrandScore);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function ModelSubGroup({
  group,
  expanded,
  onToggle,
  onViewRow,
  brandName,
  competitorName,
}: {
  group: ModelComparisonGroup;
  expanded: boolean;
  onToggle: () => void;
  onViewRow: (row: HeadToHeadPromptRow) => void;
  brandName: string;
  competitorName: string;
}) {
  const t = useTranslations('competitors');
  const hasHistory = group.rows.length > 1;

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
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <ModelBadge model={group.modelUsed || group.platform} platform={group.platform} />
          {group.region && (
            <Badge variant="outline" className="text-[10px]">
              {group.region}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground tabular-nums ml-1">
            {group.rows.length} run{group.rows.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">{t('h2h.you')}</p>
            <p className="text-xs font-semibold tabular-nums">{group.avgBrandScore}%</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">{t('h2h.them')}</p>
            <p className="text-xs font-semibold tabular-nums">{group.avgCompetitorScore}%</p>
          </div>
          <div className="text-right min-w-[48px]">
            <p className="text-[10px] text-muted-foreground">{t('h2h.diff')}</p>
            <DiffBadge diff={group.avgDiff} />
          </div>
          <SentimentBadge sentiment={group.latest.sentiment} />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="View latest AI response"
            onClick={(e) => {
              e.stopPropagation();
              onViewRow(group.latest);
            }}
            aria-label="View latest AI response"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && hasHistory && (
        <div className="border-t bg-muted/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
            Previous runs
          </p>
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
              {group.rows.map((row) => (
                <TableRow key={row.resultId} className="hover:bg-muted/30">
                  <TableCell className="text-xs text-muted-foreground py-1.5">
                    {formatTimestamp(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-center py-1.5 text-xs font-semibold tabular-nums">
                    {Math.round(row.brandScore)}%
                  </TableCell>
                  <TableCell className="text-center py-1.5 text-xs font-semibold tabular-nums">
                    {Math.round(row.competitorScore)}%
                  </TableCell>
                  <TableCell className="text-center py-1.5">
                    <DiffBadge diff={Math.round(row.brandScore - row.competitorScore)} />
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
                        onViewRow(row);
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
        </div>
      )}
    </div>
  );
}

function PromptComparisonGrouped({
  rows,
  brandName,
  competitorName,
  onViewRow,
}: {
  rows: HeadToHeadData['promptRows'];
  brandName: string;
  competitorName: string;
  onViewRow: (row: HeadToHeadPromptRow) => void;
}) {
  const t = useTranslations('competitors');
  const groups = groupH2HByPrompt(rows);
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

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t('h2h.noPromptData')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isOpen = expanded.has(group.promptId);
        const modelGroups = groupH2HByModel(group.rows);
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
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors cursor-pointer select-none"
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
                    {modelGroups.length} platform
                    {modelGroups.length !== 1 ? 's' : ''} · {group.rows.length} result
                    {group.rows.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.you')}</p>
                  <p className="text-sm font-semibold tabular-nums">{group.avgBrandScore}%</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.them')}</p>
                  <p className="text-sm font-semibold tabular-nums">{group.avgCompetitorScore}%</p>
                </div>
                <div className="text-right min-w-[48px]">
                  <p className="text-[10px] text-muted-foreground">{t('h2h.diff')}</p>
                  <DiffBadge diff={group.avgDiff} />
                </div>
              </div>
            </div>

            {/* Platform/Model sub-groups */}
            {isOpen && (
              <div className="border-t px-3 py-2 space-y-1.5 bg-muted/10">
                {modelGroups.map((mg) => {
                  const compositeKey = `${group.promptId}::${mg.key}`;
                  return (
                    <ModelSubGroup
                      key={compositeKey}
                      group={mg}
                      expanded={expandedModels.has(compositeKey)}
                      onToggle={() => toggleModel(compositeKey)}
                      onViewRow={onViewRow}
                      brandName={brandName}
                      competitorName={competitorName}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Gap / Strength Cards ─────────────────────────────────────────────────────

interface GapStrengthGroup {
  promptId: string;
  promptText: string;
  items: HeadToHeadData['gaps'];
  avgBrandScore: number;
  avgCompetitorScore: number;
  avgDiff: number;
}

function groupGapStrengthByPrompt(items: HeadToHeadData['gaps']): GapStrengthGroup[] {
  const map = new Map<string, HeadToHeadData['gaps']>();
  for (const item of items) {
    const arr = map.get(item.promptId) || [];
    arr.push(item);
    map.set(item.promptId, arr);
  }
  return Array.from(map.entries())
    .map(([promptId, groupItems]) => {
      const avgB = Math.round(groupItems.reduce((s, r) => s + r.brandScore, 0) / groupItems.length);
      const avgC = Math.round(
        groupItems.reduce((s, r) => s + r.competitorScore, 0) / groupItems.length,
      );
      return {
        promptId,
        promptText: groupItems[0].promptText,
        items: groupItems,
        avgBrandScore: avgB,
        avgCompetitorScore: avgC,
        avgDiff: avgB - avgC,
      };
    })
    .sort((a, b) => a.avgDiff - b.avgDiff);
}

function GapStrengthList({
  items,
  type,
}: {
  items: HeadToHeadData['gaps'];
  type: 'gap' | 'strength';
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
                    {t('h2h.you')}: {group.avgBrandScore}%
                  </span>
                  <span>
                    {t('h2h.them')}: {group.avgCompetitorScore}%
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
                  {!hasMultiple && group.items[0].createdAt && (
                    <span className="text-muted-foreground">
                      {new Date(group.items[0].createdAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </div>
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
                      {t('h2h.you')}: {Math.round(item.brandScore)}%
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('h2h.them')}: {Math.round(item.competitorScore)}%
                    </span>
                    {item.createdAt && (
                      <span className="text-muted-foreground whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleDateString(undefined, {
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
}: {
  data: HeadToHeadData;
  brandName: string;
  competitorName: string;
}) {
  const t = useTranslations('competitors');
  const router = useRouter();
  const overallDiff = data.brandAvg - data.competitorAvg;

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
            <div className="text-2xl font-bold tabular-nums">{data.brandAvg}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Swords className="h-3.5 w-3.5" />
              {t('h2h.theirAvg')}
            </div>
            <div className="text-2xl font-bold tabular-nums">{data.competitorAvg}%</div>
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
              {overallDiff}%
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
                <GapStrengthList items={data.gaps} type="gap" />
              </TabsContent>
              <TabsContent value="strengths">
                <GapStrengthList items={data.strengths} type="strength" />
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
            rows={data.promptRows}
            brandName={brandName}
            competitorName={competitorName}
            onViewRow={(row) => router.push(`/dashboard/insights/${row.resultId}`)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CompetitorsPage() {
  const t = useTranslations('competitors');
  const { canUse, isCloud } = useFeatureGate();
  const brand = useBrandStore((s) => s.getActiveBrand());

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [comparisonData, setComparisonData] = useState<CompetitorComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Competitor | null>(null);

  // Head-to-head
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);
  const [h2hData, setH2hData] = useState<HeadToHeadData | null>(null);
  const [h2hLoading, setH2hLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!brand) return;
    setLoading(true);
    try {
      const [comps, comparison] = await Promise.all([
        getCompetitors(brand.id),
        getCompetitorComparison(brand.id),
      ]);
      setCompetitors(comps);
      setComparisonData(comparison.brands.length > 1 ? comparison : null);
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [brand, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load head-to-head when a competitor is selected
  const loadH2H = useCallback(
    async (competitorId: string) => {
      if (!brand) return;
      setH2hLoading(true);
      setH2hData(null);
      try {
        const data = await getHeadToHeadComparison(brand.id, competitorId);
        setH2hData(data);
      } catch {
        toast.error(t('h2h.loadError'));
      } finally {
        setH2hLoading(false);
      }
    },
    [brand, t],
  );

  useEffect(() => {
    if (selectedCompetitorId) {
      loadH2H(selectedCompetitorId);
    } else {
      setH2hData(null);
    }
  }, [selectedCompetitorId, loadH2H]);

  if (isCloud && !canUse('competitor_tracking')) {
    return <PlanGateOverlay />;
  }

  if (!brand) return <NoBrandSelected />;

  // Build score map from comparison data
  const scoreMap = new Map<string, { avg: number; mentions: number; citations: number }>();
  if (comparisonData) {
    for (const entry of comparisonData.brands) {
      if (!entry.isOwnBrand) {
        scoreMap.set(entry.name, {
          avg: entry.avgVisibilityScore,
          mentions: entry.totalMentions,
          citations: entry.totalCitations,
        });
      }
    }
  }

  async function handleAdd(name: string, domain: string) {
    if (!brand) return;
    await addCompetitor(brand.id, { name, domain });
    toast.success(t('addSuccess'));
    loadData();
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteCompetitor(id);
      toast.success(t('deleteSuccess'));
      if (selectedCompetitorId === id) {
        setSelectedCompetitorId(null);
      }
      loadData();
    } catch {
      toast.error(t('deleteError'));
    } finally {
      setDeleting(null);
    }
  }

  const selectedCompetitor = competitors.find((c) => c.id === selectedCompetitorId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button className="gap-2" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('addCompetitor')}
        </Button>
      </div>

      {competitors.length === 0 ? (
        <EmptyState onAdd={() => setDialogOpen(true)} />
      ) : (
        <>
          {/* Competitor List */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                {t('trackedCompetitors')}
                <Badge variant="secondary" className="text-xs">
                  {competitors.length}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t('selectToCompare')}</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {competitors.map((comp) => (
                  <CompetitorCard
                    key={comp.id}
                    competitor={comp}
                    stats={scoreMap.get(comp.name) ?? null}
                    isSelected={selectedCompetitorId === comp.id}
                    onSelect={() =>
                      setSelectedCompetitorId(selectedCompetitorId === comp.id ? null : comp.id)
                    }
                    onDelete={() => setConfirmDelete(comp)}
                    deleting={deleting === comp.id}
                  />
                ))}
              </div>
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
              </div>

              {h2hLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : h2hData && h2hData.promptRows.length > 0 ? (
                <HeadToHeadSection
                  data={h2hData}
                  brandName={brand.name}
                  competitorName={selectedCompetitor?.name ?? ''}
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
            </>
          )}
        </>
      )}

      <AddCompetitorDialog open={dialogOpen} onOpenChange={setDialogOpen} onAdd={handleAdd} />

      <ConfirmDeleteCompetitorDialog
        competitor={confirmDelete}
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
  onOpenChange,
  onConfirm,
  deleting,
}: {
  competitor: Competitor | null;
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
          <DialogDescription>{t('confirmDeleteDescription', { name })}</DialogDescription>
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
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Trash2 className="mr-1.5 h-4 w-4" />
            {t('confirmDeleteAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
