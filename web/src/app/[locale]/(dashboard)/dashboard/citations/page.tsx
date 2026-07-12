'use client';

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import dynamic from 'next/dynamic';
const DynamicSourceTypeDonutChart = dynamic(
  () => import('./citations_charts').then((m) => m.SourceTypeDonutChartView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full" />,
  },
);
import {
  Quote,
  Globe,
  ExternalLink,
  Filter as FilterIcon,
  Layers,
  Loader2,
  Info,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBrandStore } from '@/stores/use-brand-store';
import { addCompetitor } from '@/lib/actions/competitor';
import {
  getCitationsOverview,
  getCitationGaps,
  type CitationsFilters,
  type CitationsOverview,
  type CitationDomainRow,
  type CitationUrlRow,
  type CitationsDatePreset,
  type CitationGaps,
  type CitationGapDomain,
} from '@/lib/actions/citations';
import { getTopics } from '@/lib/actions/topic';
import { getBrandPrompts } from '@/lib/actions/tracking';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
import type { Topic } from '@/types';
import { SOURCE_CATEGORY_LABELS, type SourceCategory } from '@/lib/citations/classify';
import { getFaviconUrl } from '@/lib/favicon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  AIProviderAvatar,
  getAIProviderDisplayName,
  resolveAIProvider,
  type AIProviderKey,
} from '@/components/ai-provider-avatar';

// ─── Constants ───────────────────────────────────────────────────────────────

const DATE_PRESETS: CitationsDatePreset[] = ['24h', '7d', '30d', '90d', 'all', 'custom'];

const CATEGORY_COLORS: Record<SourceCategory, string> = {
  you: '#6366f1',
  competitor: '#f97316',
  editorial: '#3b82f6',
  forum: '#22c55e',
  social: '#a855f7',
  review: '#eab308',
  institutional: '#14b8a6',
  other: '#94a3b8',
};

const CATEGORY_BADGE_CLASSES: Record<SourceCategory, string> = {
  you: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  competitor: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  editorial: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  forum: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
  social: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
  review: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  institutional: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  other: 'border-slate-400/30 bg-slate-400/10 text-slate-700 dark:text-slate-300',
};

// AI platform / model friendly names — kept in sync with the insights page.
const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  claude: 'Claude',
  grok: 'Grok',
  copilot: 'Copilot',
  'meta-ai': 'Meta AI',
  'google-ai-overviews': 'Google AI',
  'google-ai-mode': 'Google AI Mode',
  'chatgpt-web': 'ChatGPT',
  'google-aio': 'Google AI Overview',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'perplexity-web': 'Perplexity',
  'gemini-web': 'Google Gemini',
};

const MODEL_DISPLAY_NAME: Record<string, string> = {
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-5-chat-latest': 'ChatGPT',
  'claude-sonnet-4-6': 'Claude',
  'claude-opus-4-6': 'Claude',
  'claude-haiku-4-5': 'Claude',
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

function getPlatformDisplayLabel(slug: string): string {
  return (
    MODEL_DISPLAY_NAME[slug] ??
    PLATFORM_LABELS[slug] ??
    getAIProviderDisplayName(resolveAIProvider(slug))
  );
}

function getGroupedPlatformLabel(value: string): string {
  const firstSlug = value
    .split(',')
    .map((slug) => slug.trim())
    .find(Boolean);
  return firstSlug ? getPlatformDisplayLabel(firstSlug) : value;
}

// ─── Filter types ─────────────────────────────────────────────────────────────

interface UIFilters {
  datePreset: CitationsDatePreset;
  dateFrom: string;
  dateTo: string;
  platform: string;
  region: string;
  topic: string;
  prompt: string;
  excludeOwnDomain: boolean;
  competitorOnly: boolean;
  ownOnly: boolean;
}

interface PromptOption {
  id: string;
  text: string;
}

// base-ui's Combobox auto-uses `label` for display and `value` for selection
// when items are `{ value, label }` shaped — no extra helpers needed.
interface PromptComboboxItem {
  value: string;
  label: string;
  /** Untruncated prompt text, shown as a native tooltip on hover (#298). */
  fullText: string;
}

interface PlatformOption {
  value: string;
  label: string;
}

const DEFAULT_FILTERS: UIFilters = {
  datePreset: 'all',
  dateFrom: '',
  dateTo: '',
  platform: '',
  region: '',
  topic: '',
  prompt: '',
  excludeOwnDomain: false,
  competitorOnly: false,
  ownOnly: false,
};

function buildPlatformOptions(rows: CitationsOverview['rows']): PlatformOption[] {
  const slugToLabel = new Map<string, string>();
  for (const row of rows) {
    for (const slug of row.models) {
      if (!slug || slugToLabel.has(slug)) continue;
      slugToLabel.set(slug, getPlatformDisplayLabel(slug));
    }
  }

  const familyToSlugs = new Map<string, string[]>();
  for (const [slug, label] of slugToLabel) {
    const slugs = familyToSlugs.get(label) ?? [];
    slugs.push(slug);
    familyToSlugs.set(label, slugs);
  }

  return Array.from(familyToSlugs.entries())
    .map(([label, slugs]) => ({
      label,
      value: slugs.sort().join(','),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: SourceCategory }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-medium capitalize whitespace-nowrap',
        CATEGORY_BADGE_CLASSES[category],
      )}
    >
      {SOURCE_CATEGORY_LABELS[category]}
    </Badge>
  );
}

