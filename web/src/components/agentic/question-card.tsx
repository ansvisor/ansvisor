'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarRange, Check, Loader2, MessageCircleQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomRangeFields } from '@/components/chat/range/range-picker';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { ANSWER_MAX } from '@/lib/chat/asks';
import type { ChatAsk } from '@/lib/chat/events';
import { cn } from '@/lib/utils';
import { AgentCard, AgentCardBody, AgentCardFooter, AgentCardHeader, CardPill } from './agent-card';
import { DoneTick } from './done-tick';

/** What the person answered: the options picked by place, the text typed in Other…, or Skip. */
export interface QuestionAnswerValue {
  selected: number[];
  other: string | null;
  skipped: boolean;
}

interface QuestionCardProps {
  ask: ChatAsk;
  status?: 'pending' | 'saving' | 'error';
  error?: string;
  onAnswer: (answer: QuestionAnswerValue) => void;
}

/**
 * The question card (CHAT-07 §A): the model's questions and the engine's
 * own (ChoiceQuestionCard), or the engine's range card (RangeQuestionCard).
 */
export function QuestionCard(props: QuestionCardProps) {
  return props.ask.dateRange ? <RangeQuestionCard {...props} /> : <ChoiceQuestionCard {...props} />;
}

/**
 * The range card (the engine's own question, owner request 2026-11-11):
 * "Which time range should I use?" with a button per range, each one click,
 * no Next: the page's own range first in the side panel, then Last 24 hours,
 * Last 7 days, Last 30 days and Last 90 days, and Custom, which opens two
 * days and "Use these dates" (sent as Other, "YYYY-MM-DD/YYYY-MM-DD").
 * Number keys pick a range, the last one opens Custom. Skip goes on with
 * the Recommended range for this answer only. Through the read-only gate,
 * as every answer.
 */
