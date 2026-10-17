'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Check,
  Eye,
  Gauge,
  Link2,
  MessageSquare,
  MoreHorizontal,
  MousePointerClick,
  RotateCcw,
  Search,
  Sparkles,
  Swords,
  TrendingDown,
  TrendingUp,
  Trophy,
  Unlink,
  X,
  Layers,
  Quote,
  Wrench,
} from 'lucide-react';
import { AIProviderAvatar, type AIProviderKey } from '@/components/ai-provider-avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Signal } from '@/lib/actions/signals';
import {
  SIGNAL_KINDS,
  type SignalCategory,
  type SignalImpact,
  type SignalKind,
  type SignalSource,
  type SignalStatus,
} from '@/lib/signals/registry';
import { signalAffected, signalTexts } from '@/lib/signals/display';
import { locationName, platformFamily, platformName } from '@/lib/signals/names';
import type { SignalWhere } from '@/lib/signals/where';
import { formatRelative } from '@/lib/format-relative';
import { cn } from '@/lib/utils';

/** Icons for the original kinds. The library's forty-seven take their
 *  category's — a traffic finding reads as traffic whichever detector wrote it. */
export const SIGNAL_ICONS: Partial<
  Record<SignalKind, React.ComponentType<{ className?: string }>>
> = {
  sharp_drop: TrendingDown,
  visibility_slipping: TrendingDown,
  platform_gap: Layers,
  competitor_citation_gap: Quote,
  prompt_gain: TrendingUp,
  new_engine: Sparkles,
  lost_citations: Unlink,
  first_citation: Link2,
  competitor_surge: Swords,
  competitor_crossed: Swords,
  competitor_overtaken: Trophy,
  page_opportunity: MousePointerClick,
  uncited_mentions: MessageSquare,
  audit_low_score: Gauge,
};

const SOURCE_ICONS: Record<SignalSource, React.ComponentType<{ className?: string }>> = {
  ai_results: Sparkles,
  ga4: BarChart3,
  gsc: Search,
  site_audit: Gauge,
};

/** Data sources as icon + name pairs — icons carry recognition, the text
 *  stays the accessible signal. */
export function SourceList({ sources }: { sources: SignalSource[] }) {
  const t = useTranslations('actionCenter.signalsPage');
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {sources.map((source) => {
        const Icon = SOURCE_ICONS[source];
        return (
          <span key={source} className="flex items-center gap-1 text-xs text-muted-foreground">
            {Icon && <Icon className="h-3 w-3" />}
            {t(`sources.${source}`)}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Impact as the mockup's multi-dot meter. Never color alone: the dots sit
 * beside the impact word, which carries the meaning for assistive tech.
 */
export function ImpactDots({ impact }: { impact: SignalImpact }) {
  const filled = impact === 'high' ? 3 : impact === 'medium' ? 2 : 1;
  const color =
    impact === 'high' ? 'bg-red-500' : impact === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground';
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i < filled ? color : 'bg-muted')} />
      ))}
    </span>
  );
}

export const STATUS_BADGE: Record<SignalStatus, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  acknowledged: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  resolved: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  dismissed: 'border-border bg-muted/50 text-muted-foreground',
};

const STATE_TEXT: Record<string, string> = {
  dropped: 'text-red-600 dark:text-red-400',
  lost: 'text-red-600 dark:text-red-400',
  crossed: 'text-red-600 dark:text-red-400',
  gain: 'text-red-600 dark:text-red-400',
  gained: 'text-green-600 dark:text-green-400',
  overtaken: 'text-green-600 dark:text-green-400',
  opportunity: 'text-emerald-600 dark:text-emerald-400',
};

/**
 * A signal the engine closed because its subject moved to another kind — a
 * topic that went from slipping to dropped — reads "Changed", not "Resolved":
 * nothing was fixed, the finding became a different one.
 */
export function isSuperseded(signal: Pick<Signal, 'status' | 'payload'>): boolean {
  return signal.status === 'resolved' && typeof signal.payload?.supersededBy === 'string';
}

