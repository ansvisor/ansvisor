/**
 * The daily suggestions' reads that the Action Center's Today card shares
 * (AC-011): the open actions a person may get, what "Start now" opens, and
 * the time zones the people's days are read in. job.js reads with them for
 * the nightly pick, and action-center/today.js for the Today card, so both
 * rank the same actions (rules.js rankActions) from the same rows.
 */

import { selectInChunks } from '../chunked-in.js';
import { DRAFT_TASK_KEYS, TASK_DONE } from '../content-published.js';
import { OPEN_STATUSES } from './rules.js';

const DAY_MS = 86_400_000;

/** Open actions read per brand, highest priority first: far more than the lifts can reorder. */
export const MAX_CANDIDATES = 500;
/** A workspace's latest Chat answers read for its people's time zones, and over how many days. */
export const ZONE_ANSWERS = 300;
export const ZONE_DAYS = 30;

/** A failed read or write, by what it was and the database's code: never its values. */
export class SuggestionsDbError extends Error {
  constructor(what, error) {
    super(`${what} failed`);
    this.name = 'SuggestionsDbError';
    this.code = error?.code ?? null;
  }
}

/** A chunked read's rows, or a thrown SuggestionsDbError. */
export async function readChunks(what, ids, build) {
  const { data, error } = await selectInChunks(ids, build);
  if (error) throw new SuggestionsDbError(what, error);
  return data ?? [];
}

/** The workspace's latest Chat answers' time zones, newest first (resolveZones). */
export async function loadAnswerZones(db, orgId, now) {
  const { data, error } = await db
    .from('chat_messages')
    .select(
      'timezone, created_at, chat_conversations!chat_messages_conversation_id_fkey!inner(user_id, organization_id)',
    )
    .eq('chat_conversations.organization_id', orgId)
    .eq('role', 'assistant')
    .not('timezone', 'is', null)
    .gte('created_at', new Date(now.getTime() - ZONE_DAYS * DAY_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(ZONE_ANSWERS);
  if (error) throw new SuggestionsDbError('time zones read', error);
  return (data ?? []).map((row) => ({
    userId: row.chat_conversations?.user_id ?? null,
    timezone: row.timezone,
  }));
}

/**
 * The brand's open actions the people due may get, highest priority first:
 * the unassigned ones and those assigned to one of them, MAX_CANDIDATES of
 * each, so actions assigned to someone else never take the places. Their
 * payloads and reasons are read for the picked ones only (loadPicked).
 */
export async function loadCandidates(db, brandId, userIds) {
  const open = () =>
    db
      .from('actions')
      .select(
        'id, action_no, kind, category, impact, status, priority_score, created_at, assignee_id',
      )
      .eq('brand_id', brandId)
      .in('status', OPEN_STATUSES)
      .is('deleted_at', null);
  const ranked = (query) =>
    query
      .order('priority_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(MAX_CANDIDATES);
  const [unassigned, assigned] = await Promise.all([
    ranked(open().is('assignee_id', null)),
    readChunks('assigned actions read', userIds, (chunk) =>
      ranked(open().in('assignee_id', chunk)),
    ),
  ]);
  if (unassigned.error) throw new SuggestionsDbError('actions read', unassigned.error);
  return [...(unassigned.data ?? []), ...assigned];
}

const WRITING_TASKS = [...DRAFT_TASK_KEYS.create, ...DRAFT_TASK_KEYS.optimize];

/**
 * The actions "Start now" opens in the Content Editor: those with a writing
 * task still to do (CE-022's Create content / Optimize page), and the draft
 * it opens, a new page first.
 *
 * @returns {Promise<Map<string, 'create' | 'optimize'>>}
 */
export async function loadStartNow(db, actionIds) {
  const tasks = await readChunks('writing tasks read', actionIds, (chunk) =>
    db
      .from('action_tasks')
      .select('action_id, task_key, status')
      .in('action_id', chunk)
      .in('task_key', WRITING_TASKS),
  );
  const methods = new Map();
  for (const task of tasks) {
    if (TASK_DONE.includes(task.status)) continue;
    const method = DRAFT_TASK_KEYS.create.includes(task.task_key) ? 'create' : 'optimize';
    if (method === 'create' || !methods.has(task.action_id)) methods.set(task.action_id, method);
  }
  return methods;
}
