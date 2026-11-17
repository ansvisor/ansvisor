'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Minus, X } from 'lucide-react';
import { TickIcon } from '@/components/agentic/done-tick';
import { RunParts } from '@/components/agentic/run-parts';
import { workedParts } from '@/components/agentic/run-steps';
import type { ChatStep, ChatStepStatus } from '@/lib/chat/events';
import type { ClientRunStatus } from '@/lib/chat/run-state';
import { cn } from '@/lib/utils';
import { LIVE_DOT } from './run-live-line';
import { listedSteps, stepsSummary, type StepsSummary } from './run-view';

type Mark = ChatStepStatus | 'stopped';
type T = ReturnType<typeof useTranslations<'chatRun.stepsLine'>>;

/** A step's or the line's small mark: ✓ done, × failed, – skipped, a dot otherwise. */
function StepMark({ state, className }: { state: Mark; className?: string }) {
  return (
    <span
      aria-hidden
      data-mark={state}
      className={cn('inline-flex size-3.5 shrink-0 items-center justify-center', className)}
    >
      {state === 'done' ? (
        <TickIcon className="size-3 text-green-600 dark:text-green-500" />
      ) : state === 'error' ? (
        <X className="size-3 text-red-600 dark:text-red-400" />
      ) : state === 'skipped' ? (
        <Minus className="size-3" />
      ) : (
        <span
          className={cn(
            state === 'running' && LIVE_DOT,
            state === 'waiting' && 'size-1.5 rounded-full bg-amber-600 dark:bg-amber-400',
            state === 'stopped' && 'size-1.5 rounded-full bg-foreground/35',
            state === 'pending' && 'size-1.5 rounded-full border border-muted-foreground',
          )}
        />
      )}
    </span>
  );
}

/** "Worked for 41s", "Stopped after 1m 12s": the run's working time in words. */
export function useDurationWords() {
  const t = useTranslations('chatRun.live');
  return (ms: number) => {
    const { m, s } = workedParts(ms);
    return m > 0 ? t('minutes', { m, s }) : t('seconds', { s });
  };
}

/**
 * The run's steps as one grey line above the answer (CHAT-03 item 12d), set
 * apart from its white words: what the steps done did, from their kinds
 * ("✓ Read 3 sources", "✓ Read Citations · checked facts", "✓ 4 steps"),
 * and how many failed. While the run waits on the person it says "Waiting
 * for your OK"; once stopped, "Stopped after 41s · 5 steps"; failed,
 * "Stopped: something went wrong". A click or Enter opens the grey list of
 * its steps (aria-expanded): each with its mark, a done step's detail a
 * click away (the period and platforms a read covered), a failed or
 * skipped step's reason under it, a split step's parts, and once done how
 * long the run worked. A read's rows never show; memory's saved notes and
 * a split's parts are counted. No steps, no line, but for a wait or a stop.
 */
