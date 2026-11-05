'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { parseTaskDetails } from '@/lib/action-center/task-details';
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
 * each item's first step and assignee, and the brand's actions completed
 * since Monday in the person's time zone (the one they picked in Settings ›
 * Account, else their browser's). Throws on a failed read: the page then
 * shows itself without the card.
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
  const ids = order.today.map((item) => item.id);

  const profile = await supabase
    .from('profiles')
    .select('time_zone')
    .eq('id', user.id)
    .maybeSingle();
  const zone = effectiveTimeZone(profile.data?.time_zone ?? null, browserZone);

  const [tasks, assignees, done] = await Promise.all([
    ids.length
      ? supabase
          .from('action_tasks')
          .select('action_id, position, task_key, title, title_params, status, mode, details')
          .in('action_id', ids)
      : null,
    ids.length ? supabase.from('actions').select('id, assignee_id').in('id', ids) : null,
    supabase
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .gte('completed_at', weekStart(new Date(), zone)),
  ]);
  if (tasks?.error) throw new Error(tasks.error.message);
  if (assignees?.error) throw new Error(assignees.error.message);
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
  const assigneeOf = new Map(
    (assignees?.data ?? []).map((row) => [row.id, row.assignee_id as string | null]),
  );

  return {
    today: order.today.map(({ id, suggested }) => {
      const first = firstOpenTask(tasksOf.get(id) ?? []);
      return {
        id,
        suggested,
        firstStep: todayStep(first),
        who: whoDoesIt(first, assigneeOf.get(id) ?? null, user.id),
      };
    }),
    next: order.next,
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
