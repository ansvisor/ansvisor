import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { readChosenTimeZone } from '@/lib/account-time-zone';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { LoadedRun } from '../engine-store';
import { readStrips, weekEndIn } from '../task-strip';
import { startTouchedBrands } from '../touched-brands';
import { emailJobProblem, emailRunResult } from './email';
import { readyByAnswer, type ReadyByWhy } from './ready-by';
import { dateWords, type WhenWords } from './when';

/**
 * What a scheduled job's run leaves once it moves (CHAT-12 items 13, 16,
 * 18, 20, 26–27; W3-04a), beside its run row (worker.ts):
 *
 *   - Chat: the answer is in the job's own chat, its creator's, so it comes
 *     to their Inbox as an unread result: no notice of its own.
 *   - "1 of 3 ready": its parts, the tasks of its strip ready of all of
 *     them (a /tasks job), else the files it made, as it works and when it
 *     ends.
 *   - "Notify only if the answer changed": a delivered run's fingerprint is
 *     the job's last (last_fingerprint), what the next run compares to; a
 *     run with no change ("No change") keeps the one before.
 *   - Notices (chat_notices, 00461) at the top of the creator's Inbox: a run
 *     that failed after its retry ("{Job} didn't run: {reason}"), and a job
 *     that turned itself off (the AI limit, its creator's role or brand
 *     access, its brand or skill gone, 3 failed runs). One per event; a run
 *     that goes on, or the job turned back on, closes them.
 *   - A job with a due time (ready-by.ts, W4-30): each run's answer comes
 *     to the Inbox as any run's, with no e-mail and no notice of its own;
 *     its delivery (deliverReadyBy) is the answer that lists what is ready
 *     and what isn't yet, in its chat, so in the Inbox, and by e-mail for a
 *     job that delivers by e-mail.
 *
 * Never throws, but the delivery: what is left here is told, not what
 * runs. Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules.notice' });
const tReady = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules.readyBy' });
const tTasks = createTranslator({ locale: 'en', messages, namespace: 'chatRun.tasks' });
const tWhen = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatSchedules.when',
}) as unknown as WhenWords;

export const SCHEDULE_NOTICE_KINDS = ['schedule_failed', 'schedule_paused'] as const;
export type ScheduleNoticeKind = (typeof SCHEDULE_NOTICE_KINDS)[number];

/** Why a job turned itself off (chat_schedules.paused_reason, but a person's own Off). */
export type PausedReason = 'cap' | 'failed' | 'skill_off' | 'missing_source' | 'owner_role';

/** A job as its notices name it. */
interface NoticeJob {
  id: string;
  organization_id: string;
  created_by: string | null;
  title: string;
  conversation_id: string | null;
  skill_name: string | null;
}

const NOTICE_JOB_COLUMNS = 'id, organization_id, created_by, title, conversation_id, skill_name';

async function readNoticeJob(jobId: string): Promise<NoticeJob | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .select(NOTICE_JOB_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`Could not read a scheduled job: ${error.message}`);
  return (data as NoticeJob | null) ?? null;
}

/**
 * One notice for the job's creator; a second for the same event (`key`) is
 * kept out. True when this one was written: its e-mail goes with it.
 */
async function notify(
  job: NoticeJob,
  kind: ScheduleNoticeKind,
  reason: string,
  key: string,
): Promise<boolean> {
  if (!job.created_by) return false;
  const { error } = await supabaseAdmin.from('chat_notices').insert({
    organization_id: job.organization_id,
    user_id: job.created_by,
    kind,
    payload: {
      scheduleId: job.id,
      title: job.title,
      reason: reason.slice(0, 200),
      conversationId: job.conversation_id,
    },
    dedupe_key: `schedule:${job.id}:${key}`.slice(0, 200),
  });
  if (error && error.code !== '23505') {
    throw new Error(`Could not write a scheduled job's notice: ${error.message}`);
  }
  return !error;
}

/**
 * The job turned itself off (above): its creator is told why, once per
 * reason a day. Never throws.
 */
