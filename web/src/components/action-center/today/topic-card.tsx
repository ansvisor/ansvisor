'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import {
  TOPIC_PROMPTS,
  snoozeUntil,
  waitingMarks,
  type TopicCandidate,
} from '@/lib/action-center/topic-card';
import {
  getTodayTopic,
  openTopicCard,
  trackTopicPrompts,
  writeTopicPrompts,
  type TodayTopic,
} from '@/lib/actions/today-topic';
import { hideCard } from '@/lib/actions/user-brand-state';
import { topicKey } from '@/lib/user-brand-state';
import { useUserRole } from '@/hooks/use-user-role';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useDemoBrand } from '@/components/providers/demo-brand-provider';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { useWaitingForSpotToast } from '@/components/prompts/waiting-for-spot';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TodaySkeleton } from './today-parts';
import { useTodayRead } from './use-today';

type Topic = { id: string; name: string };
type Prompt = { ideaId: string | null; text: string };

/** Where the card is: its offer, then the prompts to tick, then what was added. */
type Step =
  | { kind: 'offer' }
  | { kind: 'opening' }
  | { kind: 'writing'; topic: Topic }
  | { kind: 'writeFailed'; topic: Topic }
  | { kind: 'pick'; topic: Topic; prompts: Prompt[]; written: boolean }
  | { kind: 'done'; topic: Topic; added: number; waiting: number }
  | { kind: 'gone' };

const topicHref = (id: string) => `/dashboard/prompts/topics/${encodeURIComponent(id)}`;

/**
 * "New area to track" on Action Center › Today (mockup
 * Bugun-pazartesi): a topic the brand doesn't track yet, why it is worth
 * tracking, and the prompt spots it needs. The page shows it on the
 * person's Monday or once today's focus is finished; it is for admins and
 * managers with Prompts on their menu, on a plan with topic suggestions,
 * and never on the demo brand. "Suggest 5 prompts" makes the topic, lists
 * its stored ideas (or, with none, has the per-topic generator write 5 on
 * this click), and tracks the ones ticked: past the plan's spots they wait
 * for a spot. "Not now" snoozes the topic for the person for 30 days.
 */
export function TopicCard({ brandId }: { brandId: string }) {
  const { canManage } = useUserRole();
  const hidden = useHiddenMenuSections();
  const { canUse } = useFeatureGate();
  const { isDemo } = useDemoBrand();
  const allowed = canManage && !hidden.has('prompts') && !isDemo && canUse('topic_suggestions');
  const load = useTodayRead(allowed ? brandId : null, () => getTodayTopic(brandId));
  const data = load.status === 'ready' ? load.data : null;

  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (!data || shown.current.has(`${brandId}:${data.candidate.key}`)) return;
    shown.current.add(`${brandId}:${data.candidate.key}`);
    track('today_topic_card_shown', { source: data.candidate.source });
  }, [brandId, data]);

  if (!allowed || !data) return null;
  return <TopicCardBody key={`${brandId}:${data.candidate.key}`} brandId={brandId} data={data} />;
}

