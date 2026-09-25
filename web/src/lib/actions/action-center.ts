'use server';

/**
 * Action Center actions — reads and execution writes.
 *
 * Rows are produced nightly by the server's generator (consolidating open
 * signals); this module reads them and carries the user's execution work:
 * status changes, assignment, due dates, task progress. Every mutation logs
 * an action_event, which is what the drawer's History tab shows — the trail
 * is written as it happens, not reconstructed.
 */

import { createClient } from '@/lib/supabase/server';
import {
  type ActionCategory,
  type ActionImpact,
  UNCOUNTED_TASK_STATUSES,
  type ActionStatus,
  type TaskStatus,
} from '@/lib/action-center/registry';
import { SIGNAL_ROW_COLUMNS, mapSignalRows, type Signal, type SignalRow } from '@/lib/signals/map';
import type { KpiTimeframe } from '@/lib/kpis/registry';

export interface ActionAssignee {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface ActionItem {
  id: string;
  actionNo: number;
  category: ActionCategory;
  /**
   * The server definition's id. Not narrowed to the kinds this build has copy
   * for: the definition registry grows on its own release cycle, and an
   * action we cannot name is still an action someone has to do.
   */
  kind: string;
  impact: ActionImpact;
  status: ActionStatus;
  payload: Record<string, unknown>;
  kpiKeys: string[];
  assignee: ActionAssignee | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  taskTotal: number;
  taskCompleted: number;
  signalCount: number;
}

interface ActionRow {
  id: string;
  action_no: number;
  category: string;
  kind: string;
  impact: string;
  status: string;
  payload: Record<string, unknown>;
  kpi_keys: string[];
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

const ACTION_COLUMNS =
  'id, action_no, category, kind, impact, status, payload, kpi_keys, assignee_id, due_date, created_at, updated_at';

export async function getActions(brandId: string): Promise<ActionItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('actions')
    .select(ACTION_COLUMNS)
    .eq('brand_id', brandId)
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ActionRow[];
  if (rows.length === 0) return [];

  const actionIds = rows.map((row) => row.id);
  const assigneeIds = [...new Set(rows.map((row) => row.assignee_id).filter(Boolean))] as string[];

  const [tasksRes, signalsRes, profilesRes] = await Promise.all([
    supabase.from('action_tasks').select('action_id, status').in('action_id', actionIds),
    supabase
      .from('signals')
      .select('action_id')
      .eq('brand_id', brandId)
      .not('action_id', 'is', null),
    assigneeIds.length > 0
      ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', assigneeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  // Skipped and failed tasks leave the denominator: neither is outstanding
  // work, so neither should hold an action below 100% for good.
  const taskTotals = new Map<string, { total: number; completed: number }>();
  for (const task of tasksRes.data ?? []) {
    if ((UNCOUNTED_TASK_STATUSES as readonly string[]).includes(task.status)) continue;
    const acc = taskTotals.get(task.action_id) ?? { total: 0, completed: 0 };
    acc.total += 1;
    if (task.status === 'completed') acc.completed += 1;
    taskTotals.set(task.action_id, acc);
  }
  const signalCounts = new Map<string, number>();
  for (const signal of signalsRes.data ?? []) {
    if (!signal.action_id) continue;
    signalCounts.set(signal.action_id, (signalCounts.get(signal.action_id) ?? 0) + 1);
  }
  const profiles = new Map(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      {
        id: p.id as string,
        fullName: (p.full_name as string | null) ?? null,
        avatarUrl: (p.avatar_url as string | null) ?? null,
      },
    ]),
  );

