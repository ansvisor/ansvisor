import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { FAILED, NOT_FOUND, type Where } from './chat-send';
import type { ChatActionFailure } from '@/lib/actions/chat-action-center';

/**
 * Ready for review's change (set_task_ready_for_review, CHAT-09 item 16a),
 * once its caller checked who may make it: the signed-in person's server
 * action (actions/chat-action-center.ts, their session reading the task) or
 * an agent's run with no session behind it, for its person
 * (chat/actor/action-center.ts, the service role reading the task within
 * the brand). It is Chat's status for the task in the chat's strip
 * (chat_task_state, 00418), and an event in the task's History; the task's
 * own Action Center status doesn't change. Server only.
 */

const OPEN_TASK = new Set(['todo', 'in_progress', 'waiting_approval']);

export type ReadyForReviewResult =
  | {
      ok: true;
      task_id: string;
      action_id: string;
      conversation_id: string;
      /** Chat's status for the task before, null when the strip didn't have it: what Undo puts back. */
      previous: string | null;
    }
  | ChatActionFailure;

/** One of the brand's tasks, read by `db`: the person's session, or the service role. */
export async function brandTask(db: SupabaseClient, brandId: string, taskId: string) {
  const { data, error } = await db
    .from('action_tasks')
    .select('id, action_id, task_key, title, status, actions!inner(brand_id, status)')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as {
    id: string;
    action_id: string;
    task_key: string | null;
    title: string | null;
    status: string;
    actions: { brand_id: string; status: string } | null;
  } | null;
  if (!row || row.actions?.brand_id !== brandId) return null;
  return row;
}

/** How the change was approved, for History's execution.mode (§10a): as the server read it. */
export const executionOf = (where: Where | null) =>
  where?.executionMode ? { mode: where.executionMode } : null;

/**
 * Sets a task Ready for review in the chat `where` names. `db` reads the
 * task and writes its History event (the person's session, or the service
 * role); `actorId` is who the event names.
 */
export async function markReadyForReview(
  db: SupabaseClient,
  {
    brandId,
    taskId,
    where,
    actorId,
  }: { brandId: string; taskId: string; where: Where | null; actorId: string | null },
): Promise<ReadyForReviewResult> {
  const task = await brandTask(db, brandId, taskId);
  if (!task) return NOT_FOUND('task');
  if (!OPEN_TASK.has(task.status)) {
    return {
      ok: false,
      reason: 'conflict',
      message: 'That task is already done or skipped in Action Center.',
    };
  }
  if (!where) {
    return { ok: false, reason: 'invalid', message: 'Ready for review is set from a chat.' };
  }
  // Its chat's brand: a chat about one brand doesn't mark another's tasks.
  if (where.brandId && where.brandId !== brandId) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'This chat is about another brand: set Ready for review from its own chat.',
    };
  }
  const { data: state, error: stateError } = await supabaseAdmin
    .from('chat_task_state')
    .select('chat_status')
    .eq('conversation_id', where.conversationId)
    .eq('action_task_id', task.id)
    .maybeSingle();
  if (stateError) throw new Error(stateError.message);
  const previous = (state?.chat_status as string | undefined) ?? null;
  const done = {
    ok: true as const,
    task_id: task.id,
    action_id: task.action_id,
    conversation_id: where.conversationId,
    previous,
  };
  if (previous === 'ready_for_review' || previous === 'done') return done;
  if (previous) {
    const { error } = await supabaseAdmin
      .from('chat_task_state')
      .update({ chat_status: 'ready_for_review', run_id: where.runId })
      .eq('conversation_id', where.conversationId)
      .eq('action_task_id', task.id);
    if (error) throw new Error(error.message);
  } else {
    // A task the strip didn't list yet: it goes last.
    const { data: last, error: lastError } = await supabaseAdmin
      .from('chat_task_state')
      .select('position')
      .eq('conversation_id', where.conversationId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw new Error(lastError.message);
    const { error } = await supabaseAdmin.from('chat_task_state').insert({
      conversation_id: where.conversationId,
      action_task_id: task.id,
      position: Number(last?.position ?? 0) + 1,
      chat_status: 'ready_for_review',
      run_id: where.runId,
    });
    if (error) throw new Error(error.message);
  }
  const { error: eventError } = await db.from('action_events').insert({
    action_id: task.action_id,
    event: 'task_ready_for_review',
    actor_id: actorId,
    data: {
      source: 'chat',
      taskId: task.id,
      task: task.task_key,
      title: task.title,
      conversationId: where.conversationId,
      runId: where.runId,
      execution: executionOf(where),
    } as Json,
  });
  if (eventError)
    console.error('[chat/action-center] Ready for review not in History:', eventError);
  return done;
}

/** The caller's failure, logged once, in the engine's words. */
export function readyForReviewFailed(err: unknown): ChatActionFailure {
  console.error('[chat/action-center] could not set Ready for review:', err);
  return FAILED("The task couldn't be set to Ready for review.");
}