export async function noticeJobPaused(
  jobId: string,
  reason: PausedReason,
  now: Date = new Date(),
): Promise<void> {
  try {
    const job = await readNoticeJob(jobId);
    if (!job) return;
    const words = t(`paused.${reason}`, { skill: job.skill_name ?? '' });
    const told = await notify(
      job,
      'schedule_paused',
      words,
      `paused:${reason}:${now.toISOString().slice(0, 10)}`,
    );
    // And by e-mail, for a job that delivers by e-mail (W3-04b).
    if (told) emailJobProblem(job.id, 'paused', words);
  } catch (err) {
    console.error('[chat/schedules] could not tell that a job paused:', err);
  }
}

/** A run failed after its retry: "{Job} didn't run: {reason}". Never throws. */
export async function noticeRunFailed(
  jobId: string,
  runRowId: string,
  reason: string,
): Promise<void> {
  try {
    const job = await readNoticeJob(jobId);
    if (!job) return;
    // And by e-mail, for a job that delivers by e-mail (W3-04b).
    if (await notify(job, 'schedule_failed', reason, `failed:${runRowId}`)) {
      emailJobProblem(job.id, 'failed', reason, runRowId);
    }
  } catch (err) {
    console.error('[chat/schedules] could not tell that a run failed:', err);
  }
}

/** The job's open notices close: it ran, or it is on again. Never throws. */
export async function closeJobNotices(jobId: string, now: Date = new Date()): Promise<void> {
  try {
    const job = await readNoticeJob(jobId);
    if (!job?.created_by) return;
    const { data, error } = await supabaseAdmin
      .from('chat_notices')
      .select('id, payload')
      .eq('user_id', job.created_by)
      .in('kind', [...SCHEDULE_NOTICE_KINDS])
      .is('resolved_at', null);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as { id: string; payload: { scheduleId?: unknown } | null }[])
      .filter((row) => row.payload?.scheduleId === jobId)
      .map((row) => row.id);
    if (ids.length === 0) return;
    const { error: closeError } = await supabaseAdmin
      .from('chat_notices')
      .update({ resolved_at: now.toISOString() })
      .in('id', ids)
      .is('resolved_at', null);
    if (closeError) throw new Error(closeError.message);
  } catch (err) {
    console.error('[chat/schedules] could not close a job’s notices:', err);
  }
}

/** Most parts a run row counts (chat_schedule_runs.parts_total). */
const MAX_PARTS = 50;

/**
 * A run's parts ("1 of 3 ready", CHAT-12 item 13): its task strip's tasks
 * ready of all of them, else the files it made so far, each a part that is
 * ready. 0 of 0: one part, no bar.
 */
export async function partsOf(
  chat: Pick<LoadedRun, 'id' | 'conversationId' | 'progress'>,
): Promise<{ done: number; total: number }> {
  if (chat.progress.taskStrip) {
    const weekEnd = weekEndIn(new Date(), chat.progress.timezone);
    const strip = (await readStrips(supabaseAdmin, chat.conversationId, weekEnd, chat.id)).get(
      chat.id,
    );
    if (strip) {
      const total = Math.min(MAX_PARTS, strip.total);
      return { done: Math.min(total, strip.ready), total };
    }
  }
  const { count, error } = await supabaseAdmin
    .from('chat_files')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', chat.id);
  if (error) throw new Error(`Could not count a run's files: ${error.message}`);
  const files = Math.min(MAX_PARTS, count ?? 0);
  return { done: files, total: files };
}

/** The statuses a run row ends or waits in, as settleScheduleRun moves it. */
export type SettledStatus =
  | 'running'
  | 'needs_you'
  | 'paused_cap'
  | 'done'
  | 'unchanged'
  | 'failed'
  | 'skipped';

/**
 * Keeps what a run left (above) on its row and its job, after its row
 * moved to `status`: its parts and fingerprint; a delivered run's
 * fingerprint as the job's last; the job's notices closed once a run goes
 * on; a failed retry told; a done run e-mailed for a job that delivers by
 * e-mail (email.ts, W3-04b). A job with a due time (`readyBy`) tells and
 * e-mails its delivery instead. Never throws.
 */