  return rows.map((row) => ({
    id: row.id,
    actionNo: Number(row.action_no),
    category: row.category as ActionCategory,
    kind: row.kind,
    impact: row.impact as ActionImpact,
    status: row.status as ActionStatus,
    payload: row.payload ?? {},
    kpiKeys: row.kpi_keys ?? [],
    assignee: row.assignee_id ? (profiles.get(row.assignee_id) ?? null) : null,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskTotal: taskTotals.get(row.id)?.total ?? 0,
    taskCompleted: taskTotals.get(row.id)?.completed ?? 0,
    signalCount: signalCounts.get(row.id) ?? 0,
  }));
}

export interface ActionTask {
  id: string;
  position: number;
  /** Template key for a generated task; null once someone renames or adds one. */
  taskKey: string | null;
  /** User-supplied text. Takes precedence over the template when present. */
  title: string | null;
  status: TaskStatus;
  /**
   * Values the task's text names — the platform, the competitor, the count.
   * Parameters rather than resolved text, so a planned task stays
   * translatable; empty when the task names nothing specific.
   */
  titleParams: Record<string, string | number>;
  /** Task keys within the same action that must finish first. */
  dependsOn: string[];
  /** Why the task was skipped; null for every other status. */
  skipReason: string | null;
}

export interface ActionEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
}

export interface ActionKpiRef {
  kpiKey: string;
  target: number;
  timeframe: KpiTimeframe;
}

export interface ActionDetail {
  tasks: ActionTask[];
  signals: Signal[];
  events: ActionEvent[];
  kpis: ActionKpiRef[];
}

/** Everything the drawer's tabs need beyond the list row, in one round trip
 *  per source. `kpis` are the brand's configured definitions among the
 *  action's kpi_keys — evidence of which goals this work serves. */