function TopicCardBody({ brandId, data }: { brandId: string; data: TodayTopic }) {
  const t = useTranslations('topicCard');
  const tWaiting = useTranslations('prompts.waiting');
  const showWaiting = useWaitingForSpotToast();
  const { candidate, spots } = data;
  const [step, setStep] = useState<Step>({ kind: 'offer' });
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const source = { source: candidate.source };

  const write = async (topic: Topic) => {
    setStep({ kind: 'writing', topic });
    const written = await writeTopicPrompts(brandId, topic.id).catch(() => null);
    if (!written?.ok) {
      setStep({ kind: 'writeFailed', topic });
      return;
    }
    setTicked(new Set(written.prompts.map((_, i) => i)));
    setStep({
      kind: 'pick',
      topic,
      prompts: written.prompts.map((text) => ({ ideaId: null, text })),
      written: true,
    });
  };

  const suggest = async () => {
    track('today_topic_suggest_clicked', source);
    setStep({ kind: 'opening' });
    const opened = await openTopicCard(brandId, {
      name: candidate.name,
      suggestionId: candidate.catalog?.suggestionId ?? candidate.llmSuggestionId,
      topicId: candidate.topicId,
    }).catch(() => null);
    if (!opened?.ok) {
      toast.error(t('openFailed'));
      setStep({ kind: 'offer' });
      return;
    }
    // The topic's stored ideas first; only without any does the generator write some.
    if (opened.ideas.length === 0) {
      await write(opened.topic);
      return;
    }
    setTicked(new Set(opened.ideas.map((_, i) => i)));
    setStep({
      kind: 'pick',
      topic: opened.topic,
      prompts: opened.ideas.map((idea) => ({ ideaId: idea.id, text: idea.text })),
      written: false,
    });
  };

  const notNow = async () => {
    track('today_topic_not_now', source);
    const before = step;
    setStep({ kind: 'gone' });
    const kept = await hideCard(brandId, topicKey(candidate.key), snoozeUntil(new Date())).catch(
      () => ({ ok: false }),
    );
    if (!kept.ok) {
      setStep(before);
      toast.error(t('notNowFailed'));
    }
  };

  const trackPicked = async (topic: Topic, prompts: Prompt[]) => {
    const picks = prompts.filter((_, i) => ticked.has(i));
    setBusy(true);
    const result = await trackTopicPrompts(brandId, topic.id, picks).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      toast.error(result && !result.ok && result.error ? result.error : t('trackFailed'));
      return;
    }
    showWaiting('topic_card', result.added, result.waiting);
    setStep({ kind: 'done', topic, added: result.added, waiting: result.waiting });
  };

  if (step.kind === 'gone') return null;
  const title =
    step.kind === 'pick' || step.kind === 'done' || step.kind === 'writing'
      ? step.topic.name
      : candidate.name;

  return (
    <section
      aria-labelledby="today-topic-title"
      data-today-part="topic"
      className="space-y-3 rounded-xl border border-dashed p-5"
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('eyebrow')}
        </p>
        <h2 id="today-topic-title" className="text-base font-semibold">
          {title}
        </h2>
      </div>

      {(step.kind === 'offer' || step.kind === 'opening') && (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <Why candidate={candidate} />
          </p>
          <p className="text-xs text-muted-foreground">
            {spots
              ? t('spots', { count: TOPIC_PROMPTS, left: spots.left, plan: spots.plan })
              : t('spotsOpen', { count: TOPIC_PROMPTS })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={step.kind === 'opening'}
              onClick={() => void suggest()}
              data-action="today.topicSuggest"
            >
              {step.kind === 'opening' ? t('opening') : t('suggest', { count: TOPIC_PROMPTS })}
            </Button>
            <NotNow onClick={() => void notNow()} disabled={step.kind === 'opening'} />
          </div>
        </>
      )}

      {step.kind === 'writing' && (
        <>
          <p className="text-sm text-muted-foreground">{t('writing', { count: TOPIC_PROMPTS })}</p>
          <TodaySkeleton lines={3} />
        </>
      )}

      {step.kind === 'writeFailed' && (
        <>
          <p className="text-sm text-muted-foreground">{t('writeFailed')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void write(step.topic)}>
              {t('tryAgain')}
            </Button>
            <NotNow onClick={() => void notNow()} />
          </div>
        </>
      )}

      {step.kind === 'pick' && (
        <PickPrompts
          step={step}
          ticked={ticked}
          left={spots?.left ?? null}
          busy={busy}
          onTick={(index, on) =>
            setTicked((prev) => {
              const next = new Set(prev);
              if (on) next.add(index);
              else next.delete(index);
              return next;
            })
          }
          onTrack={() => void trackPicked(step.topic, step.prompts)}
          onNotNow={() => void notNow()}
          overNote={(count) => tWaiting('overNote', { count })}
        />
      )}

      {step.kind === 'done' && (
        <>
          <p className="text-sm">
            {step.waiting === 0
              ? t('done.tracked', { count: step.added, topic: step.topic.name })
              : step.added === 0
                ? t('done.allWaiting', { count: step.waiting, topic: step.topic.name })
                : t('done.some', {
                    added: step.added,
                    waiting: step.waiting,
                    topic: step.topic.name,
                  })}
          </p>
          <Link
            href={topicHref(step.topic.id)}
            className="inline-block text-sm font-semibold underline underline-offset-2"
          >
            {t('openTopic')}
          </Link>
        </>
      )}
    </section>
  );
}

