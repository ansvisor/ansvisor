'use client';

import type { MouseEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { BarChart3, CreditCard, Download, Loader2, MoreHorizontal } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { tabsListVariants } from '@/components/ui/tabs';
import { sectionFor, type PromptsListView } from '@/lib/prompts-routes';
import { formatRegionDisplay } from '@/lib/region';
import { cn } from '@/lib/utils';
import type { LocationsWarning } from './_usage-cards';

/**
 * The Prompts page's header pieces (the owner's simpler header, 2026-11-17):
 * the "…" menu beside Add prompt, the Tracked | Suggestions switch, the
 * Location filter in the table's filter row, and the quiet lines in the
 * table's status line: the prompt locations near the plan's limit, and how
 * many prompts still need their volume analyzed.
 */

/**
 * "…" beside Add prompt: Export CSV, Plan & usage, and Show usage (the usage
 * cards that used to fold under the Tracked Prompts bar). Each item does
 * what its button did; one the tab doesn't offer is left out. Prompts are
 * managed on this page itself, so the brand's Manage prompts page has no
 * item here.
 */
export function PromptsMoreMenu({
  onExportCsv,
  exportDisabled = false,
  planHref,
  usage,
}: {
  /** Export CSV; left out on a tab without an export. */
  onExportCsv?: () => void;
  /** No prompts to export yet: the item says so and does nothing. */
  exportDisabled?: boolean;
  /** Plan & usage; none on self-hosted, or before the counts are read. */
  planHref?: string;
  /** Show or hide the usage cards; left out off Tracked, where they don't show. */
  usage?: { open: boolean; onToggle: () => void; warning: LocationsWarning | null };
}) {
  const t = useTranslations('prompts.header');
  const tUsage = useTranslations('prompts.usage');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  // Nothing to offer on this tab: no menu.
  if (!onExportCsv && !planHref && !usage) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="icon-sm" />}
        aria-label={t('moreActions')}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {onExportCsv && (
          <DropdownMenuItem
            onClick={onExportCsv}
            disabled={exportDisabled}
            className="gap-2"
            data-action="export-csv"
          >
            <Download />
            <span className="flex min-w-0 flex-col">
              {tCommon('exportCsv')}
              {exportDisabled && (
                <span className="text-xs text-muted-foreground">{t('exportHint')}</span>
              )}
            </span>
          </DropdownMenuItem>
        )}
        {onExportCsv && (planHref || usage) && <DropdownMenuSeparator />}
        {planHref && (
          <DropdownMenuItem
            render={<Link href={planHref} />}
            className="gap-2"
            data-action="plan-usage"
          >
            <CreditCard />
            {tUsage('planAndUsage')}
          </DropdownMenuItem>
        )}
        {usage && (
          <DropdownMenuItem onClick={usage.onToggle} className="gap-2" data-action="usage-cards">
            <BarChart3 />
            <span className="flex min-w-0 flex-col">
              {usage.open ? t('hideUsage') : t('showUsage')}
              {/* Folded, the cards still say when the plan's prompt locations are nearly or fully used. */}
              {!usage.open && usage.warning && (
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    usage.warning.tone === 'full'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400',
                  )}
                >
                  {tUsage('collapsedLocations', {
                    used: format.number(usage.warning.used),
                    limit: format.number(usage.warning.limit),
                  })}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A plain click; one with a modifier key opens the route in a new tab or window. */
function plainClick(e: MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * Tracked | Suggestions: two views of the same roster, each its own route
 * (PROMPT-001). A click moves the page in place, as the sub-tabs it replaces
 * did; the links' addresses let a new tab open on the same view. Tracked
 * carries its count once the prompts are read; Suggestions has none on hand.
 */
export function PromptsListSwitch({
  view,
  onSelect,
  trackedCount,
}: {
  view: PromptsListView;
  onSelect: (view: PromptsListView) => void;
  /** Tracked prompts (Active + New); undefined until the prompts are read. */
  trackedCount?: number;
}) {
  const t = useTranslations('prompts.header.view');
  const format = useFormatter();
  const items: { id: PromptsListView; label: string; count?: number }[] = [
    { id: 'tracked', label: t('tracked'), count: trackedCount },
    { id: 'suggestions', label: t('suggestions') },
  ];
  return (
    <nav aria-label={t('label')} className={cn(tabsListVariants(), 'h-8')}>
      {items.map(({ id, label, count }) => {
        const active = view === id;
        return (
          <Link
            key={id}
            href={sectionFor('all', id).href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            onClick={(e: MouseEvent) => {
              if (!plainClick(e)) return;
              e.preventDefault();
              if (!active) onSelect(id);
            }}
            className={cn(
              'flex h-[calc(100%-1px)] items-center gap-1.5 rounded-md border border-transparent px-2.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              active
                ? 'bg-card text-foreground shadow-sm dark:border-input dark:bg-input/30'
                : 'text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground',
            )}
          >
            {label}
            {count !== undefined && (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {format.number(count)}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The Location filter, in the table's filter row: which tracked location the
 * figures describe. Empty is every location blended.
 */
export function LocationFilter({
  regions,
  value,
  onChange,
}: {
  regions: string[];
  value: string;
  onChange: (region: string) => void;
}) {
  const t = useTranslations('prompts.header.location');
  const items = [
    { value: '__all__', label: t('all') },
    ...regions.map((r) => ({ value: r, label: formatRegionDisplay(r) })),
  ];
  return (
    <Select
      value={value || null}
      onValueChange={(v) => onChange(!v || v === '__all__' ? '' : String(v))}
      items={items}
    >
      <SelectTrigger className="h-8 w-44 text-xs" aria-label={t('label')}>
        <SelectValue placeholder={t('all')}>
          {(v) => (v && v !== '__all__' ? formatRegionDisplay(String(v)) : t('all'))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * "● 46 / 50 prompt locations used · Plan & usage": the plan's prompt
 * locations, once nearly (amber) or fully (red) used, in the table's status
 * line, so the limit stays in sight with the usage cards folded. Plan &
 * usage goes where the menu's does; without a plan page (self-hosted) the
 * line has no link.
 */
export function LocationsWarningLine({
  warning,
  planHref,
}: {
  warning: LocationsWarning;
  planHref?: string;
}) {
  const t = useTranslations('prompts.header');
  const tUsage = useTranslations('prompts.usage');
  const format = useFormatter();
  const full = warning.tone === 'full';
  return (
    <p
      data-locations-warning={warning.tone}
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 text-xs',
        full ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400',
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', full ? 'bg-red-500' : 'bg-amber-500')}
      />
      <span className="tabular-nums">
        {t('locationsUsed', {
          used: format.number(warning.used),
          limit: format.number(warning.limit),
        })}
      </span>
      {planHref && (
        <>
          <span aria-hidden>·</span>
          <Link
            href={planHref}
            className="rounded-sm font-medium underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {tUsage('planAndUsage')}
          </Link>
        </>
      )}
    </p>
  );
}

/**
 * "● Volume and competition missing for 2 prompts · Analyze": active prompts
 * without a volume, whose Volume and Competition stay empty until their
 * volume is analyzed. The prompts themselves are tracked (visibility,
 * mentions, citations, positions): only these two columns are missing.
 * Analyze runs the volume analysis for them, as the banner's button did, and
 * says so to a screen reader; it is left out for members, and says so when
 * the month's analyses are used up.
 */
export function NotAnalyzedLine({
  count,
  onAnalyze,
  analyzing = false,
  progress = null,
  limitReached = false,
}: {
  count: number;
  /** Undefined for members, who can't analyze. */
  onAnalyze?: () => void;
  analyzing?: boolean;
  /** The run's own count, once it reports one. */
  progress?: { done: number; total: number } | null;
  /** The month's volume analyses are used up. */
  limitReached?: boolean;
}) {
  const t = useTranslations('prompts.header.notAnalyzed');
  const format = useFormatter();
  return (
    <p
      data-not-analyzed
      className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
      title={limitReached ? t('limitHint') : t('hint')}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
      <span>{t('count', { count })}</span>
      {onAnalyze && analyzing ? (
        <>
          <span aria-hidden>·</span>
          <span role="status" className="inline-flex items-center gap-1">
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
            {progress
              ? t('analyzingProgress', {
                  done: format.number(progress.done),
                  total: format.number(progress.total),
                })
              : t('analyzing')}
          </span>
        </>
      ) : limitReached ? (
        <>
          <span aria-hidden>·</span>
          <span>{t('limitReached')}</span>
        </>
      ) : onAnalyze ? (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={onAnalyze}
            aria-label={t('analyzeLabel', { count })}
            className="rounded-sm font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t('analyze')}
          </button>
        </>
      ) : null}
    </p>
  );
}
