'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import { useUserRole } from '@/hooks/use-user-role';
import { addPromptToBrand, setPromptActive } from '@/lib/actions/prompt';
import { acceptSuggestion } from '@/lib/actions/prompt-suggestions';
import { getGettingStarted } from '@/lib/actions/getting-started';
import { hideCard } from '@/lib/actions/user-brand-state';
import { markPromptsChecked, type TodayFirstDay } from '@/lib/actions/today-first-day';
import { isCardHidden } from '@/lib/user-brand-state';
import { PROMPTS_CHECK_STEP } from '@/lib/action-center/first-day';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { useChatTour } from '@/components/chat/tour/chat-tour';
import { Button } from '@/components/ui/button';
import { TodaySection, TodaySkeleton } from './today-parts';
import { useTodayRead, type TodayLoad, type TodayVisit } from './use-today';

const TRACKED_HREF = '/dashboard/prompts/tracked';

/** The set-up steps "While you wait" offers, with the words the mockup gives them. */
const WAIT_STEPS = ['gsc', 'kpis'] as const;

/**
 * Today on a brand's first day (mockup Bugun-ilk-gun), before
 * its first run is stamped: "Check the prompts we track for you" (remove
 * any that don't fit, add one, Looks good), "Worth tracking too" from the
 * suggestions already stored for the brand (hidden when there are none),
 * and "While you wait": the set-up steps still open and, with the new Chat
 * on, the 2-minute tour. Removing, adding and tracking are for admins and
 * managers, as on Tracked Prompts.
 */
export function FirstDayView({
  brandId,
  visit,
  load,
  reload,
}: {
  brandId: string;
  visit: TodayVisit;
  load: TodayLoad<TodayFirstDay>;
  reload: () => void;
}) {
  const { settle } = visit;
  const settled = load.status === 'loading' ? null : load.status;
  const count = load.status === 'ready' ? load.data.total : null;
  useEffect(() => {
    if (settled) settle('prompts', count);
  }, [settled, count, settle]);

  const data = load.status === 'ready' ? load.data : null;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {load.status === 'failed' ? (
        <div />
      ) : (
        <PromptsCheck brandId={brandId} visit={visit} data={data} reload={reload} />
      )}
      <div className="space-y-4">
        {data && data.suggestions.length > 0 && <WorthTracking data={data} reload={reload} />}
        <WhileYouWait brandId={brandId} />
      </div>
    </div>
  );
}

