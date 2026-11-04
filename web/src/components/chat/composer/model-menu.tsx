'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useAiUsage } from '@/components/providers/ai-usage-provider';
import type { ChatModelAccess } from '@/app/api/chat/models/route';
import { percentLabel } from '@/lib/billing/ai-usage';
import type { ChatModelMenu, ModelTone } from '@/lib/chat/model-menu';
import { AUTO_MODEL, CHAT_EFFORTS, offeredModel, type ChatModelChoice } from '@/lib/chat/models';
import { formatMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Where an Admin keeps the workspace's own AI keys. */
const AI_PROVIDERS_HREF = '/dashboard/settings/ai-providers';
/** Where the plans are. */
const BILLING_HREF = '/dashboard/settings/billing';

/** The model button's words: Auto's line, or the model's name, with the effort when it isn't Normal. */
export function useModelLabel(choice: ChatModelChoice): string | null {
  const t = useTranslations('chatComposer.modelMenu');
  if (choice.model === AUTO_MODEL && choice.effort === 'normal') return null;
  const name = offeredModel(choice.model)?.label ?? t('auto');
  return choice.effort === 'normal' ? name : `${name} · ${t(`effort.${choice.effort}`)}`;
}

/** A multiplier as a badge: green under 1x, amber from 3x (CHAT-16 item 7). */
function Multiplier({ label, tone }: { label: string | null; tone: ModelTone | null }) {
  if (!label) return null;
  return (
    <span
      data-tone={tone ?? undefined}
      className={cn(
        'shrink-0 rounded-[6px] border px-1.5 text-[11px] text-muted-foreground tabular-nums',
        tone === 'low' &&
          'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
        tone === 'high' &&
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
      )}
    >
      {label}
    </span>
  );
}

type Loaded =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; menu: ChatModelMenu; access: ChatModelAccess };

/**
 * The composer's model menu (CHAT-16 §A–C, W4-02; mockup #s-limits): Auto
 * (Default, Haiku reads and Sonnet writes, 1x), the offered models with their
 * multipliers, ✓ on the chat's pick, the catalog's line ("Prices from
 * OpenRouter, updated today. 1x = Auto."), the effort, the own-key row, this
 * month's AI usage and the plan. No dollar anywhere (the 2026-10-27
 * decision). In the free trial only Auto at Normal (Wave 4 decision 2 B).
 * The pick goes with each message of the chat; Auto stays the default.
 */
