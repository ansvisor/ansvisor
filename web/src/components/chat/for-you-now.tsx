'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { track } from '@/lib/analytics';
import type { FocusArea } from '@/lib/chat/focus';
import { FOCUS_SHORTCUTS, inTurn, SHORTCUT_SKILL, type FocusShortcut } from '@/lib/chat/focus-home';
import { cn } from '@/lib/utils';

/** Chips at most, Ask anything included; More ▾ after them (CHAT-08 v2: max 6 + More). */
const MAX_CHIPS = 6;

const CHIP =
  'inline-flex h-8 items-center gap-1.5 rounded-[10px] border bg-card px-[11px] text-[13px] outline-none hover:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

export interface ForYouNowProps {
  /** Action Center tasks due this week; null until read. */
  dueTasks: number | null;
  /** Pages whose citations the brand lost, from its open signals; null until read. */
  lostPages: number | null;
  /** Drafts marked ready to publish; null until read. */
  readyDrafts: number | null;
  /** The person may change things (Admin, Manager): the jobs that write, and More. */
  canChange: boolean;
  /** A chat is starting: the chips wait. */
  starting: boolean;
  /** Asks Chat in a new chat. */
  onAsk: (message: string) => void;
  /** The person's focus (CHAT-24 §4): its areas' shortcuts in turn, in place of the jobs. */
  focus?: readonly FocusArea[];
}

/** A chip: the job or shortcut, its skill, its count when it has one, and what it asks. */
interface Job {
  key: string;
  skill: string;
  label: string;
  count?: string;
  message: string;
  /** The focus area it came from. */
  area?: FocusArea;
}

/**
 * "For you now" on Chat Home (CHAT-08 v2, mockup #s-home `.scut`): Ask
 * anything first, then the jobs that have something to do, each with its
 * count from the brand's data — Complete tasks · 4 due, Win back citations
 * · 2 pages, Ready to publish · 2 — then More ▾, the composer's / menu. A
 * job with nothing to do has no chip. Each asks in its skill's words
 * (W2-04's /tasks, /winback, /publish): Chat prepares, the person closes
 * the tasks, and going live is always their click. Someone who can't change
 * things (Analyst, Agency partner) gets the jobs that only read — Win back
 * as "which pages, and what AI cites instead" — and no More, as their
 * composer has no / menu. Quality pass and Weekly report wait for their
 * data: drafts' quality scores aren't kept, and schedules come in Wave 3.
 *
 * With a focus picked (CHAT-24 §4), the chips are its areas' shortcuts,
 * taken in turn so every area shows (CHAT-08 v2's six chips, Ask anything
 * included). The three jobs keep their counts and their rules; the other
 * shortcuts carry no count, as nothing counts them yet.
 */
export function ForYouNow({
  dueTasks,
  lostPages,
  readyDrafts,
  canChange,
  starting,
  onAsk,
  focus = [],
}: ForYouNowProps) {
  const t = useTranslations('chatShell.home.forYou');
  const tf = useTranslations('chatShell.home.byFocus.shortcuts');
  const titleId = useId();
  const tasks: Job | null =
    dueTasks && canChange
      ? {
          key: 'tasks',
          skill: 'tasks',
          label: t('tasks'),
          count: t('tasksCount', { count: dueTasks }),
          message: t('tasksMessage'),
        }
      : null;
  const winBack: Job | null = lostPages
    ? {
        key: 'winBack',
        skill: 'winback',
        label: t('winBack'),
        count: t('winBackCount', { count: lostPages }),
        message: t(canChange ? 'winBackMessage' : 'winBackReadMessage', { count: lostPages }),
      }
    : null;
  const publish: Job | null =
    readyDrafts && canChange
      ? {
          key: 'publish',
          skill: 'publish',
          label: t('publish'),
          count: t('publishCount', { count: readyDrafts }),
          message: t('publishMessage', { count: readyDrafts }),
        }
      : null;
  /** A focus shortcut's chip, or null for a job with nothing to do. */
  const shortcutJob = (shortcut: FocusShortcut, area: FocusArea): Job | null => {
    const job =
      shortcut === 'tasks'
        ? tasks
        : shortcut === 'winBack'
          ? winBack
          : shortcut === 'publish'
            ? publish
            : {
                key: shortcut,
                skill: SHORTCUT_SKILL[shortcut] ?? shortcut,
                label: tf(shortcut),
                message: tf(`${shortcut}Message`),
              };
    return job && { ...job, area };
  };
  const jobs =
    focus.length > 0
      ? inTurn(
          focus.map((area) =>
            FOCUS_SHORTCUTS[area]
              .map((shortcut) => shortcutJob(shortcut, area))
              .filter((job) => job !== null),
          ),
          MAX_CHIPS - 1,
          (job) => job.key,
        )
      : [tasks, winBack, publish].filter((job) => job !== null).slice(0, MAX_CHIPS - 1);

  return (
    <div className="mb-4">
      <div
        id={titleId}
        className="mx-0.5 mb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase"
      >
        {t('title')}
      </div>
      <div role="group" aria-labelledby={titleId} className="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-action="home.askAnything"
          className={cn(CHIP, 'border-foreground bg-foreground text-background')}
          onClick={() =>
            document.querySelector<HTMLTextAreaElement>('[data-action="composer.input"]')?.focus()
          }
        >
          {t('askAnything')}
        </button>
        {jobs.map((job) => (
          <button
            key={job.key}
            type="button"
            data-action="home.runShortcut"
            data-skill={job.skill}
            disabled={starting}
            className={CHIP}
            onClick={() => {
              if (job.area) {
                track('chat_focus_shortcut_clicked', { area: job.area, skill: job.skill });
              }
              onAsk(job.message);
            }}
          >
            {job.label}
            {job.count && (
              <>
                {' '}
                <b className="rounded-md bg-amber-50 px-1.5 text-[11.5px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  {job.count}
                </b>
              </>
            )}
          </button>
        ))}
        {canChange && (
          <button
            type="button"
            data-action="home.moreShortcuts"
            className={cn(CHIP, 'text-muted-foreground')}
            // The composer's own / button: the menu with every shortcut and skill.
            onClick={() =>
              document.querySelector<HTMLElement>('[data-action="composer.openSlash"]')?.click()
            }
          >
            {t('more')}
            <span aria-hidden="true">▾</span>
          </button>
        )}
      </div>
    </div>
  );
}
