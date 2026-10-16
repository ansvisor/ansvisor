import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { rescoreActionsForSignal } from '../lib/action-center/priority-data.js';
import { PlanLimitError } from '../lib/plan-guard.js';
import {
  TaskWriterError,
  isTaskWriterEnabled,
  writeTasksForAction,
} from '../lib/action-center/task-writer/index.js';

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

export default router;
