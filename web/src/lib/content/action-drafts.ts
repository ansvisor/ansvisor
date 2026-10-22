/**
 * The Content Editor and the Action Center, both ways (CE-022, spec §15): an
 * action's writing task opens a draft linked to the action, and marking that
 * draft Ready completes the task.
 *
 * A draft is linked through content_drafts.action_id (00208). An action can
 * hold a new page's task and an existing page's, and name several pages: it
 * gets one draft per kind of work and page (00218).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftMethod, DraftStatus } from './drafts';

/** The library tasks a draft is the work of, by the draft's method. */
export const DRAFT_TASK_KEYS: Record<DraftMethod, readonly string[]> = {
  create: ['create_content_draft'],
  optimize: ['optimize_content', 'refresh_content'],
};

/** The draft a task is written in: a new page, or an existing page's new version. */
export function draftMethodForTask(taskKey: string | null | undefined): DraftMethod | null {
  if (!taskKey) return null;
  if (DRAFT_TASK_KEYS.create.includes(taskKey)) return 'create';
  if (DRAFT_TASK_KEYS.optimize.includes(taskKey)) return 'optimize';
  return null;
}

/** A draft linked to an action, as the action's tasks read it. */
export interface ActionDraft {
  id: string;
  method: DraftMethod;
  sourceUrl: string | null;
  status: DraftStatus;
}

/** The brand pages an action works on (payload.pages), as basket-metrics.js reads them. */
export function actionPages(payload: Record<string, unknown> | null | undefined): string[] {
  const pages = payload?.pages;
  if (!Array.isArray(pages)) return [];
  return [
    ...new Set(pages.filter((p): p is string => typeof p === 'string' && /^https?:\/\//i.test(p))),
  ];
}

/**
 * The draft already written for this work: for a page, the one optimizing
 * it; without one, the action's draft of that method.
 */
export function findActionDraft(
  drafts: readonly ActionDraft[],
  method: DraftMethod,
  page: string | null,
): ActionDraft | null {
  return (
    drafts.find(
      (draft) => draft.method === method && (page === null || draft.sourceUrl === page),
    ) ?? null
  );
}

/** Statuses after which a task is no longer outstanding work. */
const TASK_DONE = ['completed', 'skipped', 'failed'];
/** A draft whose writing is done. */
const DRAFT_DONE: DraftStatus[] = ['ready', 'published'];

/**
 * Moves an action's tasks to a status for a draft's work, as a change in the
 * drawer does (updateTaskStatus): each recorded in the action's History, and
 * the action's Updated stamp bumped. Runs with the caller's client: the
 * member's for the editor, the service role for the agent API.
 */
export async function setDraftTasksStatus(
  db: SupabaseClient,
  draft: { id: string; brandId: string; actionId: string },
  taskIds: readonly string[],
  status: 'in_progress' | 'completed',
  actorId: string | null,
): Promise<void> {
  if (!taskIds.length) return;
  const now = new Date().toISOString();
  for (const taskId of taskIds) {
    const { error } = await db
      .from('action_tasks')
      .update({ status, skip_reason: null, updated_at: now })
      .eq('action_id', draft.actionId)
      .eq('id', taskId);
    if (error) throw new Error(error.message);
    // Best effort, as in the drawer: a missing trail entry doesn't undo the change.
    await db.from('action_events').insert({
      action_id: draft.actionId,
      event: 'task_status',
      data: { taskId, to: status, draftId: draft.id },
      actor_id: actorId,
    });
  }
  await db
    .from('actions')
    .update({ updated_at: now })
    .eq('brand_id', draft.brandId)
    .eq('id', draft.actionId);
}

/**
 * Marking a linked draft Ready completes the action's task for that work.
 * An action naming several pages has one draft per page: its task is done
 * once each page has a draft that is ready (or published). A deleted action
 * (00168) keeps its tasks as they were. Returns how many tasks it completed.
 */
export async function completeDraftTasks(
  db: SupabaseClient,
  draft: { id: string; brandId: string; actionId: string; method: DraftMethod },
  actorId: string | null,
): Promise<number> {
  const { data: action, error: actionError } = await db
    .from('actions')
    .select('payload')
    .eq('id', draft.actionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (actionError) throw new Error(actionError.message);
  if (!action) return 0;
  if (draft.method === 'optimize') {
    const pages = actionPages(action.payload);
    if (pages.length > 1) {
      const { data: done, error: doneError } = await db
        .from('content_drafts')
        .select('source_url')
        .eq('action_id', draft.actionId)
        .eq('method', 'optimize')
        .in('status', DRAFT_DONE);
      if (doneError) throw new Error(doneError.message);
      const ready = new Set((done ?? []).map((row) => row.source_url));
      if (pages.some((page) => !ready.has(page))) return 0;
    }
  }

  const { data: tasks, error: tasksError } = await db
    .from('action_tasks')
    .select('id, status')
    .eq('action_id', draft.actionId)
    .in('task_key', [...DRAFT_TASK_KEYS[draft.method]]);
  if (tasksError) throw new Error(tasksError.message);
  const todo = (tasks ?? []).filter((task) => !TASK_DONE.includes(task.status));
  await setDraftTasksStatus(
    db,
    draft,
    todo.map((task) => task.id),
    'completed',
    actorId,
  );
  return todo.length;
}
