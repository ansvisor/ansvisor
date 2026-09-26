/**
 * Carrying out a task automatically (#818, phase 7).
 *
 * Phase 5 marked every task with who could carry it out and whether carrying
 * it out reaches outside Ansvisor; nothing acted on either. This does, under
 * four rules that are the whole point of the layer:
 *
 *  1. **Nothing reaches outside except through a tool.** The tool registry is
 *     the enumerable surface; a task without a tool is not runnable, and says
 *     so rather than improvising.
 *  2. **Nothing changes outside Ansvisor without approval.** A tool that
 *     writes to a third-party system is blocked until a person has
 *     authorised that task, and the authorisation is recorded on the task
 *     rather than inferred from whoever happened to trigger the run. Reading
 *     a system the brand connected is not a change and needs no approval —
 *     asking for one before every read teaches people to approve blindly.
 *  3. **Every attempt is recorded** — inputs, tool, result, error. Never the
 *     model's reasoning: that is not evidence, and storing it invites people
 *     to read it as explanation.
 *  4. **A failed run fails its task, not its action.** A tool that throws
 *     costs one step. The action stays open, the other tasks stay as they
 *     were, and somebody can do that step by hand.
 *
 * Deliberately not wired to the nightly cron. The engine underneath it spent
 * six days failing silently before anyone noticed (#829); an execution layer
 * that runs unattended belongs after the verification that the thing it
 * executes for is running at all, not before.
 */

import supabaseAdmin from '../../../config/supabase.js';
import { logger } from '../../logger.js';
import { getTask } from '../tasks/registry.js';
import { resolveBrandSources } from '../sources.js';
import { getTool } from './tools.js';

/** A task can only be carried out from the statuses that mean "not done". */
const RUNNABLE_STATUSES = ['todo', 'in_progress', 'waiting_approval'];

async function record(row) {
  const { error } = await supabaseAdmin.from('action_task_runs').insert(row);
  if (error) throw new Error(error.message);
}

/**
 * Why this task cannot be carried out right now, or null.
 *
 * Every answer is a sentence an operator can act on. "blocked" with no reason
 * is the failure mode this function exists to avoid.
 */
export function blockedReason({ task, primitive, tool, sources, siblings }) {
  if (!RUNNABLE_STATUSES.includes(task.status)) {
    return `task is ${task.status}`;
  }
  if (!primitive) return `no task primitive named ${task.task_key}`;
  if (primitive.mode !== 'agent') return 'task is carried out by a person, not automatically';
  if (!tool) return `no tool implements ${task.task_key} yet`;
  if (!sources.has(tool.source)) return `brand has no ${tool.source} source`;

  if (tool.writesExternally && !task.approved_by) {
    return 'changes something outside Ansvisor and has not been approved';
  }

  const unfinished = (task.depends_on ?? []).filter((key) => {
    const sibling = siblings.find((row) => row.task_key === key);
    return sibling && sibling.status !== 'completed' && sibling.status !== 'skipped';
  });
  if (unfinished.length > 0) return `waits on ${unfinished.join(', ')}`;

  return null;
}

/**
 * What a tool is given: the action's own payload, and the structured output
 * of the tasks this one waits on.
 *
 * Upstream outputs travel by task key so a tool reads `inputs.coverage_gaps`
 * rather than positionally — a plan that drops a task (phase 5) must not
 * shift what the next one reads.
 */
function buildInput({ action, siblings, dependsOn }) {
  const inputs = {};
  for (const key of dependsOn ?? []) {
    const sibling = siblings.find((row) => row.task_key === key);
    if (sibling?.output) inputs[key] = sibling.output;
  }
  return { payload: action.payload ?? {}, inputs };
}

/**
 * Carry out one task.
 *
 * Never throws for an ordinary refusal — a blocked task is an outcome, not an
 * error, and callers running a list of them should not stop at the first one
 * that is waiting on something.
 *
 * @param {string} taskId
 * @param {{ now?: Date, sources?: Set<string> }} [options]
 */
export async function runTask(taskId, { now = new Date(), sources } = {}) {
  const { data: task, error: taskErr } = await supabaseAdmin
    .from('action_tasks')
    .select('id, action_id, task_key, status, depends_on, approved_by')
    .eq('id', taskId)
    .single();
  if (taskErr) throw new Error(taskErr.message);

  const { data: action, error: actionErr } = await supabaseAdmin
    .from('actions')
    .select('id, brand_id, payload')
    .eq('id', task.action_id)
    .single();
  if (actionErr) throw new Error(actionErr.message);

  const { data: siblings, error: siblingErr } = await supabaseAdmin
    .from('action_tasks')
    .select('task_key, status, output')
    .eq('action_id', task.action_id);
  if (siblingErr) throw new Error(siblingErr.message);

  const primitive = getTask(task.task_key);
  const tool = primitive?.tool ? getTool(primitive.tool) : null;
  const available = sources ?? (await resolveBrandSources(action.brand_id));

  const refusal = blockedReason({
    task,
    primitive,
    tool,
    sources: available,
    siblings: siblings ?? [],
  });
  if (refusal) {
    await record({
      task_id: task.id,
      action_id: action.id,
      brand_id: action.brand_id,
      tool_id: tool?.id ?? null,
      tool_version: tool?.version ?? null,
      status: 'blocked',
      error: refusal,
      started_at: now.toISOString(),
      finished_at: now.toISOString(),
    });
    // A task held for approval says so in its own status, so the person who
    // has to decide can find it without reading the run log.
    if (tool?.writesExternally && !task.approved_by && task.status !== 'waiting_approval') {
      await supabaseAdmin
        .from('action_tasks')
        .update({ status: 'waiting_approval', updated_at: now.toISOString() })
        .eq('id', task.id);
    }
    logger.info({ taskId, reason: refusal }, '[task-run] blocked');
    return { status: 'blocked', reason: refusal };
  }

  const input = buildInput({ action, siblings: siblings ?? [], dependsOn: task.depends_on });
  const startedAt = new Date();

  try {
    const output = await tool.run({ brandId: action.brand_id, payload: input.payload, input, now });

    await record({
      task_id: task.id,
      action_id: action.id,
      brand_id: action.brand_id,
      tool_id: tool.id,
      tool_version: tool.version,
      status: 'succeeded',
      input,
      output,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
    });

    const { error } = await supabaseAdmin
      .from('action_tasks')
      .update({ status: 'completed', output, updated_at: new Date().toISOString() })
      .eq('id', task.id);
    if (error) throw new Error(error.message);

    logger.info({ taskId, tool: tool.id }, '[task-run] completed');
    return { status: 'succeeded', output };
  } catch (err) {
    // The action is deliberately untouched. One step failing is one step to
    // do by hand, not a recovery plan cancelled.
    await record({
      task_id: task.id,
      action_id: action.id,
      brand_id: action.brand_id,
      tool_id: tool.id,
      tool_version: tool.version,
      status: 'failed',
      input,
      error: err.message,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
    });

    await supabaseAdmin
      .from('action_tasks')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', task.id);

    logger.error({ err, taskId, tool: tool.id }, '[task-run] failed');
    return { status: 'failed', error: err.message };
  }
}
