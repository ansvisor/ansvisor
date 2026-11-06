'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useDemoBrand } from '@/components/providers/demo-brand-provider';
import { buttonVariants } from '@/components/ui/button-variants';
import { useFirstRun, type FirstRun } from '@/hooks/use-first-run';
import { useUserRole } from '@/hooks/use-user-role';
import { Link } from '@/i18n/navigation';
import { dismissChatWelcome } from '@/lib/actions/chat-prefs';
import { getSuggestionSourceStates } from '@/lib/actions/integrations';
import { track } from '@/lib/analytics';
import type { ChatStartAudience } from '@/lib/chat/start-audience';
import { TOUR_TOPICS, type TourTopic } from '@/lib/chat/tour';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';
import { TOUR_CHIP, TOUR_CHIP_PRIMARY } from './tour/tour-chip';

/**
 * Chat Home's welcome card (owner decision 2026-11-06; mockup
 * chat-tour/1-trial-home-welcome): one card above the box for the free
 * trial and the demo. In the trial, "Preparing your data" with the first
 * tracking run's progress while it goes on (the Action Center's first-run
 * note's data, useFirstRun), then the Google sources still to connect; then,
 * for everyone it greets, the product tour's topics, Show me everything and
 * Not now. The demo brand's data is ready and it connects nothing: it gets
 * the tour alone.
 */

/** The Google sources the card still offers to connect. */
export interface WelcomeConnect {
  gsc: boolean;
  ga: boolean;
}

/** Each source's card in Settings › Integrations, where it connects and picks its property. */
export const CONNECT_HREF = {
  gsc: '/dashboard/settings/integrations#google-search-console',
  ga: '/dashboard/settings/integrations#google-analytics',
} as const;

export interface WelcomeCardProps {
  /** In the trial: the first run and the connections. The demo: the tour alone. */
  trial: boolean;
  /** The first tracking run while it goes on; null once the first results are in. */
  run: FirstRun | null;
  /** The sources still to connect; null until read, or for someone who can't connect. */
  connect: WelcomeConnect | null;
  /** A topic or Show me everything is opening: the chips wait. */
  starting?: boolean;
  onTopic: (topic: TourTopic) => void;
  onEverything: () => void;
  onDismiss: () => void;
}

/** "first results in about 15 min", else the checks done, else that it waits for a slot. */
function useRunNote(run: FirstRun): string | null {
  const t = useTranslations('chatShell.home.welcome');
  if (run.left) return 'hours' in run.left ? t('etaHours', run.left) : t('etaMinutes', run.left);
  if (run.progress && run.progress.total > 0) return t('progress', run.progress);
  return run.queued ? t('queued') : null;
}

function Preparing({ run }: { run: FirstRun }) {
  const t = useTranslations('chatShell.home.welcome');
  const note = useRunNote(run);
  const pct =
    run.progress && run.progress.total > 0
      ? Math.min(100, Math.round((run.progress.current / run.progress.total) * 100))
      : null;
  return (
    <div data-slot="welcome-preparing" role="status">
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        <span className="font-medium">{t('preparing')}</span>
        {note && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{note}</span>}
      </div>
      <div
        role="progressbar"
        aria-label={t('preparing')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            'h-full rounded-full bg-foreground transition-[width] duration-500',
            pct === null && 'w-1/4 animate-pulse',
          )}
          style={pct === null ? undefined : { width: `${Math.max(pct, 4)}%` }}
        />
      </div>
    </div>
  );
}

