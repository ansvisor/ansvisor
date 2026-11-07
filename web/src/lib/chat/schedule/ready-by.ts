import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';

/**
 * A job with a due time, "Have it ready by Monday" (CHAT-12 items 1, 13,
 * 17; CHAT-09 item 8; Chat Wave 4 W4-30, Teknik T5): it starts at once and
 * its parts are worked on until they are all ready or the due time comes.
 * The worker (worker.ts) keeps it in two columns of chat_schedules:
 *
 *   - next_run_at: a fresh run (at once after a run that got more parts
 *     ready), else the due time itself, when what is ready is delivered;
 *     null once delivered.
 *   - retry_at: the next try after a run that failed, stopped at the AI
 *     limit or got no further, as attempt 2: at most 3 tries, each at least
 *     30 minutes after the last, and never at or after the due time.
 *
 * It is delivered (deliver.ts) as soon as every part is ready, when its
 * tries are used up, or at the due time: what is ready, and the rest
 * listed, never dropped. Pure.
 */

/** Tries after a run that didn't get its parts ready (T5). */
export const READY_BY_RETRIES = 3;
/** The least time between two tries (T5). */
export const READY_BY_RETRY_GAP_MS = 30 * 60_000;

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules.readyBy' });

/** Whether a job is one with a due time (a one-time ready by job). */
export const isReadyBy = (job: { kind: string; run_mode: string; due_at: string | null }) =>
  job.kind === 'once' && job.run_mode === 'ready_by' && !!job.due_at;

/** Why it was delivered: all ready, its tries used up, or its due time came. */
export type ReadyByWhy = 'ready' | 'tries' | 'due';

/** What a job with a due time does next. */
export type ReadyByStep =
  | { kind: 'deliver'; why: ReadyByWhy }
  /** A fresh run at `at` (attempt 1): the last run got more parts ready. */
  | { kind: 'run'; at: string }
  /** A try at `at` (attempt 2), T5. */
  | { kind: 'retry'; at: string }
  /** No time for another try: what is ready goes at the due time. */
  | { kind: 'wait' };

export interface ReadyByFacts {
  dueAt: string;
  now: Date;
  /** Every part is ready: the run that ended is done with all its parts. */
  complete: boolean;
  /** The run that ended is done with more parts ready than any before it. */
  progressed: boolean;
  /** The tries used so far: the job's runs of attempt 2. */
  retries: number;
  /** The time the 30 minutes count from: when the last run ended, or started; null: no run yet. */
  gapFrom: Date | null;
}

/**
 * What the job does after a run ended, or once the AI limit has room again
 * (above). A run that got no further, failed or stopped at the limit is a
 * miss: tried again 30 minutes on at the soonest, at most 3 times.
 */
export function readyByNext(facts: ReadyByFacts): ReadyByStep {
  const due = Date.parse(facts.dueAt);
  const now = facts.now.getTime();
  if (now >= due) return { kind: 'deliver', why: 'due' };
  if (facts.complete) return { kind: 'deliver', why: 'ready' };
  if (facts.progressed) return { kind: 'run', at: facts.now.toISOString() };
  if (facts.retries >= READY_BY_RETRIES) return { kind: 'deliver', why: 'tries' };
  const at = facts.gapFrom ? Math.max(now, facts.gapFrom.getTime() + READY_BY_RETRY_GAP_MS) : now;
  return at >= due ? { kind: 'wait' } : { kind: 'retry', at: new Date(at).toISOString() };
}

/** Text from a title, safe as Markdown: its own characters, never formatting. */
const plain = (text: string) => text.replace(/([\\`*_[\]<>#|])/g, '\\$1');

/**
 * The delivery's answer in the job's chat (remark-breaks: one line each):
 * the job, why it is delivered with how many parts are ready, what is
 * ready and what isn't yet. `due` is the due time in words.
 */
export function readyByAnswer({
  why,
  title,
  due,
  ready,
  rest,
}: {
  why: ReadyByWhy;
  title: string;
  due: string;
  ready: readonly string[];
  rest: readonly string[];
}): string {
  const counts = { ready: ready.length, total: ready.length + rest.length };
  const line =
    why === 'ready'
      ? t('ready', { date: due })
      : why === 'tries'
        ? t('tries', { tries: READY_BY_RETRIES, ...counts })
        : t('due', { date: due, ...counts });
  const list = (name: 'readyList' | 'restList', items: readonly string[]) =>
    [`${t(name)}:`, ...items.map((item) => `- ${plain(item)}`)].join('\n');
  return [
    `**${plain(title)}**\n${line}`,
    ready.length ? list('readyList', ready) : t('nothing'),
    ...(rest.length ? [list('restList', rest), t('rest')] : []),
  ].join('\n\n');
}
