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
  isActionKind,
  type ActionCategory,
  type ActionImpact,
  type ActionKind,
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
  kind: ActionKind;
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
  const rows = ((data ?? []) as ActionRow[]).filter((row) => isActionKind(row.kind));
  if (rows.length === 0) return [];

  const actionIds = rows.map((row) => row.id);
  const assigneeIds = [...new Set(rows.map((row) => row.assignee_id).filter(Boolean))] as string[];

  const [tasksRes, signalsRes, profilesRes] = await Promise.all([
    supabase.from('action_tasks').select('action_id, status').in('action_id', actionIds),
    supabase.from('signals').select('action_id').eq('brand_id', brandId).not('action_id', 'is', null),
    assigneeIds.length > 0
      ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', assigneeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const taskTotals = new Map<string, { total: number; completed: number }>();
  for (const task of tasksRes.data ?? []) {
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
    kind: row.kind as ActionKind,
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
  taskKey: string;
  status: TaskStatus;
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
      .select('id, position, task_key, status')
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
      status: task.status as TaskStatus,
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
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('action_tasks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('action_id', actionId)
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  await logEvent(supabase, actionId, 'task_status', { taskId, to: status });
  // Bump the action's updated stamp so the table's Updated column tracks
  // real work, not just nightly refreshes.
  await supabase
    .from('actions')
    .update({ updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('id', actionId);
}
