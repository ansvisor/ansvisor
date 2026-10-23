'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  AGENT_RUN_MAX,
  suggestionCounts,
  type DraftSuggestion,
  type SuggestionStatus,
} from '@/lib/content/suggestions';
import { cn } from '@/lib/utils';
import { PageCompareDialog, pageCharacters } from './_page-rewrite';

/**
 * The Content Agent card over the page (Content Editor v1.1, CE-025/026):
 * one place for what the agent left and what it is doing, in three states.
 *   - waiting: how many suggestions, what they change and the rules they
 *     gain ("Rules 9 → 10 of 14"), with Review, Reject all and Accept all;
 *     a whole page rewritten shows its characters, with Compare;
 *   - all reviewed: how many were accepted and the rules met and still
 *     open, with Undo all and Run Agent;
 *   - working: while the agent runs from the page.
 * The tile moves a little (a soft ring, a blink, a spark; a sweep and a
 * breath while working), never a rotating ring, and not at all with reduced
 * motion. The card wraps on a narrow page: its buttons go under the text.
 */

/** The rules as the card counts them. */
export interface CardRules {
  met: number;
  total: number;
  /** The keys of the rules on that the page doesn't meet now. */
  open: Set<string>;
}

/**
 * The rules met once the open suggestions are in: each open rule a
 * suggestion says it meets counts once.
 */
export function rulesAfter(suggestions: DraftSuggestion[], rules: CardRules): number {
  const meets = new Set(
    suggestions
      .filter((s) => s.status === 'open')
      .flatMap((s) => s.ruleKeys)
      .filter((key) => rules.open.has(key)),
  );
  return Math.min(rules.total, rules.met + meets.size);
}

/** What the open suggestions change, in the agent's words: the first, and how many more. */
function changeSummary(open: DraftSuggestion[]): string {
  const first = open[0]?.reason ?? '';
  const sentence = first.charAt(0).toUpperCase() + first.slice(1);
  return open.length > 1 ? `${sentence} · +${open.length - 1}` : sentence;
}

/** The agent: a robot whose eyes blink (or look around while it works) and a spark by its antenna. */
function AgentIcon({ working }: { working: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-[22px] w-[22px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
    >
      <rect x="4" y="8" width="16" height="11" rx="3.5" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" className="fill-current" />
      <g
        className={cn(
          '[transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none',
          working ? 'animate-agent-look' : 'animate-agent-blink',
        )}
      >
        <path d="M9 13v1.5M15 13v1.5" className="[stroke-width:2.2]" />
      </g>
      <path d="M2 12.5v2M22 12.5v2" />
      <path
        d="M19 2.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"
        className="animate-agent-spark fill-amber-300 stroke-amber-300 [stroke-width:0.8] [transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none"
      />
    </svg>
  );
}

function AgentTile({
  tone,
  count,
}: {
  tone: 'waiting' | 'done' | 'working';
  /** The open suggestions, as a badge while there are any. */
  count: number;
}) {
  return (
    <span
      className={cn(
        'relative flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-xl',
        tone === 'done'
          ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
          : 'bg-foreground text-background',
        tone === 'working' && 'animate-agent-breathe motion-reduce:animate-none',
      )}
    >
      {/* A soft ring that grows out of the tile: never one that rotates. */}
      {tone !== 'working' && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-1 rounded-[15px] border-2 motion-reduce:hidden',
            tone === 'done'
              ? 'animate-agent-ring-slow border-emerald-500/45'
              : 'animate-agent-ring border-foreground/35',
          )}
        />
      )}
      {tone === 'working' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-agent-sweep rounded-xl bg-[linear-gradient(115deg,transparent_30%,rgb(255_255_255/0.22)_50%,transparent_70%)] bg-[length:250%_100%] motion-reduce:hidden"
        />
      )}
      <AgentIcon working={tone === 'working'} />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-muted bg-amber-600 px-1 text-[11px] font-semibold text-white dark:bg-amber-500 dark:text-amber-950">
          {count}
        </span>
      )}
    </span>
  );
}