export function ModelMenu({
  choice,
  onChange,
  onClose,
}: {
  choice: ChatModelChoice;
  onChange: (choice: ChatModelChoice) => void;
  onClose: () => void;
}) {
  const t = useTranslations('chatComposer.modelMenu');
  const { usage } = useAiUsage();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    const query =
      choice.model === AUTO_MODEL ? '' : `?selected=${encodeURIComponent(choice.model)}`;
    void fetch(`/api/chat/models${query}`)
      .then((res) => res.json())
      .then((body: { ok?: boolean; menu?: ChatModelMenu; access?: ChatModelAccess }) => {
        if (stale) return;
        if (body?.ok && body.menu && body.access) {
          setLoaded({ state: 'ready', menu: body.menu, access: body.access });
        } else setLoaded({ state: 'failed' });
      })
      .catch(() => {
        if (!stale) setLoaded({ state: 'failed' });
      });
    return () => {
      stale = true;
    };
    // Read once as it opens: the chat's pick at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closes on Esc and on a click outside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const ready = loaded.state === 'ready' ? loaded : null;
  const open = ready?.access.choiceOpen ?? false;
  const removed = ready?.menu.selected?.removed ? ready.menu.selected : null;
  // A dropped model runs as Auto: the menu shows Auto picked.
  const picked = removed ? AUTO_MODEL : choice.model;
  const updated = ready?.menu.updatedAt;
  const today = updated ? new Date(updated).toDateString() === new Date().toDateString() : false;
  const row =
    'flex w-full items-center gap-2 rounded-[9px] px-2 py-[7px] text-left text-[13px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent';

  const pick = (model: string) => {
    onChange({ model, effort: choice.effort });
    onClose();
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={t('label')}
      data-slot="model-menu"
      className="absolute right-0 bottom-full z-30 mb-2 w-[min(340px,calc(100vw-2rem))] rounded-[14px] border bg-popover p-1.5 text-popover-foreground shadow-[0_12px_32px_rgba(10,10,10,.12)]"
    >
      <div className="px-2 pt-1 pb-1.5 text-xs font-semibold">{t('title')}</div>
      {loaded.state === 'loading' && (
        <p className="px-2 py-2 text-[13px] text-muted-foreground">{t('loading')}</p>
      )}
      {loaded.state === 'failed' && (
        <p role="alert" className="px-2 py-2 text-[13px] text-muted-foreground">
          {t('failed')}
        </p>
      )}
      {ready && (
        <>
          {removed && (
            <p className="mx-1 mb-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              {t('removed')}
            </p>
          )}
          <div role="radiogroup" aria-label={t('models')}>
            <button
              type="button"
              role="radio"
              aria-checked={picked === AUTO_MODEL}
              data-action="model.pick"
              data-model={AUTO_MODEL}
              onClick={() => pick(AUTO_MODEL)}
              className={row}
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t('auto')}</span>{' '}
                <i className="rounded-[5px] border px-1 text-[10px] text-muted-foreground not-italic">
                  {t('default')}
                </i>
                <em className="block text-[11.5px] text-muted-foreground not-italic">
                  {t('autoHow')}
                </em>
              </span>
              <Multiplier label="1x" tone="normal" />
              <Check
                aria-hidden
                className={cn('size-3.5 shrink-0', picked !== AUTO_MODEL && 'invisible')}
              />
            </button>
            {ready.menu.models.map((model) => (
              <button
                key={model.id}
                type="button"
                role="radio"
                aria-checked={picked === model.id}
                data-action="model.pick"
                data-model={model.id}
                disabled={!open}
                title={open ? undefined : t('trialLocked')}
                onClick={() => pick(model.id)}
                className={row}
              >
                <span className="min-w-0 flex-1">
                  {offeredModel(model.id)?.label ?? model.name}
                  {model.yourKey && (
                    <i className="ml-1.5 rounded-[5px] border px-1 text-[10px] text-muted-foreground not-italic">
                      {t('yourKey')}
                    </i>
                  )}
                  {model.variesByHour && (
                    <em className="block text-[11.5px] text-muted-foreground not-italic">
                      {t('variesByHour')}
                    </em>
                  )}
                </span>
                <Multiplier label={model.multiplier} tone={model.tone} />
                <Check
                  aria-hidden
                  className={cn('size-3.5 shrink-0', picked !== model.id && 'invisible')}
                />
              </button>
            ))}
          </div>
          {!open && <p className="px-2 py-1 text-xs text-muted-foreground">{t('trialLocked')}</p>}
          <p className="px-2 pt-1 pb-1.5 text-[11.5px] text-muted-foreground">
            {updated
              ? today
                ? t('pricesToday')
                : t('pricesOn', { date: formatMonthDay(updated) })
              : t('pricesNone')}
          </p>

          <div className="border-t px-2 pt-2 pb-1.5">
            <div className="mb-1 flex items-center text-xs font-semibold">
              {t('effortTitle')}
              <span className="ml-auto font-normal text-muted-foreground">{t('effortHint')}</span>
            </div>
            <span
              role="radiogroup"
              aria-label={t('effortTitle')}
              className="inline-flex rounded-[9px] border bg-muted/60 p-0.5"
            >
              {CHAT_EFFORTS.map((effort) => {
                const on = choice.effort === effort;
                return (
                  <button
                    key={effort}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-action="model.effort"
                    disabled={!open && effort !== 'normal'}
                    onClick={() => onChange({ model: choice.model, effort })}
                    className={cn(
                      'rounded-[7px] px-[9px] py-[3px] text-xs whitespace-nowrap text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60',
                      on &&
                        'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]',
                    )}
                  >
                    {t(`effort.${effort}`)}
                  </button>
                );
              })}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 border-t px-2 pt-2 pb-1 text-xs">
            {ready.access.ownKeys.state !== 'open' && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('ownKey')}</span>
                {ready.access.ownKeys.state === 'locked' ? (
                  <span className="ml-auto text-right text-muted-foreground">
                    {t('ownKeyLocked', { plan: ready.access.planName ?? '' })}
                  </span>
                ) : (
                  <Link
                    data-action="model.ownKeys"
                    href={AI_PROVIDERS_HREF}
                    className="ml-auto text-right text-foreground underline underline-offset-2"
                  >
                    {ready.access.ownKeys.state === 'kept' && ready.access.ownKeys.until
                      ? t('ownKeyUntil', { date: formatMonthDay(ready.access.ownKeys.until) })
                      : t('ownKeyIncluded')}
                  </Link>
                )}
              </div>
            )}
            {usage && !usage.unlimited && usage.percentUsed !== null && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('usage')}</span>
                <span className="ml-auto text-muted-foreground">
                  {usage.periodEnd
                    ? t('usageLine', {
                        percent: percentLabel(usage.percentUsed),
                        date: formatMonthDay(usage.periodEnd),
                      })
                    : percentLabel(usage.percentUsed)}
                </span>
              </div>
            )}
            {ready.access.planName && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('plan')}</span>
                <span className="text-muted-foreground">
                  {ready.access.trial
                    ? t('planTrial', { plan: ready.access.planName })
                    : ready.access.planName}
                </span>
                <Link
                  data-action="model.seePlans"
                  href={BILLING_HREF}
                  className="ml-auto text-foreground underline underline-offset-2"
                >
                  {t('seePlans')}
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