/** Why the topic is worth tracking, from the evidence stored for it. */
function Why({ candidate }: { candidate: TopicCandidate }) {
  const t = useTranslations('topicCard.why');
  const sources = candidate.search?.sources ?? [];
  const lines = [
    t('lead'),
    candidate.catalog
      ? t('catalog', { count: candidate.catalog.products, category: candidate.catalog.category })
      : null,
    candidate.search
      ? t('search', {
          count: candidate.search.count,
          source: sources.length === 1 ? sources[0] : 'both',
        })
      : null,
    candidate.businessHub ? t('businessHub') : null,
    candidate.llmSuggestionId ? t('llm') : null,
    candidate.competitors.length > 0
      ? t('competitors', {
          names: new Intl.ListFormat('en-US', { type: 'conjunction' }).format(
            candidate.competitors,
          ),
        })
      : null,
  ];
  return <>{lines.filter(Boolean).join(' ')}</>;
}

function NotNow({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  const t = useTranslations('topicCard');
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground underline underline-offset-2"
    >
      {t('notNow')}
    </Button>
  );
}

/**
 * The prompts to tick, all ticked to start. Past the spots left on the
 * plan, a ticked prompt is marked: it is saved waiting for a spot.
 */
function PickPrompts({
  step,
  ticked,
  left,
  busy,
  onTick,
  onTrack,
  onNotNow,
  overNote,
}: {
  step: Extract<Step, { kind: 'pick' }>;
  ticked: ReadonlySet<number>;
  /** Spots left across the workspace; null when unlimited or unread. */
  left: number | null;
  busy: boolean;
  onTick: (index: number, on: boolean) => void;
  onTrack: () => void;
  onNotNow: () => void;
  overNote: (count: number) => string;
}) {
  const t = useTranslations('topicCard');
  if (step.prompts.length === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground">{t('noneNew')}</p>
        <Link
          href={topicHref(step.topic.id)}
          className="inline-block text-sm font-semibold underline underline-offset-2"
        >
          {t('openTopic')}
        </Link>
      </>
    );
  }
  const waits = waitingMarks(step.prompts.length, ticked, left);
  const waitCount = waits.filter(Boolean).length;
  return (
    <>
      <p className="text-sm text-muted-foreground">{step.written ? t('written') : t('stored')}</p>
      <ul className="space-y-2">
        {step.prompts.map((prompt, i) => {
          const id = `today-topic-prompt-${i}`;
          return (
            <li key={id} data-topic-prompt={i} className="flex items-start gap-2.5 text-sm">
              <Checkbox
                id={id}
                checked={ticked.has(i)}
                disabled={busy}
                onCheckedChange={(on) => onTick(i, on === true)}
                className="mt-0.5"
              />
              <label htmlFor={id} className="min-w-0 flex-1 leading-snug">
                {prompt.text}
                {waits[i] && (
                  <span
                    data-waits
                    className="ml-2 inline-flex h-5 items-center rounded-full border border-amber-500/40 px-1.5 align-middle text-[11px] font-medium text-amber-700 dark:text-amber-400"
                  >
                    {t('waits')}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {waitCount > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{overNote(waitCount)}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || ticked.size === 0}
          onClick={onTrack}
          data-action="today.topicTrack"
        >
          {t('track', { count: ticked.size })}
        </Button>
        <NotNow onClick={onNotNow} disabled={busy} />
      </div>
    </>
  );
}
