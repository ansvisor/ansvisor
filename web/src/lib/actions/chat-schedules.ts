'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { assertWritable } from '@/lib/subscription-guard';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { readPrecedenceContext } from '@/lib/chat/precedence-context';
import { newSchedule, scheduleInputSchema } from '@/lib/chat/schedule/input';
import { contentUuid } from '@/lib/mcp/content-schemas';
import {
  deleteSchedule,
  setScheduleOn,
  takeOverSchedule,
  updateSchedule,
  type ManageResult,
} from '@/lib/chat/schedule/manage';
import {
  DELIVER_CHOICES,
  activeScheduleLimit,
  countActiveSchedules,
  createSchedule,
  type MadeSchedule,
  type NewSchedule,
  type ScheduleRefusal,
} from '@/lib/chat/schedule/store';
import {
  readScheduleDetail,
  readScheduleList,
  type AgentScheduleItem,
  type ScheduleListItem,
  type ScheduleReader,
  type ScheduleRunView,
} from '@/lib/chat/schedule/views';
import { WHEN_MAX_LENGTH } from '@/lib/chat/schedule/when';
import { runJobNow, type RunNowResult } from '@/lib/chat/schedule/worker';

/**
 * Chat's scheduled jobs, as the signed-in person (CHAT-12; W3-02, W3-03):
 * the change the schedule card's Create schedule makes, and the Scheduled
 * page's list, job page, on and off, Run now, edits, Delete and an Admin's
 * Take over. Through their session as the app's other changes are; every
 * change is refused while the workspace is read-only (and on the demo
 * brand). Rows are read and written with the service role after the
 * checks in lib/chat/schedule/ (store, views, manage). Behind CHAT_AGENTIC.
 */