export async function getActionDetail(brandId: string, actionId: string): Promise<ActionDetail> {
  const supabase = await createClient();
  const [tasksRes, signalsRes, eventsRes, kpisRes] = await Promise.all([
    supabase
      .from('action_tasks')
      .select('id, position, task_key, title, status, skip_reason, title_params, depends_on')
      .eq('action_id', actionId)
      .order('position'),
    supabase
      .from('signals')
      .select(SIGNAL_ROW_COLUMNS)
      .eq('brand_id', brandId)
      .eq('action_id', actionId)
      .order('detected_at', { ascending: false }),
    supabase
      .from('action_events')
      .select('id, event, data, actor_id, created_at')
      .eq('action_id', actionId)
      .order('created_at'),
    supabase
      .from('kpi_definitions')
      .select('kpi_key, target, timeframe')
      .eq('brand_id', brandId)
      .eq('is_active', true),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (kpisRes.error) throw new Error(kpisRes.error.message);

  return {
    tasks: (tasksRes.data ?? []).map((task) => ({
      id: task.id,
      position: task.position,
      taskKey: task.task_key,
      title: task.title,
      status: task.status as TaskStatus,
      titleParams: (task.title_params ?? {}) as Record<string, string | number>,
      dependsOn: (task.depends_on ?? []) as string[],
      skipReason: task.skip_reason,
    })),
    signals: mapSignalRows((signalsRes.data ?? []) as SignalRow[]),
    events: (eventsRes.data ?? []).map((event) => ({
      id: event.id,
      event: event.event,
      data: (event.data ?? {}) as Record<string, unknown>,
      actorId: event.actor_id,
      createdAt: event.created_at,
    })),
    kpis: (kpisRes.data ?? []).map((kpi) => ({
      kpiKey: kpi.kpi_key,
      target: Number(kpi.target),
      timeframe: kpi.timeframe as KpiTimeframe,
    })),
  };
}

async function logEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actionId: string,
  event: string,
  data: Record<string, string | number | null>,
) {
  const { data: auth } = await supabase.auth.getUser();
  // Best-effort: a missing trail entry must not fail the change it records.
  await supabase
    .from('action_events')
    .insert({ action_id: actionId, event, data, actor_id: auth.user?.id ?? null });
}

/** Bump the action's updated stamp so the table's Updated column tracks real
 *  work, not just nightly refreshes. */
async function touchAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  actionId: string,
) {
  await supabase
    .from('actions')
    .update({ updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('id', actionId);
}

export async function updateActionStatus(
  brandId: string,
  actionId: string,
  status: ActionStatus,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('actions')
    .update({
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('brand_id', brandId)
    .eq('id', actionId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'status_changed', { to: status });
}

export async function assignAction(
  brandId: string,
  actionId: string,
  assigneeId: string | null,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('actions')
    .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('id', actionId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'assigned', { assigneeId });
}

export async function setActionDueDate(
  brandId: string,
  actionId: string,
  dueDate: string | null,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('actions')
    .update({ due_date: dueDate, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('id', actionId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'due_date_set', { dueDate });
}

export async function updateTaskStatus(
  brandId: string,
  actionId: string,
  taskId: string,
  status: TaskStatus,
  skipReason?: string,
): Promise<void> {
  const supabase = await createClient();

  // A skip records why. "We decided not to" is only useful to the next reader
  // if it says what the decision was; without it a skipped task is
  // indistinguishable from an abandoned one.
  const reason = status === 'skipped' ? (skipReason ?? '').trim().slice(0, 200) : null;
  if (status === 'skipped' && !reason) throw new Error('A skipped task needs a reason');

  const { error } = await supabase
    .from('action_tasks')
    .update({ status, skip_reason: reason, updated_at: new Date().toISOString() })
    .eq('action_id', actionId)
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'task_status', {
    taskId,
    to: status,
    ...(reason ? { reason } : {}),
  });
  await touchAction(supabase, brandId, actionId);
}

/** Longest a task's text may be. Long enough for a real instruction, short
 *  enough to stay one line in the drawer. */
const TASK_TITLE_MAX = 200;

function cleanTaskTitle(raw: string): string {
  const title = raw.trim().slice(0, TASK_TITLE_MAX);
  if (!title) throw new Error('Task text is required');
  return title;
}

/**
 * Append a task of the user's own wording.
 *
 * `task_key` stays null — these have no template — so the renderable check
 * carries the title, and `unique (action_id, task_key)` does not apply to
 * them (Postgres treats nulls as distinct), which is what lets an action hold
 * as many as someone types.
 */
export async function addTask(brandId: string, actionId: string, title: string): Promise<void> {
  const supabase = await createClient();
  const text = cleanTaskTitle(title);

  // Append after the current last, reading through the caller's own RLS so a
  // position can only ever be computed from tasks they can see.
  const { data: last, error: lastErr } = await supabase
    .from('action_tasks')
    .select('position')
    .eq('action_id', actionId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(lastErr.message);

  const { error } = await supabase.from('action_tasks').insert({
    action_id: actionId,
    position: (last?.position ?? 0) + 1,
    title: text,
    status: 'todo',
  });
  if (error) throw new Error(error.message);

  await logEvent(supabase, actionId, 'task_added', { title: text });
  await touchAction(supabase, brandId, actionId);
}

/**
 * Rename a task. A generated task keeps its `task_key` for provenance — which
 * template it grew from stays answerable — and the title simply wins at render
 * time.
 */
export async function updateTaskTitle(
  brandId: string,
  actionId: string,
  taskId: string,
  title: string,
): Promise<void> {
  const supabase = await createClient();
  const text = cleanTaskTitle(title);

  const { error } = await supabase
    .from('action_tasks')
    .update({ title: text, updated_at: new Date().toISOString() })
    .eq('action_id', actionId)
    .eq('id', taskId);
  if (error) throw new Error(error.message);

  await logEvent(supabase, actionId, 'task_renamed', { taskId, title: text });
  await touchAction(supabase, brandId, actionId);
}

/**
 * Remove a task and close the gap in the numbering.
 *
 * The drawer shows `position` to the reader ("1. 2. 3."), so leaving a hole
 * would show one. Renumbering runs row by row rather than in one statement
 * because PostgREST has no bulk conditional update; a handful of tasks per
 * action makes that a non-issue.
 */
export async function deleteTask(brandId: string, actionId: string, taskId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('action_tasks')
    .delete()
    .eq('action_id', actionId)
    .eq('id', taskId);
  if (error) throw new Error(error.message);

  const { data: remaining, error: readErr } = await supabase
    .from('action_tasks')
    .select('id, position')
    .eq('action_id', actionId)
    .order('position');
  if (readErr) throw new Error(readErr.message);

  await Promise.all(
    (remaining ?? [])
      .map((task, index) => ({ task, wanted: index + 1 }))
      .filter(({ task, wanted }) => task.position !== wanted)
      .map(({ task, wanted }) =>
        supabase.from('action_tasks').update({ position: wanted }).eq('id', task.id),
      ),
  );

  await logEvent(supabase, actionId, 'task_deleted', { taskId });
  await touchAction(supabase, brandId, actionId);
}
