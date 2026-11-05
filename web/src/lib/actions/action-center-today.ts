'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { taskProgress } from '@/lib/action-center/registry';
import { readAssignees } from '@/lib/action-center/assignees';
import { readEntityCounts } from '@/lib/action-center/entity-counts';
import { ACTION_COLUMNS, actionItemFromRow, type ActionRow } from '@/lib/action-center/rows';
import { parseTaskDetails } from '@/lib/action-center/task-details';
import { OPEN_SIGNAL_STATUSES, type SignalStatus } from '@/lib/signals/registry';
import { effectiveTimeZone } from '@/lib/time-zone';
import {
  firstOpenTask,
  todayStep,
  weekStart,
  whoDoesIt,
  type TodayRead,
  type TodayTaskRow,
} from '@/lib/action-center/today';

/**
 * The Today card (AC-011) for the signed-in person on a brand.
 *
 * The order is the server's (GET /api/action-center/today): the Inbox's
 * daily suggestion ranking, one rule for both, with today's suggestion
 * first. This reads, as the person (RLS), what the card shows beside it:
 * each item's action as the Actions list reads it, by id (ten at most), so
 * the card and its drawer never depend on the page's list, which holds at
 * most 1000 actions in no order; each today item's first step and who does
 * it; and the brand's actions completed since Monday in the person's time
 * zone (the one they picked in Settings › Account, else their browser's).
 * An item whose action the person can't read is left out. Throws on a
 * failed read: the page then shows itself without the card.
 */
export async function getToday(brandId: string, browserZone: string | null): Promise<TodayRead> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!user || !session) throw new Error('Not authenticated');

  const res = await fetch(
    `${API_BASE_URL}/api/action-center/today?brandId=${encodeURIComponent(brandId)}`,
    { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const order = readOrder(await res.json().catch(() => null));
  const ids = [...order.today, ...order.next].map((item) => item.id);

  const [profile, rows, tasks, signals, entityCounts] = await Promise.all([
    supabase.from('profiles').select('time_zone').eq('id', user.id).maybeSingle(),
    ids.length
      ? supabase.from('actions').select(ACTION_COLUMNS).eq('brand_id', brandId).in('id', ids)
      : null,
    ids.length
      ? supabase
          .from('action_tasks')
          .select('action_id, position, task_key, title, title_params, status, mode, details')
          .in('action_id', ids)
      : null,
    // Their open signals, counted as the list counts them (AC-007).
    ids.length
      ? supabase
          .from('signals')
          .select('action_id')
          .eq('brand_id', brandId)
          .in('status', OPEN_SIGNAL_STATUSES as SignalStatus[])
          .in('action_id', ids)
      : null,
    readEntityCounts(supabase, ids),
  ]);
  if (rows?.error) throw new Error(rows.error.message);
  if (tasks?.error) throw new Error(tasks.error.message);
  if (signals?.error) throw new Error(signals.error.message);
  const actionRows = (rows?.data ?? []) as ActionRow[];
  const zone = effectiveTimeZone(profile.data?.time_zone ?? null, browserZone);

  const [assignees, done] = await Promise.all([
    // Other members' profiles are hidden from the person (RLS): read as the list reads them.
    readAssignees(
      supabase,
      brandId,
      actionRows.flatMap((row) => (row.assignee_id ? [row.assignee_id] : [])),
    ),
    supabase
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .gte('completed_at', weekStart(new Date(), zone)),
  ]);
  if (done.error) throw new Error(done.error.message);

  const tasksOf = new Map<string, TodayTaskRow[]>();
  for (const row of tasks?.data ?? []) {
    const list = tasksOf.get(row.action_id) ?? [];
    list.push({
      action_id: row.action_id,
      position: row.position,
      task_key: row.task_key,
      title: row.title,
      title_params: (row.title_params ?? null) as Record<string, string | number> | null,
      status: row.status,
      mode: row.mode,
      url: parseTaskDetails(row.details)?.url ?? null,
    });
    tasksOf.set(row.action_id, list);
  }
  const signalCounts = new Map<string, number>();
  for (const signal of signals?.data ?? []) {
    if (!signal.action_id) continue;
    signalCounts.set(signal.action_id, (signalCounts.get(signal.action_id) ?? 0) + 1);
  }
  const rowOf = new Map(actionRows.map((row) => [row.id, row]));
  const actionOf = (row: ActionRow) => {
    const progress = taskProgress((tasksOf.get(row.id) ?? []).map((task) => task.status));
    return actionItemFromRow(row, {
      assignee: row.assignee_id ? (assignees.get(row.assignee_id) ?? null) : null,
      taskTotal: progress.total,
      taskCompleted: progress.completed,
      signalCount: signalCounts.get(row.id) ?? 0,
      entityCounts: entityCounts.get(row.id),
    });
  };

  return {
    today: order.today.flatMap(({ id, suggested }) => {
      const row = rowOf.get(id);
      if (!row) return [];
      const first = firstOpenTask(tasksOf.get(id) ?? []);
      return [
        {
          id,
          action: actionOf(row),
          suggested,
          firstStep: todayStep(first),
          who: whoDoesIt(first, row.assignee_id, user.id),
        },
      ];
    }),
    next: order.next.flatMap(({ id }) => {
      const row = rowOf.get(id);
      return row ? [{ id, action: actionOf(row) }] : [];
    }),
    doneThisWeek: done.count ?? 0,
  };
}

/** The server's order, read defensively: ids only, each once. */
function readOrder(body: unknown): {
  today: { id: string; suggested: boolean }[];
  next: { id: string }[];
} {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const entries = (value: unknown) =>
    (Array.isArray(value) ? value : []).flatMap((entry) => {
      const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : null;
      if (typeof id !== 'string' || seen.has(id)) return [];
      seen.add(id);
      return [{ id, suggested: (entry as { suggested?: unknown }).suggested === true }];
    });
  const today = entries(record.today);
  const next = entries(record.next).map(({ id }) => ({ id }));
  return { today, next };
}
