'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { getSwapOptions, swapPrompts, type SwapOptions } from '@/lib/actions/prompt-swap';
import { track } from '@/lib/analytics';
import { firstPicks, spotsFreed, spotsShort, type PauseCandidate } from '@/lib/prompt-swap';
import { cn } from '@/lib/utils';
import { useMenuStateStore } from '@/stores/use-menu-state-store';
import { PlanLimitButtons } from './_plan-limit-buttons';

/** Candidates listed, unless the first picks need more. */
const SHOWN = 5;

type Load =
  | { promptId: string; status: 'ready'; options: SwapOptions }
  | { promptId: string; status: 'failed' };

/**
 * The Prompt-limit dialog (mockup Prompt-limit, SIMPLE_NAV): a prompt that
 * waits for a spot (or a paused one that doesn't fit back), the plan's
 * numbers, and the tracked prompts the person could pause for it, the
 * least useful first, this brand's before the workspace's other brands'.
 * "Pause it and track this one" swaps them in one go (swapPrompts); a
 * prompt in several locations needs that many spots, so it may take more
 * than one. With room already free, it just tracks it. Admins and managers
 * only: the page opens it for them alone.
 */
export function PromptLimitDialog({
  promptId,
  onClose,
  onDone,
}: {
  /** The prompt to make room for; null keeps the dialog closed. */
  promptId: string | null;
  onClose: () => void;
  /** After it was tracked: the page reads its prompts again. */
  onDone: () => void;
}) {
  const t = useTranslations('prompts.waiting.dialog');
  const format = useFormatter();
  const [load, setLoad] = useState<Load | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!promptId) return;
    let cancelled = false;
    getSwapOptions(promptId).then(
      (result) => {
        if (cancelled) return;
        if ('error' in result) {
          setLoad({ promptId, status: 'failed' });
          return;
        }
        setLoad({ promptId, status: 'ready', options: result });
        const short = spotsShort(result.prompt.locations, freeOf(result));
        setPicked(new Set(firstPicks(result.candidates, short) ?? []));
      },
      () => {
        if (!cancelled) setLoad({ promptId, status: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [promptId, attempt]);

  const ready = load?.promptId === promptId && load?.status === 'ready' ? load.options : null;
  const failed = load?.promptId === promptId && load?.status === 'failed';
  const short = ready ? spotsShort(ready.prompt.locations, freeOf(ready)) : 0;
  const shown = useMemo(() => {
    if (!ready) return [];
    const first = firstPicks(ready.candidates, short)?.length ?? 0;
    return ready.candidates.slice(0, Math.max(SHOWN, first));
  }, [ready, short]);
  // One spot short: any one pick does it, so one is picked at a time.
  const single = short <= 1;
  const enough = ready !== null && spotsFreed(ready.candidates, picked) >= short;

  const close = () => {
    if (!busy) onClose();
  };

  const swap = async () => {
    if (!ready || !enough) return;
    setBusy(true);
    const pauses = short > 0 ? [...picked] : [];
    const result = await swapPrompts(ready.prompt.id, pauses).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      track('prompt_swap', { result: pauses.length > 0 ? 'swapped' : 'tracked' });
      toast.success(t('swapped', { count: result.paused, text: ready.prompt.text }));
      // The menu reads its dots again on the next page, not in 5 minutes.
      useMenuStateStore.setState((s) => (s.read ? { read: { ...s.read, at: 0 } } : {}));
      onDone();
      onClose();
      return;
    }
    track('prompt_swap', { result: result?.code ?? 'failed' });
    const restored =
      result?.restored === undefined
        ? undefined
        : result.restored
          ? t('restored')
          : t('notRestored');
    toast.error(result?.code === 'not_enough' ? t('notEnough') : t('failed'), {
      description: restored ?? result?.error,
    });
    // What is free may have changed: read it again.
    setAttempt((a) => a + 1);
    if (result?.restored === false) onDone();
  };

  return (
    <Dialog open={promptId !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="gap-4 p-6 sm:max-w-[620px]">
        {ready ? (
          <Ready
            options={ready}
            short={short}
            shown={shown}
            single={single}
            picked={picked}
            onPick={(id, on) =>
              setPicked((current) => {
                if (single) return new Set([id]);
                const next = new Set(current);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            format={format}
          />
        ) : failed ? (
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('loadFailed')}</DialogDescription>
          </DialogHeader>
        ) : (
          <DialogHeader>
            <DialogTitle className="sr-only">{t('title')}</DialogTitle>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-2 h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </DialogHeader>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          {failed ? (
            <Button onClick={() => setAttempt((a) => a + 1)}>{t('retry')}</Button>
          ) : (
            <Button onClick={swap} disabled={!ready || !enough || busy}>
              {busy && <Loader2 className="animate-spin" />}
              {short === 0
                ? t('trackNow')
                : picked.size > 1
                  ? t('pauseMany', { count: picked.size })
                  : t('pauseOne')}
            </Button>
          )}
          {ready && short > 0 && (
            <PlanLimitButtons
              planId={ready.plan.id}
              source="dialog"
              growthPrompts={ready.growthPrompts}
            />
          )}
          <span className="grow" />
          <Button
            variant="ghost"
            className="text-muted-foreground underline underline-offset-2"
            onClick={close}
            disabled={busy}
          >
            {ready && !ready.prompt.waiting ? t('keepPaused') : t('keepWaiting')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Spots free on the plan; null when it has no limit. */
function freeOf(options: SwapOptions): number | null {
  return options.plan.max === -1 ? null : Math.max(0, options.plan.max - options.plan.used);
}

/** The dialog's body once read: what waits, the plan's numbers, what could be paused. */
function Ready({
  options,
  short,
  shown,
  single,
  picked,
  onPick,
  format,
}: {
  options: SwapOptions;
  short: number;
  shown: PauseCandidate[];
  single: boolean;
  picked: ReadonlySet<string>;
  onPick: (id: string, on: boolean) => void;
  format: ReturnType<typeof useFormatter>;
}) {
  const t = useTranslations('prompts.waiting.dialog');
  const { prompt, plan } = options;
  const n = (value: number) => format.number(value);
  const what = prompt.waiting
    ? t('waitingIs', { text: prompt.text })
    : t('pausedIs', { text: prompt.text });

  if (short === 0) {
    return (
      <DialogHeader>
        <DialogTitle className="text-xl font-bold">{t('titleRoom')}</DialogTitle>
        <DialogDescription className="leading-relaxed">
          {what} {t('room')}
        </DialogDescription>
      </DialogHeader>
    );
  }

  return (
    <>
      <DialogHeader className="gap-2">
        <span className="self-start rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 tabular-nums dark:text-amber-300">
          {t('pill', { used: n(plan.used), max: n(plan.max) })}
        </span>
        <DialogTitle className="text-xl font-bold">
          {prompt.waiting ? t('title') : t('titlePaused')}
        </DialogTitle>
        <DialogDescription className="leading-relaxed">
          {what}{' '}
          {t('limit', {
            plan: plan.name,
            max: n(plan.max),
            used: n(plan.used),
            full: plan.used >= plan.max ? 'yes' : 'no',
          })}{' '}
          {prompt.locations > 1 && <>{t('needs', { count: n(prompt.locations) })} </>}
          {plan.id === 'starter' ? t('howStarter') : t('howContact')}
        </DialogDescription>
      </DialogHeader>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">
          {single ? t('candidates') : t('candidatesMany', { count: n(short) })}
        </legend>
        {shown.length === 0 ? (
          <p className="text-muted-foreground">{t('noCandidates')}</p>
        ) : (
          <>
            {shown.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                single={single}
                checked={picked.has(candidate.id)}
                onPick={onPick}
              />
            ))}
            <p className="text-xs text-muted-foreground">{t('order')}</p>
          </>
        )}
      </fieldset>
    </>
  );
}

/** One prompt that could be paused: its text, demand, how often AI named the brand, and where. */
function CandidateRow({
  candidate,
  single,
  checked,
  onPick,
}: {
  candidate: PauseCandidate;
  single: boolean;
  checked: boolean;
  onPick: (id: string, on: boolean) => void;
}) {
  const t = useTranslations('prompts.waiting.dialog');
  const meta = [
    t(`demand.${candidate.demand ?? 'none'}`),
    candidate.answers > 0 ? t('named', { count: candidate.mentions }) : t('noAnswers'),
    candidate.locations > 1 ? t('locations', { count: candidate.locations }) : null,
    candidate.current ? null : candidate.brandName,
  ].filter(Boolean);
  return (
    <label
      data-candidate={candidate.id}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors hover:bg-muted/40',
        checked && 'border-foreground',
      )}
    >
      <input
        type={single ? 'radio' : 'checkbox'}
        name="pause"
        checked={checked}
        onChange={(e) => onPick(candidate.id, e.target.checked)}
        className="size-4 shrink-0 accent-foreground"
      />
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="font-medium">{candidate.text}</span>
        <span className="text-xs text-muted-foreground">{meta.join(' · ')}</span>
      </span>
    </label>
  );
}