export function SignalStatusBadge({
  status,
  superseded = false,
}: {
  status: SignalStatus;
  superseded?: boolean;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  return (
    <Badge variant="outline" className={superseded ? STATUS_BADGE.dismissed : STATUS_BADGE[status]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {superseded ? t('superseded') : t(`status.${status}`)}
    </Badge>
  );
}

function detectedLabel(iso: string, tCommon: ReturnType<typeof useTranslations>): string {
  return formatRelative(iso, tCommon);
}

/** What a kind without its own icon falls back to. */
const SIGNAL_CATEGORY_ICONS: Record<SignalCategory, React.ComponentType<{ className?: string }>> = {
  visibility: TrendingDown,
  citation: Quote,
  mention: MessageSquare,
  traffic: MousePointerClick,
  technical: Wrench,
  competitor: Swords,
};

export function SignalKindIcon({
  kind,
  category,
  className = 'h-4 w-4 text-muted-foreground',
}: {
  kind: SignalKind;
  category: SignalCategory;
  className?: string;
}) {
  const Icon = SIGNAL_ICONS[kind] ?? SIGNAL_CATEGORY_ICONS[category] ?? BarChart3;
  return <Icon className={className} />;
}

const MAX_PLATFORM_ICONS = 4;
const MAX_LOCATIONS = 2;

/**
 * Where a signal happened (AC-002), as one line under Affected: an icon per
 * engine, then the location codes, with every platform and location named on
 * hover. A line rather than its own column, because the table is already as
 * wide as the page beside a pinned sidebar. Signals about a competitor, a
 * domain or the whole brand have no place of their own and show nothing, and
 * neither does a signal whose one place Affected already names ("Gemini").
 */
export function SignalWhereLine({
  where,
  besides = [],
}: {
  where: SignalWhere;
  /** What the cell already says, so a lone platform or location isn't repeated. */
  besides?: (string | null)[];
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const places = [...where.platforms.map(platformName), ...where.regions.map(locationName)];
  if (places.length === 0 || (places.length === 1 && besides.includes(places[0]))) return null;

  // Engines sharing one icon (the ChatGPT app and its API) show it once.
  const engines = new Map<string, { family: AIProviderKey | null; names: string[] }>();
  for (const slug of where.platforms) {
    const family = platformFamily(slug);
    const key = family ?? slug;
    const entry = engines.get(key) ?? { family, names: [] };
    entry.names.push(platformName(slug));
    engines.set(key, entry);
  }
  const shown = [...engines.entries()].slice(0, MAX_PLATFORM_ICONS);
  const hidden = engines.size - shown.length;
  const platformNames = [...engines.values()].flatMap((engine) => engine.names).join(', ');
  const locationNames = where.regions.map(locationName).join(', ');
  const locations = where.regions.slice(0, MAX_LOCATIONS);
  const label = [
    platformNames && t('where.platforms', { names: platformNames }),
    locationNames && t('where.locations', { names: locationNames }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden" title={label}>
      <span className="sr-only">{label}</span>
      {shown.map(([key, { family, names }]) =>
        family ? (
          <span key={key} aria-hidden="true" className="flex shrink-0">
            <AIProviderAvatar provider={family} className="h-4 w-4 shrink-0" />
          </span>
        ) : (
          <span key={key} aria-hidden="true" className="min-w-0 truncate text-xs">
            {names[0]}
          </span>
        ),
      )}
      {hidden > 0 && (
        <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
          +{hidden}
        </span>
      )}
      {locations.length > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            'min-w-0 truncate text-xs text-muted-foreground',
            engines.size > 0 && 'ml-1',
          )}
        >
          {locations.join(' · ')}
          {where.regions.length > locations.length &&
            ` +${where.regions.length - locations.length}`}
        </span>
      )}
    </div>
  );
}

export function SignalTable({
  signals,
  onSelect,
  onStatusChange,
  busyId,
}: {
  signals: Signal[];
  onSelect: (signal: Signal) => void;
  onStatusChange: (signal: Signal, status: SignalStatus) => void;
  busyId: string | null;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.signalCategories');
  const tCommon = useTranslations('common');

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t('table.signal')}</TableHead>
            <TableHead className="text-xs">{t('table.type')}</TableHead>
            <TableHead className="text-xs">{t('table.impact')}</TableHead>
            <TableHead className="text-xs">{t('table.source')}</TableHead>
            <TableHead className="text-xs">{t('table.affected')}</TableHead>
            <TableHead className="text-xs">{t('table.detected')}</TableHead>
            <TableHead className="text-xs">{t('table.status')}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t('table.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signals.map((signal) => {
            const texts = signalTexts(signal, tTexts);
            const affected = signalAffected(signal, t);
            const stateKey = SIGNAL_KINDS[signal.kind].stateKey;
            const detected = new Date(signal.detectedAt);
            return (
              <TableRow key={signal.id} className="cursor-pointer" onClick={() => onSelect(signal)}>
                <TableCell className="max-w-[360px]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <SignalKindIcon kind={signal.kind} category={signal.category} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{texts.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{texts.description}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="text-xs font-medium">{tCategories(signal.category)}</p>
                  <p className={cn('text-xs', STATE_TEXT[stateKey] ?? 'text-muted-foreground')}>
                    {t(`states.${stateKey}`)}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{t(`impact.${signal.impact}`)}</span>
                    <ImpactDots impact={signal.impact} />
                  </div>
                </TableCell>
                <TableCell>
                  <SourceList sources={signal.source} />
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <p className="text-xs font-medium">{affected.label}</p>
                  {affected.detail && (
                    <p className="truncate text-xs text-muted-foreground">{affected.detail}</p>
                  )}
                  <SignalWhereLine
                    where={signal.where}
                    besides={[affected.label, affected.detail]}
                  />
                </TableCell>
                <TableCell>
                  <p className="text-xs tabular-nums">
                    {detected.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                    {', '}
                    {detected.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {detectedLabel(signal.detectedAt, tCommon)}
                  </p>
                </TableCell>
                <TableCell>
                  <SignalStatusBadge status={signal.status} superseded={isSuperseded(signal)} />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                      disabled={busyId === signal.id}
                      aria-label={t('menu.label')}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {signal.status === 'new' && (
                        <DropdownMenuItem onClick={() => onStatusChange(signal, 'acknowledged')}>
                          <Eye className="h-4 w-4" />
                          {t('menu.acknowledge')}
                        </DropdownMenuItem>
                      )}
                      {(signal.status === 'new' || signal.status === 'acknowledged') && (
                        <>
                          <DropdownMenuItem onClick={() => onStatusChange(signal, 'resolved')}>
                            <Check className="h-4 w-4" />
                            {t('menu.resolve')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onStatusChange(signal, 'dismissed')}>
                            <X className="h-4 w-4" />
                            {t('menu.dismiss')}
                          </DropdownMenuItem>
                        </>
                      )}
                      {(signal.status === 'resolved' || signal.status === 'dismissed') && (
                        <DropdownMenuItem onClick={() => onStatusChange(signal, 'new')}>
                          <RotateCcw className="h-4 w-4" />
                          {t('menu.reopen')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
