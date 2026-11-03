import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isTimeZone } from '@/lib/time-zone';
import type { PlanFacts } from '../plan-facts';
import { closeJobNotices } from './deliver';
import {
  activeScheduleLimit,
  countActiveSchedules,
  deliverToOf,
  firstRunOf,
  type DeliverChoice,
} from './store';
import { canSeeJob, type ScheduleReader } from './views';
import { readWhen, whenHint, whenPhrase, type ScheduleWhen, type WhenWords } from './when';

/**
 * What the Scheduled page changes (CHAT-12 items 22–25; W3-03), checked for
 * the person now and written with the service role: on and off (on again
 * runs from now, with no catch-up runs, within the plan's active jobs),
 * Delete, edits (no confirm card: the page is the person's own), and an
 * Admin's Take over of a job its creator can no longer run (Wave 3
 * decision 16). Its creator and Admins switch and delete a job; only its
 * creator edits it, as its runs act as them. Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules.page.errors' });
const whenT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatSchedules.when',
}) as unknown as WhenWords;

export type ManageResult = { ok: true } | { ok: false; reason: string; message: string };

/** Why a change was refused (chatSchedules.page.errors). */
type Refusal =
  | 'not_found'
  | 'forbidden'
  | 'owner'
  | 'passed'
  | 'limit'
  | 'when'
  | 'prompt'
  | 'zone';

const refused = (reason: Refusal, message: string = t(reason)): ManageResult => ({
  ok: false,
  reason,
  message,
});

const JOB_COLUMNS =
  'id, organization_id, kind, run_mode, due_at, rrule, timezone, created_by, brand_id, enabled, paused_reason';

interface ManagedJob {
  id: string;
  organization_id: string;
  kind: 'once' | 'recurring' | 'followup_check';
  run_mode: 'run_at' | 'ready_by';
  due_at: string | null;
  rrule: string | null;
  timezone: string;
  created_by: string | null;
  brand_id: string | null;
  enabled: boolean;
  paused_reason: string | null;
}