/** The signed-in person and their workspace, with Chat on; null otherwise. */
async function member(): Promise<{ userId: string; organizationId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the member: ${error.message}`);
  const organizationId = profile?.organization_id as string | null | undefined;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return null;
  return { userId: user.id, organizationId };
}

/** Where the card was: the run's clock and the run. */
const placeSchema = z.object({
  timezone: z.string().max(100),
  runId: contentUuid.nullable(),
});

/**
 * Makes a scheduled job from its card's click: the job as the card had it,
 * read on the person's clock (`timezone`, the run's: their Settings ›
 * Account zone, else their browser's), named with the run whose card made
 * it. Read again with the create_schedule tool's schema: a server action can
 * be called with anything.
 */
export async function createChatSchedule(
  input: NewSchedule,
  place: { timezone: string; runId: string | null },
): Promise<MadeSchedule | ScheduleRefusal> {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<NewSchedule>;
  const parsed = scheduleInputSchema.safeParse({
    brand_id: raw.brandId ?? undefined,
    title: raw.title,
    when: raw.when,
    prompt: raw.prompt,
    skill: raw.skill,
    deliver_to: raw.deliver,
    change_only: raw.changeOnly,
    whats_new: raw.digest === 'whats_new',
  });
  const where = placeSchema.safeParse(place);
  if (!parsed.success || !where.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: (parsed.error ?? where.error)?.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const job = newSchedule(parsed.data);
  await assertWritable({ brandId: job.brandId });
  const who = await member();
  if (!who) return { ok: false, reason: 'forbidden_role', message: 'Chat is off.' };
  return createSchedule({ ...who, ...where.data }, job);
}

/** The reader the Scheduled page reads and changes as: role, plan and brands, read now. */
async function reader() {
  const who = await member();
  if (!who) return null;
  const ctx = await readPrecedenceContext({
    userId: who.userId,
    organizationId: who.organizationId,
    mode: 'auto',
    surface: 'chat',
  });
  if (!ctx) return null;
  const read: ScheduleReader = {
    userId: who.userId,
    organizationId: who.organizationId,
    role: ctx.role,
    brandAccess: ctx.brandAccess,
  };
  return { read, plan: ctx.plan };
}

export type ScheduleListRead =
  | {
      ok: true;
      jobs: ScheduleListItem[];
      agents: AgentScheduleItem[];
      admin: boolean;
      /** Active jobs on, of the plan's limit (null: none). */
      active: number;
      limit: number | null;
      /** Admins and Managers schedule work (New schedule). */
      canCreate: boolean;
    }
  | { ok: false };

/** The Scheduled page's rows (W3-03). */
export async function listChatSchedules(): Promise<ScheduleListRead> {
  try {
    const me = await reader();
    if (!me) return { ok: false };
    const [list, active] = await Promise.all([
      readScheduleList(me.read),
      countActiveSchedules(me.read.organizationId),
    ]);
    return {
      ok: true,
      ...list,
      admin: me.read.role === 'admin',
      active,
      limit: activeScheduleLimit(me.plan),
      canCreate: me.read.role === 'admin' || me.read.role === 'manager',
    };
  } catch (err) {
    console.error('[chat/schedules] could not list the jobs:', err);
    return { ok: false };
  }
}

/** A job's page: the job and its last 20 runs; null when the person can't see it. */
export async function getChatSchedule(
  id: string,
): Promise<{ job: ScheduleListItem; runs: ScheduleRunView[] } | null> {
  if (!z.guid().safeParse(id).success) return null;
  const me = await reader();
  if (!me) return null;
  return readScheduleDetail(me.read, id);
}

/** The person's own jobs that are on: the Chat menu's Scheduled count. */
export async function countChatSchedules(): Promise<number> {
  try {
    const who = await member();
    if (!who) return 0;
    const { count, error } = await supabaseAdmin
      .from('chat_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', who.organizationId)
      .eq('created_by', who.userId)
      .eq('enabled', true);
    if (error) throw new Error(error.message);
    return count ?? 0;
  } catch (err) {
    console.error('[chat/schedules] could not count the jobs:', err);
    return 0;
  }
}

const idInput = z.guid();
const NOT_SIGNED_IN: ManageResult = { ok: false, reason: 'not_found', message: 'Not found' };

/** Turns a job on (from now, no catch-up) or off. */
export async function setChatScheduleOn(id: string, on: boolean): Promise<ManageResult> {
  await assertWritable();
  const me = await reader();
  if (!me || !idInput.safeParse(id).success) return NOT_SIGNED_IN;
  return setScheduleOn(me.read, me.plan, id, on === true);
}

/** Deletes a job; past results stay in Files. */
export async function deleteChatSchedule(id: string): Promise<ManageResult> {
  await assertWritable();
  const me = await reader();
  if (!me || !idInput.safeParse(id).success) return NOT_SIGNED_IN;
  return deleteSchedule(me.read, id);
}

/** An Admin takes over a job its creator can no longer run. */
export async function takeOverChatSchedule(id: string): Promise<ManageResult> {
  await assertWritable();
  const me = await reader();
  if (!me || !idInput.safeParse(id).success) return NOT_SIGNED_IN;
  return takeOverSchedule(me.read, me.plan, id);
}

const editsInput = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().max(2000),
  when: z.string().trim().min(1).max(WHEN_MAX_LENGTH),
  deliver: z.enum(DELIVER_CHOICES),
  changeOnly: z.boolean(),
  /** The job's own time zone; left out, it keeps the one it has. */
  timezone: z.string().trim().min(1).max(64).optional(),
});

/** Saves the job page's edits (no confirm card, item 23). */
export async function updateChatSchedule(id: string, edits: unknown): Promise<ManageResult> {
  await assertWritable();
  const me = await reader();
  const parsed = editsInput.safeParse(edits);
  if (!me || !idInput.safeParse(id).success) return NOT_SIGNED_IN;
  if (!parsed.success) return { ok: false, reason: 'invalid', message: 'Check the fields.' };
  return updateSchedule(me.read, id, parsed.data);
}

/** Run now: one run at once, as its creator. */
export async function runChatScheduleNow(
  id: string,
): Promise<RunNowResult | { kind: 'forbidden' }> {
  await assertWritable();
  const me = await reader();
  if (!me || !idInput.safeParse(id).success) return { kind: 'gone' };
  const detail = await readScheduleDetail(me.read, id);
  if (!detail) return { kind: 'gone' };
  if (!detail.job.canEdit) return { kind: 'forbidden' };
  return runJobNow(id);
}