function ProviderDot({ provider }: { provider: AIProviderKey }) {
  return <AIProviderAvatar provider={provider} />;
}

/**
 * Collapse model identifiers down to their underlying provider so the column
 * shows at most one dot per platform (ChatGPT, Claude, Gemini, ...). There
 * are only 7 known providers, so the row width stays stable regardless of
 * how many raw models fed into the domain.
 */
function PlatformsCell({ models }: { models: string[] }) {
  if (models.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const providers = Array.from(new Set(models.map((m) => resolveAIProvider(m)))).sort();
  return (
    <div className="flex items-center gap-1">
      {providers.map((p) => (
        <ProviderDot key={p} provider={p} />
      ))}
    </div>
  );
}

function UsageBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs tabular-nums text-foreground">{pct.toFixed(1)}%</span>
    </div>
  );
}

function DomainFavicon({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded border bg-muted">
        <Globe className="h-3 w-3 text-muted-foreground" />
      </div>
    );
  }
  return (
    <Image
      src={getFaviconUrl(domain, 64)}
      alt=""
      width={20}
      height={20}
      unoptimized
      className="h-5 w-5 rounded-sm border bg-white object-contain"
      onError={() => setErrored(true)}
    />
  );
}

// ─── Donut ────────────────────────────────────────────────────────────────────

function ChartContainer({
  height,
  children,
}: {
  height: number;
  children: (width: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 && children(width)}
    </div>
  );
}