/** The job, when the reader may see it in their workspace. */
async function readJob(reader: ScheduleReader, id: string): Promise<ManagedJob | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_schedules')
    .select(JOB_COLUMNS)
    .eq('id', id)
    .eq('organization_id', reader.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the scheduled job: ${error.message}`);
  const job = data as ManagedJob | null;
  return job && canSeeJob(reader, job) ? job : null;
}

const manages = (reader: ScheduleReader, job: ManagedJob) =>
  reader.role === 'admin' || job.created_by === reader.userId;

/** Room for one more job on: a follow-up check needs none. */
async function hasRoomFor(plan: PlanFacts, job: Pick<ManagedJob, 'kind' | 'organization_id'>) {
  if (job.kind === 'followup_check') return true;
  const limit = activeScheduleLimit(plan);
  return limit === null || (await countActiveSchedules(job.organization_id)) < limit;
}

/** When a job turned on now runs next: no catch-up; null once a one-time job's time passed. */
function nextFromNow(job: ManagedJob, now: Date): string | null {
  if (job.kind === 'recurring' && job.rrule) {
    return firstRunOf({ kind: 'recurring', rrule: job.rrule }, job.timezone, now);
  }
  if (!job.due_at || Date.parse(job.due_at) <= now.getTime()) return null;
  return job.run_mode === 'ready_by' ? now.toISOString() : job.due_at;
}

/** Turns a job on (from now) or off (by hand). */
export async function setScheduleOn(
  reader: ScheduleReader,
  plan: PlanFacts,
  id: string,
  on: boolean,
  now: Date = new Date(),
): Promise<ManageResult> {
  const job = await readJob(reader, id);
  if (!job) return refused('not_found');
  if (!manages(reader, job)) return refused('forbidden');
  if (!on) {
    const { error } = await supabaseAdmin
      .from('chat_schedules')
      .update({ enabled: false, paused_reason: 'manual', retry_at: null })
      .eq('id', id);
    if (error) throw new Error(`Could not turn the job off: ${error.message}`);
    return { ok: true };
  }
  if (job.enabled) return { ok: true };
  // A job its creator can't run stays off until an Admin takes it over.
  if (job.paused_reason === 'owner_role' || !job.created_by) return refused('owner');
  const next = nextFromNow(job, now);
  if (!next) return refused('passed');
  if (!(await hasRoomFor(plan, job))) return refused('limit');
  const { error } = await supabaseAdmin
    .from('chat_schedules')
    .update({
      enabled: true,
      paused_reason: null,
      fail_count: 0,
      retry_at: null,
      next_run_at: next,
    })
    .eq('id', id);
  if (error) throw new Error(`Could not turn the job on: ${error.message}`);
  await closeJobNotices(id, now);
  return { ok: true };
}

/** Deletes a job; its chat and what it filed stay. */
export async function deleteSchedule(reader: ScheduleReader, id: string): Promise<ManageResult> {
  const job = await readJob(reader, id);
  if (!job) return refused('not_found');
  if (!manages(reader, job)) return refused('forbidden');
  const { error } = await supabaseAdmin.from('chat_schedules').delete().eq('id', id);
  if (error) throw new Error(`Could not delete the job: ${error.message}`);
  return { ok: true };
}

/**
 * An Admin takes over a job its creator can no longer run (Wave 3 decision
 * 16): it is theirs, acts as them, and is on again from now.
 */
export async function takeOverSchedule(
  reader: ScheduleReader,
  plan: PlanFacts,
  id: string,
  now: Date = new Date(),
): Promise<ManageResult> {
  const job = await readJob(reader, id);
  if (!job) return refused('not_found');
  if (reader.role !== 'admin' || job.enabled || job.paused_reason !== 'owner_role') {
    return refused('forbidden');
  }
  const next = nextFromNow(job, now);
  if (!next) return refused('passed');
  if (!(await hasRoomFor(plan, job))) return refused('limit');
  // Its notices are its old creator's: closed while the job is still theirs.
  await closeJobNotices(id, now);
  const { error } = await supabaseAdmin
    .from('chat_schedules')
    .update({
      created_by: reader.userId,
      enabled: true,
      paused_reason: null,
      fail_count: 0,
      retry_at: null,
      next_run_at: next,
      // Its old chat was its creator's: the next run opens one for the Admin.
      conversation_id: null,
    })
    .eq('id', id);
  if (error) throw new Error(`Could not take the job over: ${error.message}`);
  return { ok: true };
}

/** The job's page edits (CHAT-12 item 23). */
export interface ScheduleEdits {
  title: string;
  prompt: string;
  when: string;
  deliver: DeliverChoice;
  changeOnly: boolean;
  /** The job's own time zone, changed on its page; left out, it keeps the one it has. */
  timezone?: string;
}

/** The When a job keeps now, as its page reads it; null for a follow-up check. */
function whenOfJob(job: ManagedJob): ScheduleWhen | null {
  if (job.kind === 'recurring' && job.rrule) return { kind: 'recurring', rrule: job.rrule };
  if (job.kind === 'once' && job.due_at) {
    return { kind: 'once', runMode: job.run_mode, dueAt: job.due_at };
  }
  return null;
}

const sameWhen = (a: ScheduleWhen, b: ScheduleWhen) =>
  a.kind === 'recurring'
    ? b.kind === 'recurring' && a.rrule === b.rrule
    : b.kind === 'once' && a.runMode === b.runMode && Date.parse(a.dueAt) === Date.parse(b.dueAt);

/**
 * Saves its creator's edits, with no confirm card (item 23): When read on
 * the job's own clock (the zone the page sets, else the one it has), its
 * next run from now when it is on. The person's Settings › Account zone
 * never moves a job: only this does. A When left as it was, on the same
 * zone, keeps the job's timing: a one-time job that already ran isn't run
 * again, and one whose time passed still saves its other edits.
 */
export async function updateSchedule(
  reader: ScheduleReader,
  id: string,
  edits: ScheduleEdits,
  now: Date = new Date(),
): Promise<ManageResult> {
  const job = await readJob(reader, id);
  if (!job) return refused('not_found');
  if (job.created_by !== reader.userId || job.kind === 'followup_check') {
    return refused('forbidden');
  }
  if (edits.timezone !== undefined && !isTimeZone(edits.timezone)) return refused('zone');
  const zone = edits.timezone ?? job.timezone;
  // A new zone reads When again on the new clock and makes the next run again.
  const moved = zone !== job.timezone;
  const kept = whenOfJob(job);
  let when: ScheduleWhen | null = null;
  if (!kept || moved || edits.when.trim() !== whenPhrase(kept, job.timezone)) {
    const reading = readWhen(edits.when, { now, timeZone: zone });
    if (!reading.ok) {
      return refused('when', whenHint(edits.when, zone, now, whenT).hint);
    }
    if (!kept || moved || !sameWhen(reading.when, kept)) when = reading.when;
  }
  const { data: current, error: readError } = await supabaseAdmin
    .from('chat_schedules')
    .select('skill_name')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new Error(`Could not read the job: ${readError.message}`);
  const prompt = edits.prompt.trim();
  if (!prompt && !(current as { skill_name: string | null } | null)?.skill_name) {
    return refused('prompt');
  }
  const recurring = (when ?? kept)?.kind === 'recurring';
  const timing = when
    ? {
        kind: when.kind,
        run_mode: when.kind === 'once' ? when.runMode : 'run_at',
        due_at: when.kind === 'once' ? when.dueAt : null,
        rrule: when.kind === 'recurring' ? when.rrule : null,
        ...(job.enabled ? { next_run_at: firstRunOf(when, zone, now), retry_at: null } : {}),
      }
    : {};
  const { error } = await supabaseAdmin
    .from('chat_schedules')
    .update({
      title: edits.title.trim(),
      prompt: prompt || null,
      ...timing,
      timezone: zone,
      deliver_to: deliverToOf(edits.deliver),
      change_only: recurring && edits.changeOnly,
    })
    .eq('id', id);
  if (error) throw new Error(`Could not save the job: ${error.message}`);
  return { ok: true };
}
