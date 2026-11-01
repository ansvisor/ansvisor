import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaskStatus } from '@/lib/action-center/registry';

/**
 * The Action Center's own writes of a task's status, shared by its drawer
 * (updateTaskStatus) and Chat's "Attach to task & mark done" (CHAT-09 item
 * 13), so both go one way: the task's row, its History event as the person
 * who clicked, and the action's Updated stamp. Run with the person's client:
 * their session is the actor, and the database's policies hold. Kept out of
 * the 'use server' module, which may only export async functions it serves.
 */

type Client = Pick<SupabaseClient, 'from' | 'auth'>;

/** A History event's data: plain values, as the History tab reads them. */
export type EventData = Record<string, string | number | boolean | null>;

/** The action's History event, as the person; best effort, never failing the change it records. */
export async function logEvent(supabase: Client, actionId: string, event: string, data: EventData) {
  const { data: auth } = await supabase.auth.getUser();
  await supabase
    .from('action_events')
    .insert({ action_id: actionId, event, data, actor_id: auth.user?.id ?? null });
}

/** Bump the action's updated stamp so the table's Updated column tracks real
 *  work, not just nightly refreshes. */
export async function touchAction(supabase: Client, brandId: string, actionId: string) {
  await supabase
    .from('actions')
    .update({ updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('id', actionId);
}

/**
 * A task's status, as the drawer sets it: the row (a skip with why, any
 * other status clearing it), its `task_status` event with what `data` adds
 * (Chat's source and file), and the action's Updated stamp.
 */
export async function writeTaskStatus(
  supabase: Client,
  task: { brandId: string; actionId: string; taskId: string },
  status: TaskStatus,
  { skipReason = null, data = {} }: { skipReason?: string | null; data?: EventData } = {},
): Promise<void> {
  const { error } = await supabase
    .from('action_tasks')
    .update({ status, skip_reason: skipReason, updated_at: new Date().toISOString() })
    .eq('action_id', task.actionId)
    .eq('id', task.taskId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, task.actionId, 'task_status', {
    taskId: task.taskId,
    to: status,
    ...(skipReason ? { reason: skipReason } : {}),
    ...data,
  });
  await touchAction(supabase, task.brandId, task.actionId);
}