function SourceTypeDonut({
  data,
  total,
}: {
  data: { category: SourceCategory; count: number; pct: number }[];
  total: number;
}) {
  if (data.length === 0 || total === 0) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Layers className="h-8 w-8 opacity-30" />
        No citation sources yet.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    fill: CATEGORY_COLORS[d.category],
    label: SOURCE_CATEGORY_LABELS[d.category],
  }));

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer height={200}>
        {(width) => {
          return <DynamicSourceTypeDonutChart width={width} chartData={chartData} />;
        }}
      </ChartContainer>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {chartData.map((d) => (
          <li key={d.category} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: d.fill }}
              aria-hidden
            />
            <span className="truncate text-foreground">{d.label}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{d.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  topics,
  prompts,
  platforms,
  regions,
}: {
  filters: UIFilters;
  onChange: (patch: Partial<UIFilters>) => void;
  topics: Topic[];
  prompts: PromptOption[];
  platforms: PlatformOption[];
  regions: string[];
}) {
  // base-ui Combobox needs `{ value, label }` shaped items so it can use the
  // built-in filter and display logic without custom item-to-string helpers.
  // Truncate long prompt text so the dropdown stays a sensible width.
  const promptComboboxItems = useMemo<PromptComboboxItem[]>(
    () =>
      prompts.map((p) => ({
        value: p.id,
        // Let the combobox's CSS `truncate` handle visual overflow; keep the
        // full text for the hover tooltip instead of slicing it away (#298).
        label: p.text,
        fullText: p.text,
      })),
    [prompts],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Date Range</label>
        <div className="flex rounded-md border overflow-hidden">
          {DATE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange({ datePreset: p })}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                filters.datePreset === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted text-foreground',
              )}
            >
              {p === 'custom' ? 'Custom' : p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
      </div>

      {filters.datePreset === 'custom' && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">From</label>
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onChange({ dateFrom: e.target.value })}
              className="h-8 w-36 text-xs"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">To</label>
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(e) => onChange({ dateTo: e.target.value })}
              className="h-8 w-36 text-xs"
            />
          </div>
        </>
      )}

      {topics.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Topic</label>
          <Select
            value={filters.topic || null}
            onValueChange={(v) => onChange({ topic: !v || v === '__all__' ? '' : v })}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="All Topics">
                {(value) =>
                  value && value !== '__all__'
                    ? (topics.find((t) => t.id === value)?.name ?? 'All Topics')
                    : 'All Topics'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Topics</SelectItem>
              {topics.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {prompts.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Prompt</label>
          <Combobox
            items={promptComboboxItems}
            value={
              filters.prompt
                ? (promptComboboxItems.find((item) => item.value === filters.prompt) ?? null)
                : null
            }
            onValueChange={(item: PromptComboboxItem | null) =>
              onChange({
                prompt: !item || item.value === '__all__' ? '' : item.value,
              })
            }
          >
            <ComboboxTrigger className="h-8 w-56 text-xs">
              <ComboboxValue placeholder="All Prompts" />
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxInput placeholder="Search prompts…" />
              <ComboboxList>
                <ComboboxEmpty>No prompts match.</ComboboxEmpty>
                <ComboboxCollection>
                  {(item: PromptComboboxItem) => (
                    <ComboboxItem key={item.value} value={item} title={item.fullText}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Platform</label>
        <Select
          value={filters.platform || null}
          onValueChange={(v) => onChange({ platform: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="All Platforms">
              {(value) =>
                value && value !== '__all__'
                  ? (platforms.find((platform) => platform.value === value)?.label ??
                    getGroupedPlatformLabel(value))
                  : 'All Platforms'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Platforms</SelectItem>
            {platforms.map((platform) => (
              <SelectItem key={platform.value} value={platform.value}>
                {platform.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Region</label>
        <Select
          value={filters.region || null}
          onValueChange={(v) => onChange({ region: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="All Regions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Regions</SelectItem>
            {regions.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 pb-0.5">
        <Button
          type="button"
          variant={filters.excludeOwnDomain ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() =>
            onChange({
              excludeOwnDomain: !filters.excludeOwnDomain,
              ownOnly: false,
            })
          }
        >
          Exclude own domain
        </Button>
        <Button
          type="button"
          variant={filters.competitorOnly ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() =>
            onChange({
              competitorOnly: !filters.competitorOnly,
              excludeOwnDomain: !filters.competitorOnly ? true : filters.excludeOwnDomain,
              ownOnly: false,
            })
          }
        >
          Competitors only
        </Button>
        <Button
          type="button"
          variant={filters.ownOnly ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() =>
            onChange({
              ownOnly: !filters.ownOnly,
              excludeOwnDomain: false,
              competitorOnly: false,
            })
          }
        >
          Own domain only
        </Button>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        <p className="text-xs mt-1 text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

// ─── Tables ───────────────────────────────────────────────────────────────────

/** Turn a domain into a first-guess competitor name, e.g. caranddriver.com → "Caranddriver". */
function deriveCompetitorName(domain: string): string {
  const first = domain
    .replace(/^www\./, '')
    .split('.')[0]
    ?.trim();
  if (!first) return domain;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * Inline "+" on a Domains-table row: opens a confirm dialog pre-filled with a
 * name derived from the domain, then adds it as a tracked competitor (#301).
 */
function AddCompetitorButton({
  brandId,
  domain,
  onAdded,
}: {
  brandId: string;
  domain: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const nameId = useId();

  function openDialog() {
    setName(deriveCompetitorName(domain));
    setOpen(true);
  }

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await addCompetitor(brandId, { name: trimmed, domain });
      toast.success(`${domain} added as competitor`);
      setOpen(false);
      onAdded();
    } catch {
      toast.error('Could not add this domain as a competitor. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={openDialog}
        aria-label={`Add ${domain} as competitor`}
        title="Add as competitor"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {domain} as competitor?</DialogTitle>
          <DialogDescription>
            Track this domain as a competitor. You can edit the name below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Competitor name"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim() || saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DomainsTable = memo(function DomainsTable({
  rows,
  brandId,
  onAdded,
  page,
  onPage,
}: {
  rows: CitationDomainRow[];
  brandId: string;
  onAdded: () => void;
  page: number;
  onPage: (p: number) => void;
}) {
  if (rows.length === 0) return <EmptyRows />;

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, rows.length);
  const pageRows = rows.slice(start, end);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[56px] text-xs">Rank</TableHead>
            <TableHead className="text-xs">Domain</TableHead>
            <TableHead className="text-xs">Platforms</TableHead>
            <TableHead className="text-xs">Usage</TableHead>
            <TableHead className="text-right text-xs">Avg Citations</TableHead>
            <TableHead className="w-[44px]">
              <span className="sr-only">Add as competitor</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={row.domain}>
              {/* Global rank — offset by page so rank is continuous across pages */}
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {start + i + 1}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 min-w-0">
                  <DomainFavicon domain={row.domain} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{row.domain}</span>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <CategoryBadge category={row.category} />
                      <a
                        href={`https://${row.domain}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${row.domain} in a new tab`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <PlatformsCell models={row.models} />
              </TableCell>
              <TableCell>
                <UsageBar pct={row.usagePct} />
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {row.avgCitationsPerResult.toFixed(1)}
              </TableCell>
              <TableCell className="text-right">
                {row.category !== 'you' && row.category !== 'competitor' && brandId ? (
                  <AddCompetitorButton brandId={brandId} domain={row.domain} onAdded={onAdded} />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePager
        page={clampedPage}
        totalPages={totalPages}
        total={rows.length}
        start={start}
        end={end}
        onPage={onPage}
      />
    </div>
  );
});

const UrlsTable = memo(function UrlsTable({
  rows,
  page,
  onPage,
}: {
  rows: CitationUrlRow[];
  page: number;
  onPage: (p: number) => void;
}) {
  if (rows.length === 0) return <EmptyRows />;

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, rows.length);
  const pageRows = rows.slice(start, end);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[56px] text-xs">Rank</TableHead>
            <TableHead className="text-xs">URL</TableHead>
            <TableHead className="text-xs">Platforms</TableHead>
            <TableHead className="text-xs">Usage</TableHead>
            <TableHead className="text-right text-xs">Citations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={row.url}>
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {start + i + 1}
              </TableCell>
              <TableCell>
                <div className="flex items-start gap-2 min-w-0">
                  <DomainFavicon domain={row.domain} />
                  <div className="flex min-w-0 max-w-[480px] flex-col">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate text-sm font-medium text-foreground hover:underline"
                      title={row.title || row.url}
                    >
                      {row.title || row.url}
                    </a>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="truncate text-[11px] text-muted-foreground">
                        {row.domain}
                      </span>
                      <CategoryBadge category={row.category} />
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <PlatformsCell models={row.models} />
              </TableCell>
              <TableCell>
                <UsageBar pct={row.usagePct} />
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {row.totalCitations}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePager
        page={clampedPage}
        totalPages={totalPages}
        total={rows.length}
        start={start}
        end={end}
        onPage={onPage}
      />
    </div>
  );
});

function EmptyRows() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FilterIcon className="h-8 w-8 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium">No citations match your filters</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Try widening your date range or removing filters.
      </p>
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

/**
 * Per-table pagination state.
 * resetKey — pass a JSON.stringify of the active filters so the pager
 * automatically jumps back to page 0 whenever any filter changes.
 */
export function usePagination(totalRows: number, resetKey: unknown) {
  const [page, setPage] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resetKeyRef = useRef(resetKey);
  if (resetKeyRef.current !== resetKey) {
    resetKeyRef.current = resetKey;
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);

  return {
    page: clampedPage,
    setPage,
    totalPages,
    start: clampedPage * PAGE_SIZE,
    end: Math.min((clampedPage + 1) * PAGE_SIZE, totalRows),
  };
}

function TablePager({
  page,
  totalPages,
  total,
  start,
  end,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t px-4 py-3">
      <span className="text-xs text-muted-foreground tabular-nums">
        {start + 1}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={page >= totalPages - 1}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ─── Competitor Gaps (#300) ───────────────────────────────────────────────────

const GAP_METHODOLOGY =
  'Sources that appear in answers mentioning competitors but not you, weighted by how many sources each answer had.';

function StrengthBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden" title={`Strength ${pct}%`}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(6, pct)}%` }} />
    </div>
  );
}

function DomainCell({ domain }: { domain: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <DomainFavicon domain={domain} />
      <span className="truncate text-sm font-medium">{domain}</span>
      <a
        href={`https://${domain}`}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center text-muted-foreground hover:text-foreground"
        aria-label={`Open ${domain} in a new tab`}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function GapListTable({ rows }: { rows: CitationGapDomain[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Layers className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">No gap domains for these filters</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every domain citing a competitor also cites you, or there isn&apos;t enough data yet.
        </p>
      </div>
    );
  }
  const max = rows[0]?.strength ?? 0;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Domain</TableHead>
          <TableHead className="text-xs">Source type</TableHead>
          <TableHead className="text-right text-xs">Competitor answers</TableHead>
          <TableHead className="text-xs">Which competitors</TableHead>
          <TableHead className="text-xs">Strength</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.domain}>
            <TableCell>
              <DomainCell domain={row.domain} />
            </TableCell>
            <TableCell>
              <CategoryBadge category={row.category} />
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">
              {row.competitorAnswers}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {row.competitors.map((c) => (
                  <Badge key={c} variant="outline" className="text-[10px] whitespace-nowrap">
                    {c}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <StrengthBar value={row.strength} max={max} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ByCompetitorView({
  gaps,
  competitorId,
  onSelect,
}: {
  gaps: CitationGaps;
  competitorId: string;
  onSelect: (id: string) => void;
}) {
  const rows = gaps.byCompetitor[competitorId] ?? [];
  const max = rows[0]?.strength ?? 0;

  if (gaps.competitors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Layers className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">No competitor source data yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add competitors (with domains) and let a few tracking runs complete.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Competitor</span>
        <Select
          value={competitorId}
          onValueChange={(v) => {
            if (v) onSelect(v);
          }}
        >
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="Select competitor">
              {(value) => gaps.competitors.find((c) => c.id === value)?.name ?? 'Select competitor'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {gaps.competitors.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {rows.length === 0 ? (
        <EmptyRows />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Domain</TableHead>
              <TableHead className="text-xs">Source type</TableHead>
              <TableHead className="text-right text-xs">Answers feeding</TableHead>
              <TableHead className="text-center text-xs">Also cites us?</TableHead>
              <TableHead className="text-xs">Strength</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.domain}>
                <TableCell>
                  <DomainCell domain={row.domain} />
                </TableCell>
                <TableCell>
                  <CategoryBadge category={row.category} />
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {row.answersFeeding}
                </TableCell>
                <TableCell className="text-center">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] whitespace-nowrap',
                      row.alsoCitesUs
                        ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                        : 'text-muted-foreground',
                    )}
                  >
                    {row.alsoCitesUs ? '✓ Yes' : '✗ No'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StrengthBar value={row.strength} max={max} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function CompetitorGapsTab({ loading, gaps }: { loading: boolean; gaps: CitationGaps | null }) {
  const [view, setView] = useState<'list' | 'byCompetitor'>('list');
  // The user's pick; falls back to the first competitor (derived, no effect) so
  // it stays valid when the gaps data changes under a filter switch.
  const [picked, setPicked] = useState('');
  const competitorId =
    gaps && gaps.competitors.some((c) => c.id === picked)
      ? picked
      : (gaps?.competitors[0]?.id ?? '');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!gaps) return <EmptyRows />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView('list')}
            className={cn(
              'rounded px-2.5 py-1 transition-colors',
              view === 'list'
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Gap list
          </button>
          <button
            type="button"
            onClick={() => setView('byCompetitor')}
            className={cn(
              'rounded px-2.5 py-1 transition-colors',
              view === 'byCompetitor'
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            By competitor
          </button>
        </div>
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-help"
          title={GAP_METHODOLOGY}
        >
          <Info className="h-3.5 w-3.5" /> How this works
        </span>
      </div>

      {gaps.lowVisibility && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Your visibility is low in this window, so this list may be broad — focus on baseline
          visibility first.
        </div>
      )}

      {view === 'list' ? (
        <GapListTable rows={gaps.gapDomains} />
      ) : (
        <ByCompetitorView gaps={gaps} competitorId={competitorId} onSelect={setPicked} />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function getDateRange(
  preset: CitationsDatePreset,
  custom: { from: string; to: string },
): { dateFrom?: string; dateTo?: string } {
  if (preset === 'all') return {};
  if (preset === 'custom') {
    return {
      dateFrom: custom.from || undefined,
      dateTo: custom.to ? `${custom.to}T23:59:59.999Z` : undefined,
    };
  }
  if (preset === '24h') {
    const from = new Date();
    from.setHours(from.getHours() - 24);
    return { dateFrom: from.toISOString() };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { dateFrom: from.toISOString() };
}

export default function CitationsPage() {
  const t = useTranslations('citations');
  const { getActiveBrand } = useBrandStore();
  const brand = getActiveBrand();

  const [filters, setFilters] = useState<UIFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<CitationsOverview | null>(null);

  // Pagination — resets to page 0 whenever any filter changes
  const filterKey = JSON.stringify(filters);
  const domainPager = usePagination(data?.rows?.length ?? 0, filterKey);
  const urlPager = usePagination(data?.urlRows?.length ?? 0, filterKey);
  const [isLoading, setIsLoading] = useState(true);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<PlatformOption[]>([]);
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);

  const activeBrandId = brand?.id ?? null;

  const [sourceTab, setSourceTab] = useState<'domains' | 'urls' | 'gaps'>('domains');
  const [gaps, setGaps] = useState<CitationGaps | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);

  // Shared scoping filters (date / platform / region / topic / prompt). The
  // domain-list flags below don't apply to Competitor Gaps, so keeping them out
  // of this memo means toggling them doesn't refetch the Gaps tab.
  const gapFilters = useMemo<CitationsFilters>(() => {
    const { dateFrom, dateTo } = getDateRange(filters.datePreset, {
      from: filters.dateFrom,
      to: filters.dateTo,
    });
    return {
      datePreset: filters.datePreset,
      dateFrom,
      dateTo,
      platforms: filters.platform ? [filters.platform] : undefined,
      regions: filters.region ? [filters.region] : undefined,
      topicIds: filters.topic ? [filters.topic] : undefined,
      promptIds: filters.prompt ? [filters.prompt] : undefined,
    };
  }, [
    filters.datePreset,
    filters.dateFrom,
    filters.dateTo,
    filters.platform,
    filters.region,
    filters.topic,
    filters.prompt,
  ]);

  const apiFilters = useMemo<CitationsFilters>(
    () => ({
      ...gapFilters,
      excludeOwnDomain: filters.excludeOwnDomain,
      competitorOnly: filters.competitorOnly,
      ownOnly: filters.ownOnly,
    }),
    [gapFilters, filters.excludeOwnDomain, filters.competitorOnly, filters.ownOnly],
  );

  useEffect(() => {
    if (!activeBrandId) return;
    getTopics(activeBrandId)
      .then(setTopics)
      .catch(() => {});
    getBrandPrompts(activeBrandId)
      .then((rows) => setPrompts(rows.map((r) => ({ id: r.id, text: r.text }))))
      .catch(() => {});
  }, [activeBrandId]);

  const loadData = useCallback(async () => {
    if (!activeBrandId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const overview = await getCitationsOverview(activeBrandId, apiFilters);
      setData(overview);

      // Surface filter options from the observed models/regions.
      const platformOptions = buildPlatformOptions(overview.rows);
      const regions = new Set<string>();
      setAvailablePlatforms((prev) =>
        Array.from(
          new Map(
            [...prev, ...platformOptions].map((platform) => [platform.value, platform]),
          ).values(),
        ).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value)),
      );
      if (regions.size > 0) {
        setAvailableRegions((prev) =>
          Array.from(new Set([...prev, ...regions])).sort((a, b) => a.localeCompare(b)),
        );
      }
    } catch {
      // swallow — user will see empty state / can retry
    } finally {
      setIsLoading(false);
    }
  }, [activeBrandId, apiFilters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lazy-load Competitor Gaps only when its tab is active; re-fetch when the
  // shared scoping filters change while it's open. Uses `gapFilters` (not
  // `apiFilters`) so the domain-list flags don't trigger a no-op refetch.
  useEffect(() => {
    if (sourceTab !== 'gaps' || !activeBrandId) return;
    let cancelled = false;
    setGapsLoading(true);
    getCitationGaps(activeBrandId, gapFilters)
      .then((res) => {
        if (!cancelled) setGaps(res);
      })
      .catch(() => {
        if (!cancelled) setGaps(null);
      })
      .finally(() => {
        if (!cancelled) setGapsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceTab, activeBrandId, gapFilters]);

  const totals = data?.totals;
  const kpis = useMemo(
    () => [
      {
        title: t('kpiTotalCitations'),
        value: totals ? totals.citations.toLocaleString() : '—',
        sub: t('kpiTotalCitationsSub', {
          results: totals?.results ?? 0,
        }),
        icon: Quote,
      },
      {
        title: t('kpiUniqueDomains'),
        value: totals ? totals.domains.toLocaleString() : '—',
        sub: t('kpiUniqueDomainsSub', {
          urls: totals?.urls ?? 0,
        }),
        icon: Globe,
      },
      {
        title: t('kpiAvgPerResult'),
        value: totals ? totals.avgCitationsPerResult.toFixed(1) : '—',
        sub: t('kpiAvgPerResultSub'),
        icon: Layers,
      },
    ],
    [totals, t],
  );

  if (!brand) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Globe className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <h2 className="text-lg font-semibold">{t('noBrandTitle')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('noBrandDescription')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        topics={topics}
        prompts={prompts}
        platforms={availablePlatforms}
        regions={availableRegions}
      />

      {isLoading ? (
        <CitationsSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {kpis.map((k) => (
              <KpiCard key={k.title} {...k} />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">{t('sourcesTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs
                  value={sourceTab}
                  onValueChange={(v) => setSourceTab(v as 'domains' | 'urls' | 'gaps')}
                >
                  <TabsList>
                    <TabsTrigger value="domains">
                      {t('tabDomains')} ({data?.totals.domains ?? 0})
                    </TabsTrigger>
                    <TabsTrigger value="urls">
                      {t('tabUrls')} ({data?.totals.urls ?? 0})
                    </TabsTrigger>
                    <TabsTrigger value="gaps">Competitor Gaps</TabsTrigger>
                  </TabsList>
                  {/* keepMounted: data is already in memory, so mount both panels
                      once and make switching a pure CSS visibility toggle (#299). */}
                  <TabsContent value="domains" keepMounted className="mt-4">
                    <DomainsTable
                      rows={data?.rows ?? []}
                      brandId={activeBrandId ?? ''}
                      onAdded={loadData}
                      page={domainPager.page}
                      onPage={domainPager.setPage}
                    />
                  </TabsContent>
                  <TabsContent value="urls" keepMounted className="mt-4">
                    <UrlsTable
                      rows={data?.urlRows ?? []}
                      page={urlPager.page}
                      onPage={urlPager.setPage}
                    />
                  </TabsContent>
                  <TabsContent value="gaps" className="mt-4">
                    <CompetitorGapsTab loading={gapsLoading} gaps={gaps} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">{t('sourceTypesTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <SourceTypeDonut
                  data={data?.sourceTypeBreakdown ?? []}
                  total={data?.totals.domains ?? 0}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function CitationsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardContent className="pt-6">
            <Skeleton className="mb-4 h-8 w-48" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <Skeleton className="h-56 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