export async function keepRunResult(
  run: { id: string; schedule_id: string; attempt: number },
  status: SettledStatus,
  chat: Pick<LoadedRun, 'id' | 'conversationId' | 'progress' | 'messageId'> | null,
  {
    reason = null,
    jobOn = true,
    now = new Date(),
    readyBy = false,
  }: {
    reason?: string | null;
    jobOn?: boolean;
    now?: Date;
    readyBy?: boolean;
  } = {},
): Promise<void> {
  try {
    if (chat) {
      const parts = await partsOf(chat);
      const { error } = await supabaseAdmin
        .from('chat_schedule_runs')
        .update({
          parts_done: parts.done,
          parts_total: parts.total,
          ...(chat.progress.fingerprint ? { fingerprint: chat.progress.fingerprint } : {}),
        })
        .eq('id', run.id);
      if (error) throw new Error(error.message);
    }
    if (status === 'done' || status === 'unchanged') {
      // A delivered run is what the next change-only run compares to; No change keeps the last.
      if (status === 'done' && chat?.progress.fingerprint) {
        const { error } = await supabaseAdmin
          .from('chat_schedules')
          .update({ last_fingerprint: chat.progress.fingerprint })
          .eq('id', run.schedule_id);
        if (error) throw new Error(error.message);
      }
      await closeJobNotices(run.schedule_id, now);
    }
    // Done, not No change: its result by e-mail too, for a job that delivers by e-mail (W3-04b).
    if (status === 'done' && chat && !readyBy) emailRunResult(run, chat);
    // The first failure is tried again in 10 minutes: only a failed retry is told (CHAT-12
    // item 26). A job that turned off on it is told so by its own notice.
    if (status === 'failed' && run.attempt >= 2 && jobOn && !readyBy) {
      await noticeRunFailed(run.schedule_id, run.id, reason ?? t('failed'));
    }
  } catch (err) {
    console.error('[chat/schedules] could not keep what a run left:', err);
  }
}

// ─── A job with a due time (W4-30) ───────────────────────────────────────────

/** A job with a due time as its delivery reads it. */
export interface ReadyByJob {
  id: string;
  organization_id: string;
  title: string;
  brand_id: string | null;
  created_by: string | null;
  conversation_id: string | null;
  due_at: string | null;
  timezone: string;
}

/**
 * What is ready of a job with a due time, and what isn't yet, by name: its
 * chat's Action Center tasks (Ready for review or Done, else not yet), else
 * what its runs made (Files), or its answer once a run is done; with no
 * run done, the job itself is what isn't ready.
 */
export async function readyByParts(
  job: ReadyByJob,
  zone: string,
  now: Date,
): Promise<{ ready: string[]; rest: string[] }> {
  if (job.conversation_id) {
    const strips = await readStrips(supabaseAdmin, job.conversation_id, weekEndIn(now, zone));
    const tasks = [...strips.values()].flatMap((strip) => strip.tasks);
    if (tasks.length > 0) {
      const ready = (status: string) => status === 'ready_for_review' || status === 'done';
      const name = (task: { title: string }) => task.title || tTasks('untitled');
      return {
        ready: tasks.filter((task) => ready(task.status)).map(name),
        rest: tasks.filter((task) => !ready(task.status)).map(name),
      };
    }
  }
  const { data, error } = await supabaseAdmin
    .from('chat_schedule_runs')
    .select('run_id, status')
    .eq('schedule_id', job.id);
  if (error) throw new Error(`Could not read a job's runs: ${error.message}`);
  const runs = (data ?? []) as { run_id: string | null; status: string }[];
  const runIds = runs.map((run) => run.run_id).filter((id): id is string => !!id);
  let made: string[] = [];
  if (runIds.length > 0) {
    const { data: files, error: filesError } = await supabaseAdmin
      .from('chat_files')
      .select('title')
      .in('run_id', runIds)
      .is('message_id', null)
      .order('created_at', { ascending: true });
    if (filesError) throw new Error(`Could not read a job's files: ${filesError.message}`);
    made = ((files ?? []) as { title: string }[]).map((file) => file.title).slice(0, MAX_PARTS);
  }
  const done = runs.some((run) => run.status === 'done');
  return {
    ready: made.length > 0 ? made : done ? [tReady('answer')] : [],
    rest: done ? [] : [job.title],
  };
}

