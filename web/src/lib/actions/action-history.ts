'use server';

/**
 * The History tab's reads.
 *
 * One query per source, assembled here rather than in the component, so the
 * tab makes a single round trip for a page of rows and the shapes it renders
 * are settled before they reach React.
 *
 * Everything returned is read from rows the product already writes. The one
 * field that is deliberately empty is `results` — see lib/action-center/history
 * for why, and for the shape a validation pass would fill.
 */

import { createClient } from '@/lib/supabase/server';
import { isActionKind, type ActionCategory, type ActionImpact } from '@/lib/action-center/registry';
import type { ActionStatus, TaskStatus } from '@/lib/action-center/registry';
import { SIGNAL_SOURCES, type SignalSource } from '@/lib/signals/registry';
import {
  HISTORY_STATUSES,
  daysBetween,
  validationStatusFor,
  type ActionHistoryItem,
  type ActionHistoryTask,
  type ActionResultMetric,
  type AffectedEntity,
  type TriggerSignal,
} from '@/lib/action-center/history';

interface HistoryRow {
  id: string;
  action_no: number;
  category: string;
  kind: string;
  impact: string;
  status: string;
  payload: Record<string, unknown>;
  kpi_keys: string[];
  assignee_id: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

const HISTORY_COLUMNS =
  'id, action_no, category, kind, impact, status, payload, kpi_keys, assignee_id, created_at, completed_at, updated_at';

function num(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * What an action touched, from its payload.
 *
 * Generic by design: the subject is prompts for one kind and pages for
 * another, so this reports whichever counts the payload actually carries
 * rather than forcing every action into the same two columns.
 */
function affectedFrom(
  kind: string,
  payload: Record<string, unknown>,
  signalCount: number,
): AffectedEntity[] {
  const entities: AffectedEntity[] = [];
  const add = (type: AffectedEntity['type'], count: number) => {
    if (count > 0) entities.push({ id: `${type}-${count}`, type, name: type, count });
  };

  add('prompt', num(payload, 'promptCount'));
  add('url', num(payload, 'pageCount'));
  add('citation', num(payload, 'citationCount'));

  const competitors = Array.isArray(payload.competitorNames)
    ? (payload.competitorNames as string[])
    : [];
  for (const name of competitors.slice(0, 5)) {
    entities.push({ id: `competitor-${name}`, type: 'competitor', name });
  }

  // Every action has at least its signals to show, so a row is never blank.
  if (entities.length === 0 && signalCount > 0) {
    entities.push({
      id: `citation-${signalCount}`,
      type: 'citation',
      name: 'citation',
      count: signalCount,
    });
  }
  return entities;
}

/**
 * A page of history for one brand.
 *
 * Filtering and sorting happen in Postgres so pagination counts what the user
 * is actually looking at; search runs client-side, because an action's title
 * is composed from i18n templates and never stored as text.
 */
export async function getActionHistory(
  brandId: string,
  opts?: { from?: string; to?: string },
): Promise<ActionHistoryItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from('actions')
    .select(HISTORY_COLUMNS)
    .eq('brand_id', brandId)
    .in('status', HISTORY_STATUSES as string[])
    .order('created_at', { ascending: false })
    .limit(500);

  // The window covers when an action closed, falling back to when it was
  // raised for one still running — which is the date the row shows.
  if (opts?.from) query = query.gte('created_at', opts.from);
  if (opts?.to) query = query.lte('created_at', opts.to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as HistoryRow[]).filter((row) => isActionKind(row.kind));
  if (rows.length === 0) return [];

  const actionIds = rows.map((row) => row.id);
  const assigneeIds = [...new Set(rows.map((row) => row.assignee_id).filter(Boolean))] as string[];

  const [tasksRes, signalsRes, profilesRes] = await Promise.all([
    supabase
      .from('action_tasks')
      .select('id, action_id, position, task_key, title, status')
      .in('action_id', actionIds)
      .order('position'),
    supabase
      .from('signals')
      .select('id, action_id, kind, source, detected_at')
      .eq('brand_id', brandId)
      .in('action_id', actionIds),
    assigneeIds.length > 0
      ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', assigneeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const tasksByAction = new Map<string, ActionHistoryTask[]>();
  for (const task of tasksRes.data ?? []) {
    const list = tasksByAction.get(task.action_id) ?? [];
    list.push({
      id: task.id,
      // Resolved by the caller through i18n when there is no user title; the
      // key travels in `title` so the component can tell the two apart.
      title: task.title ?? task.task_key ?? '',
      status: task.status as TaskStatus,
    });
    tasksByAction.set(task.action_id, list);
  }

  const signalsByAction = new Map<string, TriggerSignal[]>();
  const sourcesByAction = new Map<string, Set<SignalSource>>();
  for (const signal of signalsRes.data ?? []) {
    if (!signal.action_id) continue;
    const list = signalsByAction.get(signal.action_id) ?? [];
    list.push({ signalId: signal.id, kind: signal.kind, detectedAt: signal.detected_at });
    signalsByAction.set(signal.action_id, list);

    // `source` is an array — one signal can be corroborated by several feeds.
    const set = sourcesByAction.get(signal.action_id) ?? new Set<SignalSource>();
    for (const source of (signal.source ?? []) as string[]) {
      if ((SIGNAL_SOURCES as readonly string[]).includes(source)) set.add(source as SignalSource);
    }
    if (set.size > 0) sourcesByAction.set(signal.action_id, set);
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

  return rows.map((row) => {
    const triggerSignals = signalsByAction.get(row.id) ?? [];
    // Empty until something measures an action's effect — see
    // lib/action-center/history for why, and for the shape it would fill.
    const results: ActionResultMetric[] = [];
    return {
      id: row.id,
      actionNo: Number(row.action_no),
      kind: row.kind,
      type: row.category as ActionCategory,
      impact: row.impact as ActionImpact,
      status: row.status as ActionStatus,
      validationStatus: validationStatusFor(row.status as ActionStatus, results),
      payload: row.payload ?? {},
      kpiKeys: row.kpi_keys ?? [],
      sources: [...(sourcesByAction.get(row.id) ?? [])],
      triggerSignals,
      affected: affectedFrom(row.kind, row.payload ?? {}, triggerSignals.length),
      results,
      tasks: tasksByAction.get(row.id) ?? [],
      assignee: row.assignee_id ? (profiles.get(row.assignee_id) ?? null) : null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      timeToCloseDays: row.completed_at ? daysBetween(row.created_at, row.completed_at) : null,
    };
  });
}
