'use client';

import { ADD_TRACKING_HREF } from '@/lib/billing/add-on-links';
import { track } from '@/lib/analytics';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { ChevronUp, RotateCw } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { CONTACT_SALES_URL, PLANS, type PlanId } from '@/config/plans';
import type { LocationQuota } from '@/lib/actions/prompt';
import { getPromptUsage } from '@/lib/prompt-usage';
import type { PromptUsageSummary } from '@/lib/prompt-usage-summary';
import { cn } from '@/lib/utils';

/**
 * Tracked Prompts usage cards (PROMPT-012): the brand's active and total
 * prompts, and the account's active prompts, prompt locations and slots left,
 * above the table. The brand cards filter the table; the account cards lead
 * to Plan & usage. They load on their own (GET /api/prompts/usage), so the
 * table never waits for them.
 *
 * The cards stay folded away: closed whenever the page opens, so the table
 * sits right under the controls, and opened from the header's "…" menu
 * (Show usage). Folded, that menu item still says when the plan's prompt
 * locations are nearly or fully used.
 */

/** How long a tracked prompt reads as New after it is added. */
export const NEW_PROMPT_MS = 24 * 60 * 60 * 1000;

/**
 * A row's Status: paused, new (tracked and added within the last day),
 * active, or waiting for a spot (saved past the plan's limit, not tracked;
 * 00535).
 */
export type PromptStatus = 'active' | 'new' | 'paused' | 'waiting';

/** What a row's Status is read from. `waitingSince` is set while it waits for a spot. */
type StatusFields = { isActive: boolean; createdAt: string; waitingSince?: string | null };

/**
 * Which rows the table shows; set by the This brand cards or the Status
 * filter. It opens on Tracked: every prompt being tracked, Active and New.
 */
export type PromptStatusFilter = 'tracked' | PromptStatus | 'all';

export function promptStatus(prompt: StatusFields, now: number): PromptStatus {
  if (!prompt.isActive) return prompt.waitingSince ? 'waiting' : 'paused';
  return now - Date.parse(prompt.createdAt) < NEW_PROMPT_MS ? 'new' : 'active';
}

export function matchesStatusFilter(
  prompt: StatusFields,
  filter: PromptStatusFilter,
  now: number,
): boolean {
  if (filter === 'all') return true;
  const status = promptStatus(prompt, now);
  return filter === 'tracked' ? status === 'active' || status === 'new' : status === filter;
}

/**
 * The table's default order: prompts added within the last day lead, newest
 * first, then the rest as sorted. New prompts have no answers yet, so a
 * performance sort alone would sink them to the bottom.
 */
export function newFirst<T extends { isActive: boolean; createdAt: string }>(
  sorted: T[],
  now: number,
): T[] {
  const isNew = (p: T) => promptStatus(p, now) === 'new';
  const added = (p: T) => Date.parse(p.createdAt);
  return [
    ...sorted.filter(isNew).sort((a, b) => added(b) - added(a)),
    ...sorted.filter((p) => !isNew(p)),
  ];
}

/** How many rows each filter shows, for the table's title. */
export function countByStatus(
  prompts: StatusFields[],
  now: number,
): Record<PromptStatusFilter, number> {
  const counts: Record<PromptStatusFilter, number> = {
    tracked: 0,
    active: 0,
    new: 0,
    paused: 0,
    waiting: 0,
    all: prompts.length,
  };
  for (const p of prompts) counts[promptStatus(p, now)] += 1;
  counts.tracked = counts.active + counts.new;
  return counts;
}

/** Plan keys this bundle has labels for; any other shows the server's name. */
function isKnownPlan(key: string): key is PlanId {
  return Object.hasOwn(PLANS, key);
}

type UsageLoad =
  | { brandId: string; status: 'ready'; usage: PromptUsageSummary }
  | { brandId: string; status: 'error' };

export type PromptUsageState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; usage: PromptUsageSummary };

const PLAN_PAGE = '/dashboard/settings?tab=billing';
const ctaHref = (cta: string) => (cta === 'add_more' ? ADD_TRACKING_HREF : PLAN_PAGE);

/**
 * The cards' data for a brand. Bump `version` after a change to the brand's
 * prompts or locations to refetch; the cards keep their numbers meanwhile.
 */