export function WelcomeCard({
  trial,
  run,
  connect,
  starting = false,
  onTopic,
  onEverything,
  onDismiss,
}: WelcomeCardProps) {
  const t = useTranslations('chatShell.home.welcome');
  const tTour = useTranslations('chatTour');
  const titleId = useId();
  const preparing = trial && run !== null;
  const missing =
    trial && connect && (connect.gsc || connect.ga)
      ? connect.gsc && connect.ga
        ? 'both'
        : connect.gsc
          ? 'gsc'
          : 'ga'
      : null;
  return (
    <section
      data-slot="chat-welcome"
      aria-labelledby={titleId}
      className="mb-3 rounded-[14px] border bg-card px-3.5 py-3 text-[13px] shadow-sm"
    >
      {preparing && run && <Preparing run={run} />}
      {missing && connect && (
        <div data-slot="welcome-connect" className={cn(preparing && 'mt-3')}>
          <p className="text-muted-foreground">
            {t(preparing ? 'connectWhileRuns' : 'connect', { missing })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {connect.gsc && (
              <Link
                href={CONNECT_HREF.gsc}
                data-action="welcome.connectGsc"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Plus aria-hidden />
                {t('connectGsc')}
              </Link>
            )}
            {connect.ga && (
              <Link
                href={CONNECT_HREF.ga}
                data-action="welcome.connectGa"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Plus aria-hidden />
                {t('connectGa')}
              </Link>
            )}
          </div>
        </div>
      )}
      {(preparing || missing) && <hr className="my-3 border-border" />}
      <div data-slot="welcome-tour">
        <h2 id={titleId} className="text-[13.5px] font-semibold">
          {t('tourTitle')}
        </h2>
        <p className="mt-0.5 text-muted-foreground">{t('tourBody')}</p>
        <div role="group" aria-labelledby={titleId} className="mt-2.5 flex flex-wrap gap-1.5">
          {TOUR_TOPICS.map((topic) => (
            <button
              key={topic}
              type="button"
              data-action="welcome.tourTopic"
              data-topic={topic}
              disabled={starting}
              onClick={() => onTopic(topic)}
              className={TOUR_CHIP}
            >
              {tTour(`topics.${topic}`)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            data-action="welcome.tourAll"
            disabled={starting}
            onClick={onEverything}
            className={cn(TOUR_CHIP, TOUR_CHIP_PRIMARY)}
          >
            {t('everything')}
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            data-action="welcome.notNow"
            onClick={onDismiss}
            className="rounded-md text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t('notNow')}
          </button>
        </div>
      </div>
    </section>
  );
}

/** The card's state on Chat Home: shown, the trial's parts, and Not now. */
export interface ChatWelcomeState {
  /** The card shows: someone it greets, before Not now. */
  shown: boolean;
  /** The trial's parts show: the trial, on a brand of its own (not the demo brand). */
  trial: boolean;
  run: FirstRun | null;
  connect: WelcomeConnect | null;
  /** Not now: hidden at once and kept (00486); a failure brings it back and says so. */
  dismiss: () => void;
}

/**
 * The welcome card's data for the person on Chat Home: the first run of the
 * brand on screen while it goes on, and, for an Admin or a Manager (who
 * can connect), which Google sources the brand still doesn't use. Nothing
 * is read for the demo, or once the card is gone.
 */
export function useChatWelcome(audience: ChatStartAudience | null): ChatWelcomeState {
  const t = useTranslations('chatShell.home.welcome');
  const [hidden, setHidden] = useState(false);
  const { isDemo } = useDemoBrand();
  const { canManage } = useUserRole();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const shown = audience !== null && !hidden;
  const trial = shown && audience === 'trial' && !isDemo;
  const run = useFirstRun({ enabled: trial });
  const [connect, setConnect] = useState<{ brandId: string; value: WelcomeConnect } | null>(null);
  const seen = useRef(false);

  useEffect(() => {
    if (!shown || seen.current) return;
    seen.current = true;
    track('chat_welcome_shown', { audience });
  }, [shown, audience]);

  useEffect(() => {
    if (!trial || !canManage || !brandId) return;
    let current = true;
    void getSuggestionSourceStates(brandId)
      .then((states) => {
        if (!current) return;
        setConnect({
          brandId,
          value: {
            gsc: states.gsc.configured && !states.gsc.connected,
            ga: states.ga.configured && !states.ga.connected,
          },
        });
      })
      .catch(() => {
        if (current) setConnect(null);
      });
    return () => {
      current = false;
    };
  }, [trial, canManage, brandId]);

  const dismiss = () => {
    setHidden(true);
    track('chat_welcome_dismissed', { audience });
    void dismissChatWelcome()
      .catch(() => ({ ok: false as const }))
      .then((kept) => {
        if (kept.ok) return;
        setHidden(false);
        toast.error(t('dismissFailed'));
      });
  };

  return {
    shown,
    trial,
    run: trial ? run : null,
    connect: trial && canManage && connect?.brandId === brandId ? connect.value : null,
    dismiss,
  };
}