function RangeQuestionCard({ ask, status = 'pending', error, onAnswer }: QuestionCardProps) {
  const t = useTranslations('agentic.questionCard');
  const tr = useTranslations('chatRange');
  const { guard } = useUpgradeGate();
  const titleId = useId();
  const card = useRef<HTMLElement>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [clicked, setClicked] = useState<number | 'custom' | null>(null);
  const busy = status === 'saving';
  const rows = ask.options.length + 1;

  useEffect(() => {
    if (document.activeElement?.closest('input, textarea, [contenteditable="true"]')) return;
    card.current?.focus({ preventScroll: true });
  }, [ask.n]);

  const answer = guard((value: QuestionAnswerValue) => onAnswer(value), {
    action: t('answerNeedsPlan'),
  });
  const pick = (i: number) => {
    if (busy) return;
    setClicked(i);
    answer({ selected: [i], other: null, skipped: false });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
    const n = Number.parseInt(event.key, 10);
    if (!Number.isInteger(n) || n < 1 || n > rows) return;
    event.preventDefault();
    if (n <= ask.options.length) pick(n - 1);
    else setCustomOpen(true);
  };

  return (
    <AgentCard
      ref={card}
      tone="needsYou"
      tabIndex={-1}
      aria-labelledby={titleId}
      data-slot="question-card"
      data-kind="range"
      onKeyDown={onKeyDown}
      className="outline-none"
    >
      <AgentCardHeader
        titleId={titleId}
        lead={
          <CalendarRange
            aria-hidden
            className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
          />
        }
        title={ask.question}
        end={ask.batch ? <CardPill>{t('counter', ask.batch)}</CardPill> : undefined}
      />
      <AgentCardBody className="pt-2.5">
        {ask.then && <p className="mt-0 mb-2 text-[13px] text-muted-foreground">{ask.then}</p>}
        <div role="group" aria-labelledby={titleId} className="flex flex-wrap gap-1.5">
          {ask.options.map((option, i) => (
            <Button
              key={`${i}-${option.label}`}
              type="button"
              variant="outline"
              size="sm"
              data-action="question.pickRange"
              disabled={busy}
              aria-busy={(busy && clicked === i) || undefined}
              onClick={() => pick(i)}
              className="h-auto min-h-8 py-1 whitespace-normal"
            >
              {busy && clicked === i && (
                <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              )}
              {option.label}
            </Button>
          ))}
          {ask.allowOther && (
            <Button
              type="button"
              variant={customOpen ? 'secondary' : 'outline'}
              size="sm"
              data-action="question.customRange"
              disabled={busy}
              aria-expanded={customOpen}
              onClick={() => setCustomOpen((open) => !open)}
              className="h-auto min-h-8 py-1"
            >
              {tr('customButton')}
            </Button>
          )}
        </div>
        {ask.allowOther && customOpen && (
          <CustomRangeFields
            busy={busy}
            action="question.useDates"
            className="mt-2.5"
            onUse={(range) => {
              setClicked('custom');
              answer({ selected: [], other: range, skipped: false });
            }}
          />
        )}
        {status === 'error' && error && (
          <p role="alert" className="mt-2 mb-0 text-[12.5px] text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </AgentCardBody>
      <AgentCardFooter note={tr('pressToPick', { max: rows })}>
        <Button
          type="button"
          variant="link"
          data-action="question.skip"
          disabled={busy}
          onClick={() => answer({ selected: [], other: null, skipped: true })}
          className="text-muted-foreground"
        >
          {t('skip')}
        </Button>
      </AgentCardFooter>
    </AgentCard>
  );
}

/**
 * A question with options (CHAT-07 §A): the question, with its place in a
 * batch ("1 of 2"), and 2–4 options, each with its key, label, detail and
 * cost multiplier, the Recommended one marked and picked to start with; an
 * Other… row with Add when the card offers it, whose text counts without
 * Add. One option, or several when `multi`: each row then has a check box,
 * and the footer says "Pick one or more" (the mockup's words). Number keys
 * pick a row (the Other row's focuses its field); Enter on the card is Next,
 * on a button that button's own; keys do nothing while a field has focus.
 * The card takes focus when it appears, unless the person is typing. Skip
 * goes on with the Recommended option; Next is off with nothing picked; both
 * go through the read-only gate. Built on the approval card's parts
 * (`#s-need`).
 */
function ChoiceQuestionCard({ ask, status = 'pending', error, onAnswer }: QuestionCardProps) {
  const t = useTranslations('agentic.questionCard');
  const { guard } = useUpgradeGate();
  const titleId = useId();
  const card = useRef<HTMLElement>(null);
  const otherField = useRef<HTMLInputElement>(null);
  const recommended = Math.max(
    0,
    ask.options.findIndex((option) => option.recommended),
  );
  const [picked, setPicked] = useState<number[]>([recommended]);
  const [draft, setDraft] = useState('');
  const [other, setOther] = useState<string | null>(null);
  const busy = status === 'saving';
  const rows = ask.options.length + (ask.allowOther ? 1 : 0);
  // Text in Other… counts once typed, Add or not: Next takes it.
  const typed = other ?? (draft.trim() || null);
  const chosen = picked.length > 0 || !!typed;

  // The card takes focus as it appears, for its keys (§A item 3), unless the
  // person is typing in a field: their text stays where it is.
  useEffect(() => {
    if (document.activeElement?.closest('input, textarea, [contenteditable="true"]')) return;
    card.current?.focus({ preventScroll: true });
  }, [ask.n]);

  const pick = (i: number) => {
    if (busy) return;
    if (ask.multi) {
      setPicked((was) => (was.includes(i) ? was.filter((x) => x !== i) : [...was, i].sort()));
    } else {
      setPicked([i]);
      setOther(null);
    }
  };
  const addOther = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setOther(text);
    if (!ask.multi) setPicked([]);
  };
  // An answer goes on with the run's change: the read-only gate first.
  const answer = guard((value: QuestionAnswerValue) => onAnswer(value), {
    action: t('answerNeedsPlan'),
  });
  const next = () => {
    if (!chosen || busy) return;
    // One pick only: text typed in Other… is the answer over the option picked.
    const selected = typed && !ask.multi ? [] : picked;
    answer({ selected, other: typed, skipped: false });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    // Keys belong to a field while it has focus.
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    if (event.key === 'Enter') {
      // Enter on Skip, Add or an option is that button's own: only the card's is Next.
      if (target !== event.currentTarget && target.closest('button, a')) return;
      event.preventDefault();
      next();
      return;
    }
    const n = Number.parseInt(event.key, 10);
    if (!Number.isInteger(n) || n < 1 || n > rows) return;
    event.preventDefault();
    if (n <= ask.options.length) pick(n - 1);
    else otherField.current?.focus();
  };

  return (
    <AgentCard
      ref={card}
      tone="needsYou"
      tabIndex={-1}
      aria-labelledby={titleId}
      data-slot="question-card"
      onKeyDown={onKeyDown}
      className="outline-none"
    >
      <AgentCardHeader
        titleId={titleId}
        lead={
          <MessageCircleQuestion
            aria-hidden
            className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
          />
        }
        title={ask.question}
        end={ask.batch ? <CardPill>{t('counter', ask.batch)}</CardPill> : undefined}
      />
      <AgentCardBody className="pt-2.5">
        {ask.then && <p className="mt-0 mb-2 text-[13px] text-muted-foreground">{ask.then}</p>}
        <div
          role={ask.multi ? 'group' : 'radiogroup'}
          aria-labelledby={titleId}
          className="grid gap-1.5"
        >
          {ask.options.map((option, i) => {
            const on = picked.includes(i);
            return (
              <button
                key={`${i}-${option.label}`}
                type="button"
                role={ask.multi ? 'checkbox' : 'radio'}
                aria-checked={on}
                data-action="question.pick"
                disabled={busy}
                onClick={() => pick(i)}
                className={cn(
                  'grid min-h-[44px] w-full grid-cols-[22px_minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
                  on && 'border-foreground bg-muted/40',
                )}
              >
                <kbd
                  aria-hidden
                  className={cn(
                    'flex size-[22px] items-center justify-center rounded-md border font-sans text-[11.5px] text-muted-foreground',
                    on && 'border-foreground bg-foreground text-background',
                  )}
                >
                  {i + 1}
                </kbd>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium">{option.label}</span>
                  {option.recommended && (
                    <span className="ml-1.5 inline-flex rounded-full bg-green-100 px-[7px] py-px align-[1px] text-[10.5px] leading-[14px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
                      {t('recommended')}
                    </span>
                  )}
                  {option.detail && (
                    <span className="block text-xs text-muted-foreground">{option.detail}</span>
                  )}
                </span>
                {option.costMultiplier !== undefined ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t('multiplier', { times: option.costMultiplier })}
                  </span>
                ) : (
                  <span aria-hidden />
                )}
                {ask.multi ? (
                  <span
                    aria-hidden
                    data-slot="question-check"
                    className={cn(
                      'flex size-4 items-center justify-center rounded-[4px] border',
                      on && 'border-foreground bg-foreground text-background',
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                ) : (
                  <span aria-hidden />
                )}
              </button>
            );
          })}
          {ask.allowOther && (
            <div
              className={cn(
                'grid min-h-[44px] grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-2.5 py-1.5',
                other && 'border-foreground bg-muted/40',
              )}
            >
              <kbd
                aria-hidden
                className="flex size-[22px] items-center justify-center rounded-md border font-sans text-[11.5px] text-muted-foreground"
              >
                {rows}
              </kbd>
              <input
                ref={otherField}
                data-action="question.other"
                aria-label={t('otherLabel')}
                placeholder={t('other')}
                maxLength={ANSWER_MAX}
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addOther();
                  }
                }}
                className="min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-action="question.addOther"
                disabled={busy || !draft.trim()}
                onClick={addOther}
              >
                {t('add')}
              </Button>
            </div>
          )}
        </div>
        {status === 'error' && error && (
          <p role="alert" className="mt-2 mb-0 text-[12.5px] text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </AgentCardBody>
      <AgentCardFooter note={t(ask.multi ? 'pickSeveral' : 'pressToPick', { max: rows })}>
        <Button
          type="button"
          variant="link"
          data-action="question.skip"
          disabled={busy}
          onClick={() => answer({ selected: [], other: null, skipped: true })}
          className="text-muted-foreground"
        >
          {t('skip')}
        </Button>
        <Button
          type="button"
          data-action="question.next"
          disabled={!chosen || busy}
          aria-busy={busy || undefined}
          onClick={next}
        >
          {busy && <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />}
          {t('next')}
        </Button>
      </AgentCardFooter>
    </AgentCard>
  );
}

/**
 * An answered question, folded to one read-only line (CHAT-07 §A item 10):
 * a tick, the question, and the answer on the right ("Skipped · used …").
 */
export function QuestionAnswered({ question, answer }: { question: string; answer: string }) {
  return (
    <div
      data-slot="question-answered"
      className="my-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border px-3 py-[9px] text-[13px]"
    >
      <DoneTick size="sm" decorative />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{question}</span>
      <span className="font-medium [overflow-wrap:anywhere]">{answer}</span>
    </div>
  );
}