export function usePromptUsage(
  brandId: string | null,
  version: number,
): { state: PromptUsageState; retry: () => void } {
  const [load, setLoad] = useState<UsageLoad | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!brandId) return;
    const controller = new AbortController();
    fetch(`/api/prompts/usage?brandId=${encodeURIComponent(brandId)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`usage ${res.status}`);
        return (await res.json()) as PromptUsageSummary;
      })
      .then((usage) => setLoad({ brandId, status: 'ready', usage }))
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ brandId, status: 'error' });
      });
    return () => controller.abort();
  }, [brandId, version, attempt]);

  // Back to the skeletons while retrying, so the click visibly does something.
  const retry = useCallback(() => {
    setLoad(null);
    setAttempt((a) => a + 1);
  }, []);
  // Another brand's numbers never show while the new brand's load.
  const state: PromptUsageState =
    !load || load.brandId !== brandId
      ? { status: 'loading' }
      : load.status === 'ready'
        ? { status: 'ready', usage: load.usage }
        : { status: 'error' };
  return { state, retry };
}

/** The plan-limit numbers the Add Prompt dialog and bulk import bound themselves by. */
export function locationQuotaFromUsage(usage: PromptUsageSummary): LocationQuota {
  const used = usage.account.locationsUsed;
  return {
    // An ended plan takes nothing new until a plan is chosen again: the quota
    // reads as full, as the Slots left card's 0 does.
    maxPrompts: usage.plan.ended ? used : (usage.plan.locationLimit ?? -1),
    used,
    planId: usage.plan.key,
    planName: isKnownPlan(usage.plan.key) ? PLANS[usage.plan.key].name : usage.plan.name,
  };
}

type Tone = 'normal' | 'warning' | 'full';

/** How full the plan's prompt locations are: amber from 90%, red at or past the limit. */
function usageTone(usage: PromptUsageSummary): Tone {
  const limit = usage.plan.locationLimit;
  if (limit === null) return 'normal';
  const meter = getPromptUsage(usage.account.locationsUsed, limit);
  if (meter.state === 'warning') return 'warning';
  if (meter.state === 'full' || meter.state === 'over') return 'full';
  return 'normal';
}

/** The plan ended: nothing is tracked until a plan is chosen again. */
export function planEnded(state: PromptUsageState): boolean {
  return state.status === 'ready' && !!state.usage.plan.ended;
}

/** Where Plan & usage goes: none on self-hosted, or before the counts are read. */
export function planUsageHref(state: PromptUsageState): string | undefined {
  return state.status === 'ready' && state.usage.plan.cta ? PLAN_PAGE : undefined;
}

/** The plan's prompt locations, once nearly or fully used. */
export type LocationsWarning = { used: number; limit: number; tone: 'warning' | 'full' };

/**
 * What the folded cards still say, beside the menu's Show usage: the plan's
 * prompt locations when nearly or fully used; null well under the limit, with
 * no limit, or before the counts are read.
 */
export function locationsWarning(state: PromptUsageState): LocationsWarning | null {
  if (state.status !== 'ready') return null;
  // An ended plan says so instead (planEnded): its prompts aren't tracked,
  // and its plan reads as Starter once Stripe ends it (the webhook), so a
  // count against Starter's limit would read as over a limit never chosen.
  if (state.usage.plan.ended) return null;
  const limit = state.usage.plan.locationLimit;
  const tone = usageTone(state.usage);
  if (limit === null || tone === 'normal') return null;
  return { used: state.usage.account.locationsUsed, limit, tone };
}

const TONE_TEXT: Record<Tone, string> = {
  normal: '',
  warning: 'text-amber-600 dark:text-amber-500',
  full: 'text-red-600 dark:text-red-500',
};

const TONE_BAR: Record<Tone, string> = {
  normal: 'bg-foreground',
  warning: 'bg-amber-500 dark:bg-amber-400',
  full: 'bg-red-500 dark:bg-red-400',
};

export function PromptUsageCards({
  state,
  brandName,
  prompts,
  filter,
  onFilter,
  onRetry,
  onHide,
}: {
  state: PromptUsageState;
  brandName: string | undefined;
  /** The brand's prompts, for the New ones the Active card also counts. */
  prompts: StatusFields[];
  filter: PromptStatusFilter;
  onFilter: (filter: PromptStatusFilter) => void;
  onRetry: () => void;
  /** Folds the cards away again, as the menu's Hide usage does. */
  onHide: () => void;
}) {
  const t = useTranslations('prompts.usage');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const n = (value: number) => format.number(value);
  const statusCounts = countByStatus(prompts, now.getTime());
  const newCount = statusCounts.new;

  const usage = state.status === 'ready' ? state.usage : null;
  const plan = usage?.plan;
  const planShort = !plan ? '' : isKnownPlan(plan.key) ? t(`planLabel.${plan.key}`) : plan.name;
  const planPill = plan?.ended
    ? t('planPillEnded', { plan: planShort })
    : plan && isKnownPlan(plan.key)
      ? t('planPill', { plan: planShort })
      : (plan?.name ?? '');
  // Self-hosted has no plan page to go to.
  const planHref = plan?.cta ? PLAN_PAGE : undefined;

  const limit = plan?.locationLimit ?? null;
  const used = usage?.account.locationsUsed ?? 0;
  const meter = usage && limit !== null ? getPromptUsage(used, limit) : null;
  const tone: Tone = usage ? usageTone(usage) : 'normal';

  const value = (content: ReactNode, className?: string) =>
    usage ? (
      <div className={cn('mt-1 text-2xl font-bold tabular-nums', className)}>{content}</div>
    ) : state.status === 'error' ? (
      <div className="mt-1 text-2xl font-bold text-muted-foreground">–</div>
    ) : (
      <Skeleton className="mt-1.5 mb-1 h-7 w-16" />
    );
  const sub = (content: ReactNode) =>
    // Sub-lines wrap rather than cut off, so the plan CTA stays reachable on
    // narrow cards; the labels above them stay on one line.
    usage ? (
      <div className="text-xs leading-snug text-muted-foreground">{content}</div>
    ) : state.status === 'error' ? null : (
      <Skeleton className="mt-1 h-3 w-24" />
    );

  const cta =
    plan?.cta === 'contact' ? (
      <a
        href={CONTACT_SALES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'relative z-10 underline underline-offset-2',
          tone === 'full' ? 'font-semibold text-red-600 dark:text-red-500' : 'text-foreground',
        )}
      >
        {t('cta.contact')}
      </a>
    ) : plan?.cta ? (
      <Link
        href={ctaHref(plan.cta)}
        onClick={() => plan.cta === 'add_more' && track('add_on_entry', { source: 'usage_cards' })}
        className={cn(
          'relative z-10 underline underline-offset-2',
          tone === 'full' ? 'font-semibold text-red-600 dark:text-red-500' : 'text-foreground',
        )}
      >
        {t(`cta.${plan.cta}`)}
      </Link>
    ) : null;

  const updatedAt = usage ? new Date(usage.updatedAt) : null;
  const updatedLabel =
    updatedAt && now.getTime() - updatedAt.getTime() >= 60_000
      ? t('updated', { when: format.relativeTime(updatedAt, now) })
      : t('updatedJustNow');

  return (
    <section aria-label={t('panelLabel')} className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-1 min-[900px]:grid-cols-[2fr_3fr]">
        <div className="min-w-0 border-b min-[900px]:border-e min-[900px]:border-b-0">
          <GroupHeader name={t('thisBrand')}>
            <span className="truncate text-xs text-muted-foreground">{brandName}</span>
          </GroupHeader>
          <div className="grid auto-cols-fr grid-flow-col">
            <UsageCard
              label={t('activePrompts')}
              selected={filter === 'tracked'}
              onSelect={() => onFilter('tracked')}
            >
              {value(usage && n(usage.brand.active))}
              {sub(
                usage && (
                  <>
                    {newCount > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => onFilter('new')}
                          title={t('showNew')}
                          aria-pressed={filter === 'new'}
                          className={cn(
                            'relative z-10 underline-offset-2 hover:underline',
                            filter === 'new' && 'font-medium text-foreground underline',
                          )}
                        >
                          {t('new', { count: n(newCount) })}
                        </button>{' '}
                        ·{' '}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onFilter('paused')}
                      title={t('showPaused')}
                      aria-pressed={filter === 'paused'}
                      className={cn(
                        'relative z-10 underline-offset-2 hover:underline',
                        filter === 'paused' && 'font-medium text-foreground underline',
                      )}
                    >
                      {/* Prompts waiting for a spot are inactive too, with a filter of their own. */}
                      {t('paused', {
                        count: n(Math.max(0, usage.brand.paused - statusCounts.waiting)),
                      })}
                    </button>{' '}
                    · {t('beingTracked')}
                  </>
                ),
              )}
            </UsageCard>
            <UsageCard
              label={t('totalPrompts')}
              selected={filter === 'all'}
              onSelect={() => onFilter('all')}
            >
              {value(usage && n(usage.brand.total))}
              {sub(t('activePlusPaused'))}
            </UsageCard>
          </div>
        </div>

        <div className="min-w-0">
          <GroupHeader name={t('account')}>
            {plan ? (
              <span className="rounded-md border bg-background px-2 text-xs leading-5 font-medium">
                {planPill}
              </span>
            ) : state.status === 'loading' ? (
              <Skeleton className="h-5 w-24" />
            ) : null}
          </GroupHeader>
          <div className="grid auto-cols-fr grid-flow-col">
            <UsageCard label={t('activePrompts')} href={planHref}>
              {value(usage && n(usage.account.activePrompts))}
              {sub(usage && t('acrossBrands', { count: usage.account.brands }))}
            </UsageCard>
            <UsageCard label={t('promptLocations')} href={planHref}>
              {value(
                <>
                  {n(used)}
                  {limit !== null && (
                    <span className="text-[15px] font-medium text-muted-foreground">
                      {' '}
                      / {n(limit)}
                    </span>
                  )}
                </>,
                TONE_TEXT[tone],
              )}
              {usage && limit !== null && (
                <div
                  className="my-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={t('promptLocations')}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={Math.min(used, limit)}
                >
                  <div
                    className={cn('h-full rounded-full', TONE_BAR[tone])}
                    style={{ width: `${meter?.percent ?? 0}%` }}
                  />
                </div>
              )}
              {sub(
                limit === null ? (
                  `${t('unlimited')} · ${t('locationPairs')}`
                ) : meter?.state === 'over' ? (
                  <>
                    {t('locationPairs')} · <span className={TONE_TEXT.full}>{t('overLimit')}</span>
                  </>
                ) : (
                  t('locationPairs')
                ),
              )}
            </UsageCard>
            <UsageCard label={t('slotsLeft')} href={planHref}>
              {/* Nothing can be added until a plan is chosen again. */}
              {value(
                plan?.ended ? n(0) : limit === null ? t('unlimited') : n(meter?.remaining ?? 0),
                TONE_TEXT[tone],
              )}
              {sub(
                <>
                  {plan?.ended
                    ? t('ended', { plan: planShort })
                    : limit === null
                      ? t('onPlan', { plan: planShort })
                      : t('ofLimit', { limit: n(limit), plan: planShort })}
                  {cta && <> · {cta}</>}
                </>,
              )}
            </UsageCard>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <span>{t('footer')}</span>
        {state.status === 'error' ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 text-foreground hover:underline"
          >
            <RotateCw className="h-3 w-3" />
            {t('loadFailed')} · {t('retry')}
          </button>
        ) : usage ? (
          <span>{updatedLabel}</span>
        ) : null}
        <button
          type="button"
          onClick={onHide}
          className="ms-auto flex items-center gap-1 rounded font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {t('hide')}
          <ChevronUp aria-hidden className="h-4 w-4 shrink-0" />
        </button>
      </div>
    </section>
  );
}

function GroupHeader({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <div className="flex h-[38px] items-center gap-2 border-b bg-muted/40 px-4 whitespace-nowrap">
      <span className="text-[11px] font-semibold tracking-wider text-foreground/80 uppercase">
        {name}
      </span>
      {children}
    </div>
  );
}

/**
 * One card. Its label is the card's control — a button that filters the
 * table, or a link to Plan & usage — stretched over the whole card, so links
 * inside the card (the paused count, the plan CTA) sit above it.
 */
function UsageCard({
  label,
  selected = false,
  onSelect,
  href,
  children,
}: {
  label: string;
  selected?: boolean;
  onSelect?: () => void;
  href?: string;
  children: ReactNode;
}) {
  const labelClass =
    'block h-4 truncate text-start text-[11px] tracking-wide text-muted-foreground uppercase ' +
    "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none";
  return (
    <div
      className={cn(
        'relative min-w-0 border-e px-4 py-3.5 last:border-e-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-inset',
        (onSelect || href) && 'hover:bg-muted/40',
        selected && 'shadow-[inset_0_-2px_0_var(--foreground)]',
      )}
    >
      {onSelect ? (
        <button type="button" onClick={onSelect} aria-pressed={selected} className={labelClass}>
          {label}
        </button>
      ) : href ? (
        <Link href={href} className={labelClass}>
          {label}
        </Link>
      ) : (
        <div className="block h-4 truncate text-[11px] tracking-wide text-muted-foreground uppercase">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
