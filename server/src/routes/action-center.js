import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { rescoreActionsForSignal } from '../lib/action-center/priority-data.js';
import { PlanLimitError } from '../lib/plan-guard.js';
import {
  TaskSendError,
  loadTask,
  sendTaskToContent,
  sendTaskToWebhook,
} from '../lib/action-center/task-send.js';
import {
  TaskWriterError,
  isTaskWriterEnabled,
  writeTasksForAction,
} from '../lib/action-center/task-writer/index.js';
import {
  MAX_TRAFFIC_PAGES,
  TRAFFIC_PAGE_REASONS,
  sendTrafficPagesToActionCenter,
} from '../lib/action-center/from-traffic-pages.js';

const router = Router();

/**
 * Scores again the active actions a signal supports, after a member moved
 * the signal (AC-007). The dashboard writes the status itself; this keeps the
 * priority in step without waiting for the night. Checked against the
 * caller's organization first, like every route on the admin client.
 *
 * @returns {Promise<{ rescored: number }>}
 */
export async function rescoreForSignal(signalId, userId) {
  const { data: signal } = await supabaseAdmin
    .from('signals')
    .select('id, brand_id')
    .eq('id', signalId)
    .maybeSingle();
  if (!signal) {
    const err = new Error('Signal not found');
    err.status = 404;
    throw err;
  }
  await assertBrandAccess(signal.brand_id, userId);
  return { rescored: await rescoreActionsForSignal(signal.id) };
}

/** Seeded ids (the demo's) aren't RFC 4122 versions, so a plain GUID shape. */
const signalIdSchema = z.guid();

/** POST /api/action-center/signals/:id/rescore */
router.post('/signals/:id/rescore', async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid signal id' });
  try {
    return res.json(await rescoreForSignal(id.data, req.user.id));
  } catch (error) {
    req.log.error({ err: error }, 'rescore actions for a signal error');
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to update the actions.',
    });
  }
});

/** Why a rewrite wrote nothing, for logs and the API; the drawer words the code. */
const NOTHING_WRITTEN = {
  no_targets: 'This action names no page, prompt or domain to write tasks about.',
  no_valid_tasks: "The written tasks didn't pass the quality check.",
};

/**
 * Writes an action's tasks again from its evidence (AC-004), keeping the done,
 * under-way and hand-added ones. Off unless the deployment writes tasks.
 *
 * @returns {Promise<{ written: number, kept: number }>}
 */
export async function regenerateTasks(actionId, userId) {
  if (!isTaskWriterEnabled()) {
    throw new TaskWriterError('disabled', 'Writing tasks is not turned on.', 404);
  }
  const { data: action } = await supabaseAdmin
    .from('actions')
    .select('id, brand_id')
    .eq('id', actionId)
    .maybeSingle();
  if (!action) throw new TaskWriterError('not_found', 'Action not found', 404);
  await assertBrandAccess(action.brand_id, userId);

  let result;
  try {
    result = await writeTasksForAction(actionId, { trigger: 'regenerate', userId });
  } catch (err) {
    // The month's AI budget, shared with the Improve tab, is spent.
    if (err instanceof PlanLimitError) throw new TaskWriterError('budget', err.message, 429);
    throw err;
  }
  if (result.status !== 'written') {
    throw new TaskWriterError(result.reason, NOTHING_WRITTEN[result.reason]);
  }
  return { written: result.tasks.length, kept: result.kept };
}

/** POST /api/action-center/actions/:id/tasks/regenerate */
router.post('/actions/:id/tasks/regenerate', async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid action id' });
  try {
    return res.json(await regenerateTasks(id.data, req.user.id));
  } catch (error) {
    const status = error.status;
    if (!status) req.log.error({ err: error }, 'regenerate action tasks error');
    return res.status(status || 500).json({
      error: status ? error.message : 'Failed to write the tasks.',
      code: error.code ?? null,
    });
  }
});

/** Roles that may delete an action, as for other destructive changes. */
const DELETE_ROLES = ['admin', 'manager'];