export function RunStepsLine({
  status,
  steps,
  workingMs,
  className,
}: {
  status: ClientRunStatus;
  steps: readonly ChatStep[];
  /** The run's working time, for "Stopped after …" and "Worked for …". */
  workingMs: number;
  className?: string;
}) {
  const t = useTranslations('chatRun.stepsLine');
  const duration = useDurationWords();
  const listId = useId();
  const [open, setOpen] = useState(false);
  // The done step whose detail shows: one at a time.
  const [opened, setOpened] = useState<number | null>(null);

  const listed = listedSteps(steps);
  const failed = listed.filter((s) => s.status === 'error').length;
  const summary = stepsSummary(steps);
  const did = summary ? summaryWords(summary, t) : null;
  const count = t('steps', { count: listed.length });

  let mark: Mark;
  let words: string;
  if (status === 'waiting') {
    mark = 'waiting';
    words = did ? `${t('waiting')} · ${did}` : t('waiting');
  } else if (status === 'stopped' || status === 'paused_cap') {
    mark = 'stopped';
    const after = t('stoppedAfter', { duration: duration(workingMs) });
    words = listed.length > 0 ? `${after} · ${count}` : after;
  } else if (status === 'error') {
    // No steps: the error box says it.
    if (listed.length === 0) return null;
    mark = 'error';
    words = `${t('failed')} · ${count}`;
  } else if (did) {
    mark = 'done';
    words = failed > 0 ? `${did} · ${t('failedSteps', { count: failed })}` : did;
  } else if (failed > 0) {
    mark = 'error';
    words = t('failedSteps', { count: failed });
  } else {
    return null;
  }

  const line = (
    <>
      <StepMark state={mark} className="mt-[3px]" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{words}</span>
    </>
  );

  return (
    <div data-slot="run-steps-line" data-status={status} className={className}>
      {listed.length === 0 ? (
        <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">{line}</p>
      ) : (
        <button
          type="button"
          data-action="answer.toggleSteps"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(!open)}
          className="flex max-w-full items-start gap-1.5 rounded-md text-left text-[13px] text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {line}
          <ChevronRight
            aria-hidden
            className={cn(
              'mt-[3px] size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
        </button>
      )}
      {listed.length > 0 && (
        <div id={listId} hidden={!open} className="mt-1 ml-[6px] border-l pl-3">
          <ul aria-label={t('list')} className="m-0 list-none space-y-0.5 p-0">
            {listed.map((step) => (
              <StepItem
                key={step.n}
                step={step}
                opened={opened === step.n}
                onToggle={() => setOpened((n) => (n === step.n ? null : step.n))}
              />
            ))}
          </ul>
          {status === 'done' && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('workedFor', { duration: duration(workingMs) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The line's words for the steps done. */
function summaryWords(summary: StepsSummary, t: T): string | null {
  if (summary.kind === 'steps') return t('steps', { count: summary.count });
  // A count of 0 is left out: fact checks alone say "Checked facts", never "Opened 0 pages".
  const words =
    summary.kind === 'one'
      ? stepWords(summary.step, t)
      : summary.sources > 0 && summary.pages > 0
        ? t('sourcesAndPages', { sources: summary.sources, pages: summary.pages })
        : summary.sources > 0
          ? t('sources', { count: summary.sources })
          : summary.pages > 0
            ? t('pages', { count: summary.pages })
            : null;
  if (words === null) return summary.checked ? t('checkedFacts') : null;
  return summary.checked ? t('checked', { words }) : words;
}

/** A step's own words, with memory's saved notes or a split's parts counted, never a read's rows. */
function stepWords(step: ChatStep, t: T) {
  const unit = step.scope?.unit;
  return unit && step.rowCount !== undefined
    ? t(unit, { label: step.label, count: step.rowCount })
    : step.label;
}

/** One step in the list: grey, its mark, its detail a click away once done. */
function StepItem({
  step,
  opened,
  onToggle,
}: {
  step: ChatStep;
  opened: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('chatRun.stepsLine');
  const words = stepWords(step, t);
  // A failed, skipped or waiting step says why under it, always.
  const reason =
    step.status === 'error'
      ? (step.detail ?? null)
      : step.status === 'skipped'
        ? (step.detail ?? t('skipped'))
        : step.status === 'waiting'
          ? (step.detail ?? t('waitingStep'))
          : null;
  const detail = step.status === 'done' ? (step.detail ?? null) : null;
  return (
    <li data-state={step.status} className="text-xs text-muted-foreground">
      {detail ? (
        <button
          type="button"
          data-action="answer.openStep"
          aria-expanded={opened}
          onClick={onToggle}
          className="flex max-w-full items-start gap-1.5 rounded-md py-0.5 text-left hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <StepMark state={step.status} className="mt-px" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{words}</span>
        </button>
      ) : (
        <p className="flex items-start gap-1.5 py-0.5">
          <StepMark state={step.status} className="mt-px" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{words}</span>
        </p>
      )}
      {((detail && opened) || reason) && (
        <p className="pb-0.5 pl-5 text-muted-foreground/90 [overflow-wrap:anywhere]">
          {detail && opened ? detail : reason}
        </p>
      )}
      {step.parts && step.parts.length > 0 && <RunParts parts={step.parts} className="pl-5" />}
    </li>
  );
}
