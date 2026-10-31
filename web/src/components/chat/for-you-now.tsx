'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** Chips at most, Ask anything included; More ▾ after them (CHAT-08 v2: max 6 + More). */
const MAX_CHIPS = 6;

const CHIP =
  'inline-flex h-8 items-center gap-1.5 rounded-[10px] border bg-card px-[11px] text-[13px] hover:border-foreground disabled:opacity-50';

export interface ForYouNowProps {
  /** Action Center tasks due this week; null until read. */
  dueTasks: number | null;
  /** Pages whose citations the brand lost, from its open signals; null until read. */
  lostPages: number | null;
  /** Drafts marked ready to publish; null until read. */
  readyDrafts: number | null;
  /** A chat is starting: the chips wait. */
  starting: boolean;
  /** Asks Chat in a new chat. */
  onAsk: (message: string) => void;
}

/**
 * "For you now" on Chat Home (CHAT-08 v2, mockup #s-home `.scut`): Ask
 * anything first, then the jobs that have something to do, each with its
 * count from the brand's data — Complete tasks · 4 due, Win back citations
 * · 2 pages, Ready to publish · 2 — then More ▾, the composer's / menu. A
 * job with nothing to do has no chip. Quality pass and Weekly report wait
 * for their data: drafts' quality scores aren't kept, and schedules come
 * with Wave 3. A chip starts a new chat with its words.
 */
export function ForYouNow({ dueTasks, lostPages, readyDrafts, starting, onAsk }: ForYouNowProps) {
  const t = useTranslations('chatShell.home');
  const jobs = [
    dueTasks
      ? {
          skill: 'tasks',
          label: t('forYou.tasks'),
          count: t('forYou.tasksCount', { count: dueTasks }),
          message: t('completeTasksMessage'),
        }
      : null,
    lostPages
      ? {
          skill: 'winback',
          label: t('forYou.winBack'),
          count: t('forYou.winBackCount', { count: lostPages }),
          message: t('forYou.winBackMessage', { count: lostPages }),
        }
      : null,
    readyDrafts
      ? {
          skill: 'publish',
          label: t('forYou.publish'),
          count: String(readyDrafts),
          message: t('forYou.publishMessage', { count: readyDrafts }),
        }
      : null,
  ]
    .filter((job) => job !== null)
    .slice(0, MAX_CHIPS - 1);

  return (
    <div className="mb-4">
      <div className="mx-0.5 mb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase">
        {t('forYou.title')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-action="home.askAnything"
          className={cn(CHIP, 'border-foreground bg-foreground text-background')}
          onClick={() =>
            document.querySelector<HTMLTextAreaElement>('[data-action="composer.input"]')?.focus()
          }
        >
          {t('forYou.askAnything')}
        </button>
        {jobs.map((job) => (
          <button
            key={job.skill}
            type="button"
            data-action="home.runShortcut"
            data-skill={job.skill}
            disabled={starting}
            className={CHIP}
            onClick={() => onAsk(job.message)}
          >
            {job.label}
            <b className="rounded-md bg-amber-50 px-1.5 text-[11.5px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {job.count}
            </b>
          </button>
        ))}
        <button
          type="button"
          data-action="home.moreShortcuts"
          className={cn(CHIP, 'text-muted-foreground')}
          // The composer's own / button: the menu with every shortcut and skill.
          onClick={() =>
            document.querySelector<HTMLElement>('[data-action="composer.openSlash"]')?.click()
          }
        >
          {t('forYou.more')}
        </button>
      </div>
    </div>
  );
}