/** "Check the prompts we track for you", until someone says Looks good. */
function PromptsCheck({
  brandId,
  visit,
  data,
  reload,
}: {
  brandId: string;
  visit: TodayVisit;
  data: TodayFirstDay | null;
  reload: () => void;
}) {
  const t = useTranslations('actionCenter.today.firstDay.check');
  const { canManage } = useUserRole();
  const [removed, setRemoved] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const hiddenForMe = visit.state ? isCardHidden(visit.state.hidden, PROMPTS_CHECK_STEP) : false;
  if (done || hiddenForMe || data?.checked) return null;
  const engines = data?.engines.length ? data.engines : null;

  const remove = async (id: string) => {
    setRemoved((ids) => [...ids, id]);
    const result = await setPromptActive(id, false).catch(() => ({ error: 'failed' }));
    if (result && 'error' in result && result.error) {
      setRemoved((ids) => ids.filter((other) => other !== id));
      toast.error(t('removeFailed'));
      return;
    }
    track('today_prompt_removed');
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!data || !text.trim()) return;
    setBusy(true);
    const result = await addPromptToBrand(brandId, {
      text,
      platforms: data.platforms,
      models: data.models,
    }).catch(() => ({ error: t('addFailed') }));
    setBusy(false);
    if ('error' in result) {
      toast.error(result.error || t('addFailed'));
      return;
    }
    setText('');
    setAdding(false);
    reload();
  };

  const looksGood = async () => {
    setBusy(true);
    const kept = canManage
      ? await markPromptsChecked(brandId).catch(() => ({ ok: false }))
      : await hideCard(brandId, PROMPTS_CHECK_STEP, null);
    setBusy(false);
    if (!kept.ok) {
      toast.error(t('checkFailed'));
      return;
    }
    track('today_prompts_checked');
    setDone(true);
  };

  const prompts = (data?.prompts ?? []).filter((prompt) => !removed.includes(prompt.id));
  return (
    <TodaySection
      part="prompts"
      title={t('title')}
      sub={engines ? t('body', { engines: listOf(engines) }) : t('bodyGeneric')}
    >
      {!data ? (
        <TodaySkeleton lines={4} />
      ) : (
        <>
          <ul>
            {prompts.map((prompt) => (
              <li
                key={prompt.id}
                data-prompt-id={prompt.id}
                className="flex items-center gap-3 border-t py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-medium">{prompt.text}</span>
                  {(prompt.topic || prompt.demand) && (
                    <span className="block text-xs text-muted-foreground">
                      {[prompt.topic, prompt.demand ? t(`demand.${prompt.demand}`) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void remove(prompt.id)}
                    aria-label={t('remove')}
                    title={t('remove')}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {adding && (
            <form onSubmit={add} className="flex gap-2">
              <label htmlFor="today-add-prompt" className="sr-only">
                {t('addLabel')}
              </label>
              <input
                id="today-add-prompt"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t('addPlaceholder')}
                className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="sm" disabled={busy || !text.trim()}>
                {t('addSave')}
              </Button>
            </form>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <Link
              href={TRACKED_HREF}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {t('showAll', { count: data.total })}
            </Link>
            <span className="flex-1" />
            {canManage && !adding && (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                {t('add')}
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => void looksGood()}>
              {t('looksGood')}
            </Button>
          </div>
        </>
      )}
    </TodaySection>
  );
}

/** "ChatGPT and Google Gemini". */
function listOf(items: string[]): string {
  return new Intl.ListFormat('en-US', { type: 'conjunction' }).format(items);
}

/** "Worth tracking too": suggestions already stored for the brand, with the spots left. */
function WorthTracking({ data, reload }: { data: TodayFirstDay; reload: () => void }) {
  const t = useTranslations('actionCenter.today.firstDay.worth');
  const { canManage } = useUserRole();
  const [busy, setBusy] = useState<string | null>(null);
  const track_ = async (id: string) => {
    setBusy(id);
    const result = await acceptSuggestion(id).catch(() => ({ error: t('failed') }));
    setBusy(null);
    if (result && 'error' in result && result.error) {
      toast.error(typeof result.error === 'string' ? result.error : t('failed'));
      return;
    }
    reload();
  };
  return (
    <TodaySection
      part="worth"
      title={t('title')}
      sub={data.spots ? t('spots', data.spots) : t('body')}
    >
      <ul className="space-y-2.5 text-sm">
        {data.suggestions.map((suggestion) => (
          <li key={suggestion.id} className="flex items-center justify-between gap-3">
            <span>{suggestion.text}</span>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void track_(suggestion.id)}
              >
                {t('track')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </TodaySection>
  );
}

/** "While you wait · optional": open set-up steps, and the tour with Chat on. */
function WhileYouWait({ brandId }: { brandId: string }) {
  const t = useTranslations('actionCenter.today.firstDay.wait');
  const chatOn = useChatAgentic();
  const tour = useChatTour();
  const steps = useTodayRead(brandId, () => getGettingStarted(brandId));
  const all = steps.status === 'ready' && steps.data ? steps.data.steps : [];
  const open = WAIT_STEPS.flatMap(
    (key) => all.find((step) => step.key === key && step.state === 'new') ?? [],
  );
  const withTour = chatOn && Boolean(tour?.available);
  if (open.length === 0 && !withTour) return null;
  return (
    <TodaySection
      part="wait"
      title={
        <>
          {t('title')} <span className="font-normal text-muted-foreground">{t('optional')}</span>
        </>
      }
    >
      <ul className="space-y-2 text-sm">
        {open.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href}
              onClick={() => track('today_setup_step_clicked', { step: step.key })}
              className="flex justify-between gap-2 hover:underline"
            >
              <span>{t(`steps.${step.key as (typeof WAIT_STEPS)[number]}`)}</span>
              <span className="text-muted-foreground">
                {t(`minutes.${step.key as (typeof WAIT_STEPS)[number]}`)}
              </span>
            </Link>
          </li>
        ))}
        {withTour && (
          <li>
            <button
              type="button"
              onClick={() => void tour!.show('visibility', 'everything')}
              className="flex w-full justify-between gap-2 text-left hover:underline"
            >
              <span>{t('tour')}</span>
              <span className="text-muted-foreground">{t('tourMinutes')}</span>
            </button>
          </li>
        )}
      </ul>
    </TodaySection>
  );
}
