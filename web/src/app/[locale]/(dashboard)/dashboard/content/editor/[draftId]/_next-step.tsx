'use client';

import { useEffect, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import type { AgentRun } from '@/lib/content/agent-runs';
import {
  FEW_OPEN_RULES,
  type NextAction,
  type NextPath,
  type NextStep,
  type NextStepId,
  type NextStepState,
  type PathState,
} from '@/lib/content/next-step';
import { cn } from '@/lib/utils';
import { RunSteps } from './_agent-card';
import { TRUST_GATE } from './_before-publish';
import { WorkingDots } from './_working-dots';

/**
 * The Next step basket (Next step spec §2–3): the header's "Next · {step}"
 * button, with the path as small bars, opens it as a popover under the
 * header. It names the one step to take now, why (from the page's own
 * numbers), its button and at most one other, Skip, the path of five
 * steps, and up to two "If you see…" lines. Each button is one the editor
 * already has; the basket only says which to use now. While the agent
 * works, it shows the run's step and Stop instead.
 */

/** The steps skipped on this draft, in this browser (Skip, spec §4). */
const skipsKey = (draftId: string) => `aeo:next-step-skips:${draftId}`;

export function readSkips(draftId: string): Partial<Record<NextStepId, string>> {
  try {
    const read = JSON.parse(localStorage.getItem(skipsKey(draftId)) ?? 'null') as unknown;
    if (read && typeof read === 'object') return read as Partial<Record<NextStepId, string>>;
  } catch {
    // Storage unavailable (private mode) or unreadable: nothing skipped.
  }
  return {};
}

export function writeSkips(draftId: string, skips: Partial<Record<NextStepId, string>>) {
  try {
    localStorage.setItem(skipsKey(draftId), JSON.stringify(skips));
  } catch {
    // Skipped for this visit only.
  }
}

/**
 * Words besides the page's title: a page with none is empty (Write the first
 * draft). The title is read from the block draftTitleFromDoc picks: the
 * first H1 with words, else the first heading, else the first block with
 * words; an empty line or an image above it changes nothing.
 */
export function wordsUnderTitle(html: string): boolean {
  const template = document.createElement('template');
  template.innerHTML = html;
  const blocks = Array.from(template.content.children);
  const words = (el: Element) => /\S/.test(el.textContent ?? '');
  const title =
    blocks.find((el) => el.matches('h1') && words(el)) ??
    blocks.find((el) => el.matches('h1, h2, h3, h4, h5, h6') && words(el)) ??
    blocks.find(words);
  title?.remove();
  return /\S/.test(template.content.textContent ?? '');
}

export type T = ReturnType<typeof useTranslations<'contentEditor.editor.nextStep'>>;

/** A step's name: the Length step says which way the page is off. */
export function stepName(t: T, id: NextStepId, state: NextStepState): string {
  if (id === 'length' && state.rewrite?.reason === 'length') {
    return state.rewrite.count > state.rewrite.target
      ? t('steps.lengthLong')
      : t('steps.lengthShort');
  }
  return id === 'length' ? t('steps.lengthLong') : t(`steps.${id}`);
}

/** Who takes a step: the agent's run, or the person (their to-dos, their checks, their words). */
const AGENT_ACTIONS: ReadonlySet<NextAction> = new Set([
  'buildBrief',
  'writeWithAgent',
  'rewritePage',
  'fixRules',
]);
export function stepActor(step: NextStep): 'agent' | 'you' {
  return AGENT_ACTIONS.has(step.primary) ? 'agent' : 'you';
}

/** Why the step is next, from the page's own numbers. */
export function stepReason(
  t: T,
  step: NextStep,
  state: NextStepState,
  todoLine: string | null,
): string {
  const { id } = step;
  switch (id) {
    case 'length':
      return state.rewrite?.reason === 'length'
        ? t('reasons.length', { count: state.rewrite.count, target: state.rewrite.target })
        : t('reasons.fixRules', { count: state.openRules.length });
    case 'fixRules':
      return t('reasons.fixRules', { count: state.openRules.length });
    case 'write':
    case 'import':
      // Once the person said they'd write it, the step is theirs.
      return step.primary === 'writeMyself' ? t('reasons.writeMine') : t(`reasons.${id}`);
    case 'proof': {
      const trust = state.quality?.trust;
      if (state.quality?.trustLow && trust !== null && trust !== undefined) {
        return todoLine
          ? t('reasons.proofTrustTodo', { trust, gate: TRUST_GATE, todo: todoLine })
          : t('reasons.proofTrust', { trust, gate: TRUST_GATE });
      }
      return t('reasons.proofTodo', { todo: todoLine ?? '' });
    }
    case 'check':
      return state.quality ? t('reasons.check', { gate: TRUST_GATE }) : t('reasons.checkRules');
    case 'ready':
      return state.published ? t('reasons.published') : t('reasons.ready');
    default:
      return t(`reasons.${id}`);
  }
}

/** The path as small bars: done, the one now, and those ahead. */
function Bars({ path, className }: { path: NextPath['path']; className?: string }) {
  return (
    <span aria-hidden className={cn('flex items-center gap-[3px]', className)}>
      {path.map((p) => (
        <i
          key={p.id}
          className={cn(
            'block h-1.5 w-2.5 rounded-full',
            p.state === 'done'
              ? 'bg-foreground'
              : p.state === 'now'
                ? 'bg-foreground/60'
                : 'bg-foreground/15',
          )}
        />
      ))}
    </span>
  );
}

const PATH_DOT: Record<PathState, string> = {
  done: 'bg-foreground text-background',
  now: 'bg-foreground/10 text-foreground ring-1 ring-foreground',
  skipped: 'bg-muted text-muted-foreground',
  ahead: 'bg-muted text-muted-foreground',
};

export function NextStepButton({
  next,
  state,
  todoLine,
  open,
  onOpenChange,
  focusOnOpen,
  onAction,
  onSkip,
  blocked,
  working,
}: {
  next: NextPath;
  state: NextStepState;
  /** The first open to-do as "pick the page's author", for the proof step's reason. */
  todoLine: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened by a click: focus moves in. Opened by itself (a new draft): it doesn't. */
  focusOnOpen: boolean;
  onAction: (action: NextAction) => void;
  onSkip: (id: NextStepId) => void;
  /** Why an action can't run now (another run, suggestions to decide), or null. */
  blocked: (action: NextAction) => string | null;
  /** The agent's run under way from this page, with Stop; null while none. */
  working: { run: AgentRun | null; onStop: () => void; stopping: boolean } | null;
}) {
  const t = useTranslations('contentEditor.editor.nextStep');
  const { step, path, tips } = next;
  const name = stepName(t, step.id, state);
  const now = path.findIndex((p) => p.state === 'now');
  const why = blocked(step.primary);
  const whyId = useId();
  // After Skip, the new step's button takes focus (Skip itself may be gone).
  const primaryRef = useRef<HTMLButtonElement>(null);
  const skipped = useRef(false);
  useEffect(() => {
    if (!skipped.current) return;
    skipped.current = false;
    primaryRef.current?.focus();
  }, [step.id]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" />}
        aria-label={t('button', { step: name })}
        title={t('button', { step: name })}
      >
        <Bars path={path} />
        <span>{t('short')}</span>
        {/* The step's name where there's room (§3b: "Next" with the bars at 1024px). */}
        <span className="hidden max-w-48 truncate xl:inline">
          {t('buttonStep', { step: name })}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[340px] space-y-3"
        initialFocus={focusOnOpen}
        // Closing leaves focus where it went (a click into the page, a dialog,
        // a menu or a tab a step opened), else back on the button: Base UI's
        // own rule, which a finalFocus function would turn off.
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {t('label')}
          </span>
          <Bars path={path} className="ml-auto" />
          <span className="sr-only">
            {now >= 0 ? t('stepOf', { n: now + 1, total: path.length }) : t('allDone')}
          </span>
        </div>

        {working ? (
          <div className="space-y-2">
            <PopoverTitle className="flex items-center">
              {t('working')}
              <WorkingDots />
            </PopoverTitle>
            {working.run && <RunSteps run={working.run} />}
            {working.run && (
              <Button
                variant="outline"
                size="sm"
                disabled={working.stopping}
                onClick={working.onStop}
              >
                {t('stop')}
              </Button>
            )}
          </div>
        ) : (
          // A step that changes (Skip, a run's end) is read out.
          <div className="space-y-2" aria-live="polite">
            <PopoverTitle>{name}</PopoverTitle>
            <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
              {stepReason(t, step, state, todoLine)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                ref={primaryRef}
                size="sm"
                disabled={why !== null}
                aria-describedby={why ? whyId : undefined}
                onClick={() => onAction(step.primary)}
              >
                {t(`actions.${step.primary}`)}
              </Button>
              {step.alternative && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={blocked(step.alternative) !== null}
                  onClick={() => onAction(step.alternative!)}
                >
                  {t(`actions.${step.alternative}`)}
                </Button>
              )}
              {step.skippable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    skipped.current = true;
                    onSkip(step.id);
                  }}
                >
                  {t('skip')}
                </Button>
              )}
            </div>
            {why && (
              <p
                id={whyId}
                className="text-xs text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400"
              >
                {why}
              </p>
            )}
          </div>
        )}

        <ol aria-label={t('path')} className="space-y-1 border-t pt-3">
          {path.map((p, i) => (
            <li
              key={p.id}
              aria-current={p.state === 'now' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-[13px]',
                p.state === 'done' && 'text-muted-foreground line-through',
                p.state === 'now' && 'font-medium',
                (p.state === 'ahead' || p.state === 'skipped') && 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold no-underline',
                  PATH_DOT[p.state],
                )}
              >
                {p.state === 'done' ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {stepName(t, p.id, state)}
                {p.state === 'skipped' && (
                  <span aria-hidden className="ml-1.5 text-xs no-underline">
                    {t('skipped')}
                  </span>
                )}
                <span className="sr-only"> · {t(`states.${p.state}`)}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* The lines' buttons start runs: none while one is under way. */}
        {tips.length > 0 && !working && (
          <div className="space-y-1 border-t pt-3">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t('tipsTitle')}
            </p>
            {tips.map((tip) => (
              <p key={tip.id} className="text-[13px] text-muted-foreground">
                {t('tipLine', {
                  state: t(`tips.${tip.id}`, { gate: TRUST_GATE, max: FEW_OPEN_RULES }),
                })}{' '}
                <button
                  type="button"
                  disabled={blocked(tip.action) !== null}
                  onClick={() => onAction(tip.action)}
                  className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                >
                  {t(`actions.${tip.action}`)}
                </button>
              </p>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
