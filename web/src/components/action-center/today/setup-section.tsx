'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/hooks/use-user-role';
import {
  getGettingStarted,
  skipGettingStarted,
  startGettingStarted,
} from '@/lib/actions/getting-started';
import { hideCard } from '@/lib/actions/user-brand-state';
import { isCardHidden } from '@/lib/user-brand-state';
import type { GettingStartedStep } from '@/lib/getting-started/steps';
import { Button } from '@/components/ui/button';
import { TodaySection } from './today-parts';
import { useTodayRead, type TodayVisit } from './use-today';

/** Steps the card lists at a time; Show all steps lists the 7. */
const NEXT_STEPS = 2;

/** The card a person hides for themselves: user_brand_state.hidden (00529). */
const SETUP_CARD = 'setup';

/**
 * Finish setting up on Action Center › Today (SIMPLE_NAV): the 7 set-up
 * steps (KPIs, competitors, topics, prompts, Search Console, Analytics and
 * the AI traffic snippet), worked out from the brand's data, so the steps a
 * brand already did count. The next 2 open steps with how long each takes,
 * Show all steps and Hide; gone at 7 of 7. Hide skips Getting started for
 * the brand when an admin or manager hides it, and hides the card for the
 * person otherwise (or when the brand can't be changed: read-only, demo).
 * A brand added beside others asks its admins and managers first, as
 * Actions did ("Run Getting started for this brand?"). Every brand with
 * steps left sees it, unless Getting started was skipped before.
 */
export function SetupSection({
  brandId,
  brandName,
  visit,
  onDone,
}: {
  brandId: string;
  brandName: string | null;
  visit: TodayVisit;
  /** Steps done, for today_viewed. */
  onDone?: (done: number | null) => void;
}) {
  const t = useTranslations('actionCenter.today.setup');
  const tAsk = useTranslations('actionCenter.gettingStarted.secondBrand');
  const { canManage } = useUserRole();
  const [version, setVersion] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [hiddenNow, setHiddenNow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useTodayRead(brandId, () => getGettingStarted(brandId), version);

  const status = load.status === 'ready' ? load.data : null;
  const done = status ? status.done : null;
  useEffect(() => {
    onDone?.(done);
  }, [done, onDone]);

  const state = visit.state;
  const hidden = hiddenNow === brandId || (state ? isCardHidden(state.hidden, SETUP_CARD) : false);
  // Shown once both the steps and the person's state are read, so it never flickers away.
  if (!status || state === undefined || hidden || status.skipped) return null;
  if (status.done >= status.total) return null;

  const hide = async () => {
    setBusy(true);
    let by: 'brand' | 'person' = 'person';
    try {
      if (canManage) {
        try {
          await skipGettingStarted(brandId);
          by = 'brand';
        } catch {
          // Read-only or the demo brand: hidden for the person instead.
        }
      }
      if (by === 'person') {
        const kept = await hideCard(brandId, SETUP_CARD, null);
        if (!kept.ok) throw new Error('not kept');
      }
      track('today_setup_hidden', { by });
      setHiddenNow(brandId);
    } catch {
      toast.error(t('hideFailed'));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (run: boolean) => {
    setBusy(true);
    try {
      if (run) await startGettingStarted(brandId);
      else await skipGettingStarted(brandId);
      setVersion((v) => v + 1);
    } catch {
      toast.error(t('askFailed'));
    } finally {
      setBusy(false);
    }
  };

  const open = status.steps.filter((step) => step.state === 'new');
  const listed = expanded ? status.steps : open.slice(0, NEXT_STEPS);
  const brand = brandName ?? '';

  return (
    <TodaySection
      part="setup"
      title={t('title')}
      aside={
        <span className="text-[13px] text-muted-foreground">
          {t('count', { done: status.done, total: status.total })}
        </span>
      }
      dashed
    >
      <span
        className="block h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={status.total}
        aria-valuenow={status.done}
        aria-label={t('count', { done: status.done, total: status.total })}
      >
        <span
          className="block h-1 bg-foreground"
          style={{ width: `${Math.round((status.done / status.total) * 100)}%` }}
        />
      </span>
      {status.asking && canManage ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">{tAsk('title', { brand })}</p>
          <p className="text-muted-foreground">{tAsk('body')}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void answer(true)}>
              {tAsk('run')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
              {tAsk('skip')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="space-y-2 text-sm">
            {listed.map((step) => (
              <SetupStep key={step.key} step={step} />
            ))}
          </ul>
          <div className="flex gap-3.5 text-[13px] text-muted-foreground">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="underline underline-offset-2 hover:text-foreground"
              aria-expanded={expanded}
            >
              {expanded ? t('showFewer') : t('showAll')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void hide()}
              title={canManage ? t('hideHintBrand') : t('hideHintPerson')}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t('hide')}
            </button>
          </div>
        </>
      )}
    </TodaySection>
  );
}

function SetupStep({ step }: { step: GettingStartedStep }) {
  const t = useTranslations('actionCenter.today.setup');
  const tSteps = useTranslations('actionCenter.gettingStarted.steps');
  const finished = step.state === 'done' || step.state === 'skipped';
  return (
    <li data-setup-step={step.key}>
      <Link
        href={step.href}
        onClick={() => track('today_setup_step_clicked', { step: step.key })}
        className={cn(
          'flex justify-between gap-2 hover:underline',
          finished && 'text-muted-foreground',
        )}
      >
        <span className="flex items-center gap-1.5">
          {finished && <Check className="h-3.5 w-3.5" aria-label={t(`state.${step.state}`)} />}
          {tSteps(`${step.key}.title`)}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {finished ? t(`state.${step.state}`) : t(`minutes.${step.key}`)}
        </span>
      </Link>
    </li>
  );
}
