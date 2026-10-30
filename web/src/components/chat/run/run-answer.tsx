'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { AgentAvatar, type AgentAvatarState } from '@/components/agentic/agent-avatar';
import { stampParts } from '@/components/agentic/result-card';
import { RunSteps, type RunStepsStatus } from '@/components/agentic/run-steps';
import type { Components } from 'react-markdown';
import { MARKDOWN_COMPONENTS, Markdown } from '@/components/ui/markdown';
import type { ClientRun, ClientRunStatus } from '@/lib/chat/run-state';
import { cn } from '@/lib/utils';
import { dataUsed, doneSteps, statusLine } from './run-view';

const ACTIVE: ClientRunStatus[] = ['queued', 'running'];

const WEB = /^https?:\/\//i;

/**
 * The answer's Markdown. Its text can quote what a read brought in, so a
 * link opens only an http(s) address (in a new tab) or a page of the app;
 * any other address shows as its text. An image shows as its alt text and
 * is never fetched.
 */
const ANSWER_MARKDOWN: Partial<Components> = {
  ...MARKDOWN_COMPONENTS,
  a: function AnswerLink({ href, children }) {
    if (href && WEB.test(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
          {children}
        </a>
      );
    }
    if (href?.startsWith('/dashboard/')) {
      return (
        <a href={href} className="underline">
          {children}
        </a>
      );
    }
    return <>{children}</>;
  },
  img: function AnswerImage({ alt }) {
    return alt ? <span>{alt}</span> : null;
  },
};

const stepsStatus = (status: ClientRunStatus): RunStepsStatus =>
  status === 'done'
    ? 'done'
    : status === 'waiting'
      ? 'waiting'
      : status === 'error'
        ? 'error'
        : status === 'stopped' || status === 'paused_cap'
          ? 'stopped'
          : 'running';

/** The agent beside the answer (item 12a): it works, waits on the person, or is still. */
const avatarState = (status: ClientRunStatus): AgentAvatarState =>
  status === 'queued' || status === 'running'
    ? 'working'
    : status === 'waiting'
      ? 'waiting'
      : status === 'error'
        ? 'failed'
        : 'idle';

/**
 * An answer as its run works (CHAT-03 "Working state and streaming", items
 * 12a–12h, and "Data used", items 13–14; Chat Wave 1, W1-14), built from the
 * run's events only. The agent works beside it with one status line, its
 * words from the running step ("Reading Citations…"). The steps list sits
 * under a header (RunSteps), and each step done is a ✓ chip whose detail a
 * click shows; a fact check (W1-21) is one of them. The answer streams in,
 * then "Data used" names each source with its rows, and "Generated … · Data
 * as of …" is stamped in the person's time zone. What follows the answer
 * (cards, next moves, its actions: `footer`) fades in once the run is done.
 * With reduced motion nothing animates. No tool name, input or ID reaches
 * it: the steps carry the label registry's words.
 */
export function RunAnswer({
  run,
  workingMs,
  timezone,
  reconnecting = false,
  cards,
  footer,
  className,
}: {
  run: ClientRun;
  /** The run's working time, paused while it waits on the person: the caller ticks it. */
  workingMs: number;
  /** The person's time zone, for the stamp. */
  timezone?: string | null;
  /** The stream dropped, and the page is reconnecting (item 21). */
  reconnecting?: boolean;
  /** The run's own cards (an approval, a denial), under the answer. */
  cards?: ReactNode;
  /** What follows a finished answer: next moves and its actions (item 12f). */
  footer?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('chatRun');
  const tStamp = useTranslations('agentic.resultCard');
  const tSteps = useTranslations('agentic.runSteps');
  const [opened, setOpened] = useState<number | null>(null);
  const active = ACTIVE.includes(run.status);
  const status = statusLine(run.steps, run.text.length > 0);
  const chips = doneSteps(run.steps);
  const sources = dataUsed(run.steps);
  const openedStep = chips.find((s) => s.n === opened);
  const timeZone = timezone ?? undefined;

  const stamp = (() => {
    if (!run.generatedAt) return null;
    const at = stampParts(run.generatedAt, timeZone);
    const generated = tStamp('generated', { date: at.date, time: at.time });
    const tip = [tStamp('generatedTip', { full: `${at.date} · ${at.time} ${at.offset}` })];
    if (!run.dataAsOf) return { text: generated, tip: tip.join('\n') };
    const asOf = stampParts(run.dataAsOf, timeZone);
    tip.push(tStamp('dataAsOfTip', { full: `${asOf.date} · ${asOf.time} ${asOf.offset}` }));
    return {
      text: `${generated} · ${tStamp('dataAsOf', { date: asOf.date, time: asOf.time })}`,
      tip: tip.join('\n'),
    };
  })();

  return (
    <div data-slot="run-answer" className={cn('flex gap-2.5', className)}>
      <AgentAvatar size="sm" state={avatarState(run.status)} decorative className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        {(active || reconnecting) && (
          <p
            aria-live="polite"
            data-slot="run-status"
            className="text-[13px] text-muted-foreground"
          >
            {reconnecting ? t('status.reconnecting') : t(`status.${status.key}`, status.values)}
          </p>
        )}
        <RunSteps
          status={stepsStatus(run.status)}
          steps={run.steps}
          workingMs={workingMs}
          sources={sources.length}
        />
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((step) => (
              <button
                key={step.n}
                type="button"
                data-action="answer.openStep"
                aria-expanded={opened === step.n}
                onClick={() => setOpened((n) => (n === step.n ? null : step.n))}
                className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-foreground/80 hover:bg-muted aria-expanded:bg-muted"
              >
                <Check className="size-3 shrink-0 text-green-600 dark:text-green-500" aria-hidden />
                <span className="truncate">
                  {step.label}
                  {step.rowCount !== undefined && (
                    <> · {tSteps('rows', { count: step.rowCount })}</>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        {openedStep?.detail && <p className="text-xs text-muted-foreground">{openedStep.detail}</p>}
        {run.text && (
          <div data-slot="run-text" className="text-sm">
            <Markdown components={ANSWER_MARKDOWN}>{run.text}</Markdown>
          </div>
        )}
        {cards}
        {sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{t('dataUsed')}</span>
            {sources.map((chip, i) => (
              <span
                key={`${i}:${chip.label}`}
                className="rounded-full border px-2 py-0.5 text-foreground/80"
              >
                {chip.label}
                {chip.rows !== undefined && <> · {tSteps('rows', { count: chip.rows })}</>}
              </span>
            ))}
          </div>
        )}
        {stamp && (
          <p title={stamp.tip} className="text-xs text-muted-foreground">
            {stamp.text}
          </p>
        )}
        {run.status === 'done' && footer && (
          <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
