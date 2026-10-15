'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { AIProviderAvatar } from '@/components/ai-provider-avatar';
import { getSignalActions, type Signal, type SignalAction } from '@/lib/actions/signals';
import { actionTexts } from '@/lib/action-center/display';
import { locationName, platformFamily, platformName } from '@/lib/signals/names';
import {
  METRIC_UNITS,
  signalChange,
  signalLinks,
  signalWhereFields,
  type SignalFigure,
  type WhereValue,
} from '@/lib/signals/detail';
import { cn } from '@/lib/utils';

/**
 * The signal drawer's three blocks (AC-001): Where, What changed, and
 * Evidence and links. lib/signals/detail.ts decides what each holds; these
 * only render it.
 */

const LIST_LIMIT = 5;

function BlockTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}

function NotAvailable() {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  return <span className="text-xs text-muted-foreground">{t('notAvailable')}</span>;
}

function More({ shown, total }: { shown: number; total: number }) {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  return total > shown ? (
    <li className="text-xs text-muted-foreground">{t('more', { count: total - shown })}</li>
  ) : null;
}

function WhereValueView({ value }: { value: WhereValue }) {
  const t = useTranslations('actionCenter.signalsPage');
  const format = useFormatter();
  switch (value.type) {
    case 'text':
      return <span className="break-words">{value.text}</span>;
    case 'number':
      return <span className="tabular-nums">#{format.number(value.value)}</span>;
    case 'scope':
      return <span>{t(`drawer.scopes.${value.scope}`)}</span>;
    case 'prompt':
      return (
        <span className="break-words">
          {value.text}
          {value.id && (
            <Link
              href={`/dashboard/prompts/${value.id}`}
              className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
            >
              {t('drawer.viewPrompt')}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </span>
      );
    case 'prompts': {
      if (value.items.length === 0)
        return <span>{t('affected.prompts', { count: value.total })}</span>;
      const shown = value.items.slice(0, LIST_LIMIT);
      return (
        <ul className="space-y-0.5">
          {shown.map((item, i) => (
            <li key={item.id ?? i} className="break-words">
              {item.id ? (
                <Link
                  href={`/dashboard/prompts/${item.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {item.text}
                </Link>
              ) : (
                item.text
              )}
            </li>
          ))}
          <More shown={shown.length} total={value.total} />
        </ul>
      );
    }
    case 'list': {
      const shown = value.items.slice(0, LIST_LIMIT);
      return (
        <ul className="space-y-0.5">
          {shown.map((item, i) => (
            <li key={i} className="break-all">
              {item}
            </li>
          ))}
          <More shown={shown.length} total={value.total} />
        </ul>
      );
    }
    case 'platforms':
      return (
        <span className="flex flex-wrap gap-1">
          {value.slugs.map((slug) => {
            const family = platformFamily(slug);
            return (
              <span
                key={slug}
                className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-xs"
              >
                {family && (
                  <span aria-hidden="true" className="flex">
                    <AIProviderAvatar provider={family} className="h-3.5 w-3.5" />
                  </span>
                )}
                {platformName(slug)}
              </span>
            );
          })}
        </span>
      );
    case 'all_platforms':
      return <span>{t('drawer.allPlatforms')}</span>;
    case 'positions':
      return (
        <ul className="space-y-1.5">
          {value.items.map((row) => (
            <li key={`${row.promptId}-${row.platform}`}>
              <Link
                href={`/dashboard/prompts/${row.promptId}`}
                className="break-words underline-offset-2 hover:underline"
              >
                {row.promptText || t('drawer.positions.untitled')}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {platformName(row.platform)} ·{' '}
                {value.competitor || t('drawer.change.roles.unnamed')}{' '}
                <PositionMove position={row.competitor} side="competitor" /> ·{' '}
                {t('drawer.positions.you')} <PositionMove position={row.you} side="you" />
              </span>
            </li>
          ))}
        </ul>
      );
    case 'sources':
      return (
        <ul className="space-y-1">
          {value.items.map((source) => (
            <li key={source.domain}>
              <span className="break-all">{source.domain}</span>
              <span className="block text-xs text-muted-foreground">
                {t('drawer.positions.sourceAnswers', {
                  count: source.answers,
                  of: source.answersRead,
                })}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'citations':
      return (
        <ul className="space-y-1">
          {value.items.map((page, i) => (
            <li key={i}>
              <span className="break-all">{page.url.replace(/^https?:\/\//, '')}</span>
              <span className="block text-xs text-muted-foreground">
                {[
                  page.position !== null && t('drawer.cited.position', { position: page.position }),
                  page.lastCitedAt &&
                    t('drawer.cited.lastCited', {
                      date: format.dateTime(new Date(page.lastCitedAt), {
                        month: 'short',
                        day: 'numeric',
                      }),
                    }),
                  page.answers !== undefined &&
                    (page.answersRead !== undefined
                      ? t('drawer.cited.answersOf', { count: page.answers, of: page.answersRead })
                      : t('drawer.cited.answers', { count: page.answers })),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'locations':
      return <span>{value.codes.map(locationName).join(', ')}</span>;
  }
}

/**
 * "#1 ↑2": a position this week and how it moved since last week (1 is named
 * first, so a smaller number is up). "—" when not named this week. Coloured
 * as news for the brand: its own climb is good, a competitor's is not.
 */
function PositionMove({
  position,
  side,
}: {
  position: { now: number | null; before: number | null };
  side: 'competitor' | 'you';
}) {
  const t = useTranslations('actionCenter.signalsPage.drawer.positions');
  const format = useFormatter();
  const n = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  if (position.now === null) {
    return (
      <span className="font-medium text-foreground">
        —
        {position.before !== null && (
          <span className="text-red-600 dark:text-red-400"> {t('lost')}</span>
        )}
      </span>
    );
  }
  const moved =
    position.before === null ? null : Math.round((position.before - position.now) * 10) / 10;
  const tone = (up: boolean) =>
    up !== (side === 'competitor')
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';
  return (
    <span className="font-medium text-foreground">
      #{n(position.now)}
      {moved === null ? (
        <span className="text-muted-foreground"> {t('new')}</span>
      ) : moved > 0 ? (
        <span className={tone(true)}> ↑{n(moved)}</span>
      ) : moved < 0 ? (
        <span className={tone(false)}> ↓{n(-moved)}</span>
      ) : (
        <span className="text-muted-foreground"> =</span>
      )}
    </span>
  );
}

export function SignalWhereBlock({ signal }: { signal: Signal }) {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  const fields = signalWhereFields(signal);
  if (fields.length === 0) return null;
  return (
    <div>
      <BlockTitle>{t('where')}</BlockTitle>
      <dl className="mt-2 grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
        {fields.map(({ key, value }) => (
          <div key={key} className="contents">
            <dt className="text-xs text-muted-foreground">{t(`fields.${key}`)}</dt>
            <dd className="min-w-0 text-sm">
              {value ? <WhereValueView value={value} /> : <NotAvailable />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function useFigureText() {
  const t = useTranslations('actionCenter.signalsPage.drawer.change');
  const format = useFormatter();

  const value = (figure: Pick<SignalFigure, 'metric' | 'value' | 'of'>, signed = false) => {
    const unit = METRIC_UNITS[figure.metric];
    const n = format.number(Math.abs(figure.value), { maximumFractionDigits: 1 });
    if (figure.of !== undefined) return `${n} / ${format.number(figure.of)}`;
    const sign = signed ? (figure.value > 0 ? '+' : figure.value < 0 ? '−' : '') : '';
    if (unit === 'percent') return signed ? t('points', { value: `${sign}${n}` }) : `${n}%`;
    if (unit === 'points') return t('points', { value: `${sign}${n}` });
    if (unit === 'rank') return `#${n}`;
    return `${sign}${n}`;
  };

  // The subject is a stored slug or code; say it the way people do.
  const subject = (figure: SignalFigure) => {
    const raw = figure.subject ?? '';
    if (!raw) return '';
    if (figure.subjectType === 'location') return locationName(raw);
    if (figure.subjectType === 'platform') return platformName(raw);
    return raw;
  };

  // "Mention rate · last 7 days", "Mentions · Profound · last 7 days",
  // "Mention rate · United States (best)": the metric, whose, and when.
  const label = (figure: SignalFigure) => {
    const name = subject(figure);
    const overTime = ['before', 'after', 'earlier', 'latest', 'change'].includes(figure.role);
    return [
      t(`metrics.${figure.metric}`),
      overTime && name ? name : null,
      t(`roles.${figure.role}`, { name: name || t('roles.unnamed') }),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  return { value, label };
}

export function SignalChangeBlock({ signal }: { signal: Signal }) {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  const { value, label } = useFigureText();
  const change = signalChange(signal);

  return (
    <div>
      <BlockTitle>{t('whatChanged')}</BlockTitle>
      {!change ? (
        <p className="mt-1">
          <NotAvailable />
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`change.periods.${change.period}`)}
          </p>
          <div className="mt-2 space-y-2">
            {groupByMetric(change.figures).map((figures) => {
              const before = figures.find((f) => f.role === 'before' || f.role === 'earlier');
              const after = figures.find((f) => f.role === 'after' || f.role === 'latest');
              if (before && after) {
                // Days out of different totals have no meaningful difference.
                const delta =
                  after.of === undefined
                    ? { metric: after.metric, value: after.value - before.value }
                    : { metric: after.metric, value: 0 };
                // A rise is good news for the brand's own numbers and bad news
                // for a competitor's.
                const good = delta.value >= 0 !== (after.subjectType === 'competitor');
                return (
                  <div key={after.metric} className="flex flex-wrap items-center gap-2">
                    <FigureBox label={label(before)} value={value(before)} />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    <FigureBox label={label(after)} value={value(after)} />
                    {delta.value !== 0 && (
                      <span
                        className={cn(
                          'text-xs font-medium',
                          good
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {value(delta, true)}
                      </span>
                    )}
                  </div>
                );
              }
              return (
                <div key={figures[0].metric + figures[0].role} className="flex flex-wrap gap-2">
                  {figures.map((figure) => (
                    <FigureBox
                      key={figure.role + (figure.subject ?? '')}
                      label={label(figure)}
                      value={value(figure, figure.role === 'change')}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Figures of one metric together, in their order: one comparison per row. */
function groupByMetric(figures: SignalFigure[]): SignalFigure[][] {
  const groups = new Map<string, SignalFigure[]>();
  for (const figure of figures) {
    groups.set(figure.metric, [...(groups.get(figure.metric) ?? []), figure]);
  }
  return [...groups.values()];
}

function FigureBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px] rounded-lg border px-3 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function SignalEvidenceBlock({ signal, brandId }: { signal: Signal; brandId: string }) {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  const tActions = useTranslations('actionCenter.actionTexts');
  // Loaded per action id; until the answer for this id arrives it is loading.
  const [loaded, setLoaded] = useState<{
    id: string;
    actions: SignalAction[] | null;
  } | null>(null);
  const actionId = signal.actionId;

  useEffect(() => {
    if (!actionId) return;
    let cancelled = false;
    getSignalActions(brandId, [actionId])
      .then((rows) => {
        if (!cancelled) setLoaded({ id: actionId, actions: rows });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: actionId, actions: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, actionId]);

  const current = actionId && loaded?.id === actionId ? loaded : null;
  const actions: SignalAction[] | 'loading' | 'failed' = !actionId
    ? []
    : !current
      ? 'loading'
      : (current.actions ?? 'failed');

  const stamp = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div className="space-y-3">
      <BlockTitle>{t('evidence')}</BlockTitle>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {signalLinks(signal).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
          >
            {t(`links.${link.kind}`)}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 text-xs">
        <div>
          <p className="text-muted-foreground">{t('detected')}</p>
          <p className="mt-0.5 tabular-nums">{stamp(signal.detectedAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('lastDetected')}</p>
          <p className="mt-0.5 tabular-nums">{stamp(signal.lastDetectedAt)}</p>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t('usedBy')}</p>
        <div className="mt-1 text-xs">
          {actions === 'failed' ? (
            <span className="text-muted-foreground">{t('usedByFailed')}</span>
          ) : actions === 'loading' ? (
            <span className="text-muted-foreground">{t('loading')}</span>
          ) : actions.length === 0 ? (
            <span className="text-muted-foreground">{t('usedByNone')}</span>
          ) : (
            <ul className="space-y-1">
              {actions.map((action) => (
                <li key={action.id}>
                  <Link
                    href={`/dashboard/action-center/actions?action=${action.id}`}
                    className="inline-flex items-start gap-1 rounded-md border px-2.5 py-1 font-medium hover:bg-muted"
                  >
                    {t('actionLabel', {
                      no: action.actionNo,
                      title: actionTexts(action, tActions).title,
                    })}
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