async function insertId(table: string, row: Record<string, unknown>, what: string) {
  const { data, error } = await supabaseAdmin
    .from(table as 'chat_messages')
    .insert(row as never)
    .select('id')
    .single();
  if (error || !data) {
    const failure = new Error(`Could not ${what}: ${error?.message ?? 'no row'}`);
    (failure as Error & { code?: string }).code = error?.code;
    throw failure;
  }
  return (data as { id: string }).id;
}

/** The job's live chat, made when it has none (it never ran). */
async function readyByChat(job: ReadyByJob): Promise<string> {
  const live = async () => {
    const { data, error } = await supabaseAdmin
      .from('chat_conversations')
      .select('id')
      .eq('schedule_id', job.id)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`Could not read a job's chat: ${error.message}`);
    return ((data ?? []) as { id: string }[])[0]?.id ?? null;
  };
  const found = await live();
  if (found) return found;
  try {
    const id = await insertId(
      'chat_conversations',
      {
        organization_id: job.organization_id,
        user_id: job.created_by,
        brand_id: job.brand_id,
        title: job.title.slice(0, 200),
        origin: 'schedule',
        schedule_id: job.id,
      },
      "start a job's chat",
    );
    await startTouchedBrands(id);
    return id;
  } catch (err) {
    // Made by another worker at the same time: one live chat per job.
    const again = (err as { code?: string }).code === '23505' ? await live() : null;
    if (again) return again;
    throw err;
  }
}

/**
 * Delivers a job with a due time (ready-by.ts), once the worker claimed its
 * delivery: an answer in its chat, in its creator's time zone, says why
 * (all ready, its tries used up, or the due time came), how many parts are
 * ready, what is and what isn't yet. Its run's chat counts as a new result
 * in their Inbox; its row in the job's runs (Done, "2 of 3 ready") carries
 * the e-mail for a job that delivers by e-mail (email.ts). Throws when the
 * answer couldn't be written: the worker gives the delivery back.
 */
export async function deliverReadyBy(job: ReadyByJob, why: ReadyByWhy, now: Date): Promise<void> {
  if (!job.created_by || !job.due_at) return;
  const zone = (await readChosenTimeZone(job.created_by)) ?? job.timezone;
  const parts = await readyByParts(job, zone, now);
  const chatId = await readyByChat(job);
  const answerId = await insertId(
    'chat_messages',
    {
      conversation_id: chatId,
      role: 'assistant',
      content_md: readyByAnswer({
        why,
        title: job.title,
        due: dateWords(job.due_at, zone, now, tWhen),
        ...parts,
      }),
      timezone: zone,
      generated_at: now.toISOString(),
    },
    "write a job's delivery",
  );
  // A run that ended as it began: the chat list and Inbox show it as an unread result.
  const chatRunId = await insertId(
    'chat_runs',
    {
      message_id: answerId,
      conversation_id: chatId,
      status: 'done',
      started_at: now.toISOString(),
      finished_at: now.toISOString(),
    },
    "keep a job's delivery",
  );
  const total = Math.min(MAX_PARTS, parts.ready.length + parts.rest.length);
  const runRowId = await insertId(
    'chat_schedule_runs',
    {
      schedule_id: job.id,
      slot_at: now.toISOString(),
      attempt: 1,
      status: 'done',
      run_id: chatRunId,
      message_id: answerId,
      parts_done: Math.min(total, parts.ready.length),
      parts_total: total,
      started_at: now.toISOString(),
      ended_at: now.toISOString(),
    },
    "keep a job's delivery",
  );
  if (job.conversation_id !== chatId) {
    const { error } = await supabaseAdmin
      .from('chat_schedules')
      .update({ conversation_id: chatId })
      .eq('id', job.id);
    if (error) console.error('[chat/schedules] could not keep a job’s chat:', error.message);
  }
  // By e-mail too, for a job that delivers by e-mail (W3-04b).
  emailRunResult({ id: runRowId, schedule_id: job.id }, { messageId: answerId });
}