/** Three dots that bounce in turn, after "Content Agent is working". */
function WorkingDots() {
  return (
    <span aria-hidden className="ml-1.5 inline-flex gap-[3px] align-middle">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-agent-dot rounded-full bg-foreground opacity-25 motion-reduce:animate-none"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

export function AgentCard({
  suggestions,
  rules,
  busy,
  working,
  onAcceptAll,
  onRejectAll,
  onUndoAll,
  onReview,
  onRun,
  onClose,
  onDecidePage,
}: {
  suggestions: DraftSuggestion[];
  rules: CardRules;
  /** A decision is being saved, or the page can't take one now. */
  busy: boolean;
  /** The agent is working from this page (Apply rules with Agent). */
  working: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onUndoAll: () => void;
  /** Scrolls to the first open suggestion and marks it. */
  onReview: () => void;
  /** Run Agent once all are reviewed: the open rules, fixed. */
  onRun: () => void;
  onClose: () => void;
  /** A whole page rewritten: accepted, rejected, or open again (Undo). */
  onDecidePage: (status: SuggestionStatus) => void;
}) {
  const t = useTranslations('contentEditor.editor.agentCard');
  const tSuggestions = useTranslations('contentEditor.editor.suggestions');
  const tRewrite = useTranslations('contentEditor.editor.rewrite');
  const [comparing, setComparing] = useState(false);
  const page = suggestions.find((s) => s.kind === 'page') ?? null;
  const { open, accepted } = suggestionCounts(suggestions);
  const openOnes = suggestions.filter((s) => s.status === 'open');
  const action = suggestions.find((s) => s.actionId && s.actionNo !== null);
  const after = rulesAfter(suggestions, rules);
  const stillOpen = Math.max(0, rules.total - rules.met);
  const tone = working ? 'working' : open > 0 ? 'waiting' : 'done';

  let title: React.ReactNode;
  let line: React.ReactNode;
  if (working) {
    title = (
      <>
        {t('working')}
        <WorkingDots />
      </>
    );
    line = (
      <span className="mt-2 block h-[3px] w-full overflow-hidden rounded-full bg-border">
        <span className="block h-full w-[30%] animate-agent-slide rounded-full bg-foreground motion-reduce:animate-none" />
      </span>
    );
  } else if (page) {
    const { before, after: afterChars } = pageCharacters(page);
    title =
      page.status === 'open'
        ? tRewrite('ready')
        : page.status === 'accepted'
          ? tRewrite('accepted')
          : tRewrite('rejected');
    line =
      page.status === 'open' ? (
        <>
          {tRewrite('characters', { before, after: afterChars })} · {page.reason}
        </>
      ) : page.status === 'accepted' && stillOpen > 0 ? (
        tRewrite('rulesOpen', { count: stillOpen })
      ) : null;
  } else if (open > 0) {
    title = t('waiting', { count: open });
    line = (
      <>
        {changeSummary(openOnes)}
        {after > rules.met && (
          <>
            {' · '}
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              {t('gain', { met: rules.met, after, total: rules.total })}
            </span>
          </>
        )}
        {action && (
          <>
            {' · '}
            <Link
              href={`/dashboard/action-center/actions?action=${action.actionId}`}
              className="underline underline-offset-2 hover:no-underline"
            >
              {tSuggestions('fromAction', { no: action.actionNo! })}
            </Link>
          </>
        )}
      </>
    );
  } else {
    title = t('reviewed');
    line = (
      <>
        {t('reviewedLine', { accepted, met: rules.met, total: rules.total, open: stillOpen })}
        {/* A full run's batch may have stopped short of the rules still open. */}
        {stillOpen > 0 && suggestions.length === AGENT_RUN_MAX && (
          <>
            {' · '}
            {tSuggestions('runMax', { max: AGENT_RUN_MAX })}
          </>
        )}
      </>
    );
  }

  return (
    <div
      role="region"
      aria-label={page ? tRewrite('bar') : tSuggestions('bar')}
      aria-busy={working}
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-2xl border bg-muted px-3.5 py-3 shadow-xs"
    >
      <AgentTile tone={tone} count={working ? 0 : open} />
      {/* Room for a line of text first: on a narrow page the buttons go under it. */}
      <span className="min-w-0 flex-1 basis-56">
        <span className="block text-sm font-semibold [overflow-wrap:anywhere]">{title}</span>
        {line && (
          <span className="block text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">
            {line}
          </span>
        )}
      </span>
      {!working && (
        <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {page ? (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setComparing(true)}>
                {tRewrite('compare')}
              </Button>
              {page.status === 'open' ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onDecidePage('rejected')}
                  >
                    {tRewrite('reject')}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => onDecidePage('accepted')}>
                    {tRewrite('accept')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => onDecidePage('open')}
                  >
                    {tRewrite('undo')}
                  </Button>
                  {stillOpen > 0 && (
                    <Button size="sm" disabled={busy} onClick={onRun}>
                      {t('run')}
                    </Button>
                  )}
                </>
              )}
            </>
          ) : open > 0 ? (
            <>
              <Button variant="ghost" size="sm" onClick={onReview}>
                {t('review')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={onRejectAll}>
                {tSuggestions('rejectAll')}
              </Button>
              <Button size="sm" disabled={busy} onClick={onAcceptAll}>
                {tSuggestions('acceptAll')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onUndoAll}>
                {tSuggestions('undoAll')}
              </Button>
              {stillOpen > 0 && (
                <Button size="sm" disabled={busy} onClick={onRun}>
                  {t('run')}
                </Button>
              )}
            </>
          )}
          {open === 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tSuggestions('close')}
              title={tSuggestions('close')}
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      )}
      {page && (
        <PageCompareDialog
          suggestion={page}
          open={comparing}
          onOpenChange={setComparing}
          busy={busy}
          onDecide={onDecidePage}
        />
      )}
    </div>
  );
}