/**
 * Deletes an action from its row menu: hidden, not removed. It becomes
 * dismissed and gets deleted_at (00168), so the lists, the API and the
 * exports leave it out, while the nightly generator still reads a dismissed
 * action and keeps its rest window: a condition that is still firing
 * doesn't bring it back the next night. Admins and managers only.
 *
 * @returns {Promise<{ deleted: true }>}
 */
export async function deleteAction(actionId, userId) {
  const { data: action } = await supabaseAdmin
    .from('actions')
    .select('id, brand_id, status, deleted_at')
    .eq('id', actionId)
    .maybeSingle();
  if (!action || action.deleted_at) {
    const err = new Error('Action not found');
    err.status = 404;
    throw err;
  }
  await assertBrandAccess(action.brand_id, userId);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (!DELETE_ROLES.includes(profile?.role)) {
    const err = new Error('Only admins and managers can delete actions.');
    err.status = 403;
    throw err;
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('actions')
    .update({ status: 'dismissed', deleted_at: now, completed_at: null, updated_at: now })
    .eq('id', actionId)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);

  // The trail keeps who deleted it and from where, though nobody reads it now.
  const { error: eventErr } = await supabaseAdmin.from('action_events').insert({
    action_id: actionId,
    event: 'deleted',
    data: { from: action.status },
    actor_id: userId,
  });
  if (eventErr) throw new Error(eventErr.message);
  return { deleted: true };
}

/** DELETE /api/action-center/actions/:id */
router.delete('/actions/:id', async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid action id' });
  try {
    return res.json(await deleteAction(id.data, req.user.id));
  } catch (error) {
    if (!error.status) req.log.error({ err: error }, 'delete action error');
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to delete the action.',
    });
  }
});

/**
 * Sends a task onward (AC-004): to Content as an opportunity, or to the
 * brand's webhook. `title` is the task's text as the dashboard shows it, for
 * a library task whose text only the dashboard renders.
 */
export async function sendTask(taskId, { to, title }, userId) {
  const loaded = await loadTask(taskId);
  await assertBrandAccess(loaded.action.brand_id, userId);
  return to === 'content'
    ? sendTaskToContent({ taskId, title, userId, loaded })
    : sendTaskToWebhook({ taskId, title, userId, loaded });
}

const sendTaskSchema = z.object({
  to: z.enum(['content', 'webhook']),
  title: z.string().max(200).optional(),
});

/** POST /api/action-center/tasks/:id/send */
router.post('/tasks/:id/send', async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  const body = sendTaskSchema.safeParse(req.body ?? {});
  if (!id.success || !body.success) return res.status(400).json({ error: 'Invalid request' });
  try {
    return res.json(await sendTask(id.data, body.data, req.user.id));
  } catch (error) {
    const status = error.status;
    if (!status) req.log.error({ err: error }, 'send action task error');
    return res.status(status || 500).json({
      error: status ? error.message : 'Failed to send the task.',
      code: error instanceof TaskSendError ? error.code : null,
    });
  }
});

const trafficPagesSchema = z.object({
  // guid, not uuid: seeded ids aren't RFC 4122 versions.
  brandId: z.guid(),
  // Paths, as the Pages section lists them.
  pages: z.array(z.string().min(1).max(2048).startsWith('/')).min(1).max(MAX_TRAFFIC_PAGES),
  reason: z.enum(TRAFFIC_PAGE_REASONS),
  // The page's range, as its loaders take it: a timestamp, or a day from a
  // custom range; absent for all time.
  from: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
  to: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
});

/**
 * POST /api/action-center/pages
 * Body: { brandId, pages, reason, from?, to? }
 *
 * "Send to Action Center" on the AI Traffic page's Pages section (AT-006):
 * pages from the Cited, not clicked or No AI traffic list as one action.
 * Sending the same pages from the same list again returns the action
 * already open.
 */
router.post('/pages', async (req, res) => {
  try {
    const parsed = trafficPagesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
    }
    const { brandId, pages, reason, from, to } = parsed.data;
    await assertBrandAccess(brandId, req.user.id);

    const result = await sendTrafficPagesToActionCenter(brandId, {
      pages,
      reason,
      from,
      to,
      userId: req.user.id,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'traffic pages action error');
    return res.status(status).json({
      error: 'Failed to send to the Action Center',
      details: error.message,
    });
  }
});

export default router;
