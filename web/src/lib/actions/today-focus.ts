'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import type { ActionItem } from '@/lib/actions/action-center';
import { taskProgress } from '@/lib/action-center/registry';
import { readEntityCounts } from '@/lib/action-center/entity-counts';
import { ACTION_COLUMNS, actionItemFromRow, type ActionRow } from '@/lib/action-center/rows';
import { parseTaskDetails } from '@/lib/action-center/task-details';
import {
  firstOpenTask,
  todayStep,
  whoDoesIt,
  type TodayStep,
  type TodayTaskRow,
  type TodayWho,
} from '@/lib/action-center/today';
import {
  FOCUS_SLOTS,
  SKIP_DAYS,
  pickFocus,
  rankedIds,
  skippedActions,
  type FocusCandidate,
} from '@/lib/action-center/focus';
import { hideCard, readUserBrandState, setFocus } from '@/lib/actions/user-brand-state';
import { isUuid, skipKey } from '@/lib/user-brand-state';

/** A focus card: its action as the Actions list reads it, and what the card says beside it. */
export interface FocusCard {
  id: string;
  action: ActionItem;
  /** Filled since the person's last visit to Today. */
  isNew: boolean;
  /** The first step still to do: the card's button opens the action there. */
  firstStep: TodayStep | null;
  /** That step's estimate, e.g. "~2h"; null when it has none. */
  effort: string | null;
  /** Who does that step: the person, an agent, or anyone on the team. */
  who: TodayWho;
}

type FocusTaskRow = TodayTaskRow & { effort: string | null };

/**
 * Today's focus for the signed-in person on a brand (SIMPLE_NAV): the 3
 * actions they keep (user_brand_state.focus) while those still fit, the
 * server's ranking (GET /api/action-center/today, shared with the Chat
 * Inbox) for the slots left, without the ones they skipped or reminders.
 * The focus is kept when it changes, best effort: a focus that didn't save
 * only fills again next time. `seenAt` is the person's last visit to Today
 * before this one, for the New tag. Read as the person (RLS); throws on a
 * failed read, and Today then shows itself without its focus.
 */
export async function getTodayFocus(brandId: string, seenAt: string | null): Promise<FocusCard[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!user || !session) throw new Error('Not authenticated');

  const [state, res] = await Promise.all([
    readUserBrandState(brandId),
    fetch(`${API_BASE_URL}/api/action-center/today?brandId=${encodeURIComponent(brandId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    }),
  ]);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const ranking = rankedIds(await res.json().catch(() => null));
  const pins = state?.focus ?? [];
  const ids = [...new Set([...pins.map((pin) => pin.id), ...ranking])];
  if (ids.length === 0) {
    if (pins.length > 0) await setFocus(brandId, []);
    return [];
  }

  const rows = await supabase
    .from('actions')
    .select(ACTION_COLUMNS)
    .eq('brand_id', brandId)
    .is('deleted_at', null)
    .in('id', ids);
  if (rows.error) throw new Error(rows.error.message);
  const actionRows = (rows.data ?? []) as ActionRow[];
  const candidates = new Map<string, FocusCandidate>(
    actionRows.map((row) => [
      row.id,
      { id: row.id, kind: row.kind, status: row.status, assigneeId: row.assignee_id },
    ]),
  );

  const { slots, changed } = pickFocus({
    pins,
    ranking,
    actions: candidates,
    skipped: skippedActions(state?.hidden ?? {}),
    userId: user.id,
    now: new Date(),
    seenAt,
  });
  // Only with the person's state read: a failed read must not wipe what they keep.
  if (changed && state) {
    await setFocus(
      brandId,
      slots.map((slot) => ({ id: slot.id, addedAt: slot.addedAt })),
    );
  }
  if (slots.length === 0) return [];

  const slotIds = slots.map((slot) => slot.id);
  const [tasks, entityCounts] = await Promise.all([
    supabase
      .from('action_tasks')
      .select('action_id, position, task_key, title, title_params, status, mode, details')
      .in('action_id', slotIds),
    readEntityCounts(supabase, slotIds),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  const tasksOf = new Map<string, FocusTaskRow[]>();
  for (const row of tasks.data ?? []) {
    const details = parseTaskDetails(row.details);
    const list = tasksOf.get(row.action_id) ?? [];
    list.push({
      action_id: row.action_id,
      position: row.position,
      task_key: row.task_key,
      title: row.title,
      title_params: (row.title_params ?? null) as Record<string, string | number> | null,
      status: row.status,
      mode: row.mode,
      url: details?.url ?? null,
      effort: details?.effort ?? null,
    });
    tasksOf.set(row.action_id, list);
  }

  const rowOf = new Map(actionRows.map((row) => [row.id, row]));
  return slots.slice(0, FOCUS_SLOTS).flatMap((slot) => {
    const row = rowOf.get(slot.id);
    if (!row) return [];
    const list = tasksOf.get(slot.id) ?? [];
    const progress = taskProgress(list.map((task) => task.status));
    const first = firstOpenTask(list) as FocusTaskRow | null;
    return [
      {
        id: slot.id,
        action: actionItemFromRow(row, {
          assignee: null,
          taskTotal: progress.total,
          taskCompleted: progress.completed,
          signalCount: 0,
          entityCounts: entityCounts.get(slot.id),
        }),
        isNew: slot.isNew,
        firstStep: todayStep(first),
        effort: first?.effort ?? null,
        who: whoDoesIt(first, row.assignee_id, user.id),
      },
    ];
  });
}

/**
 * "Skip for now" on a focus card: the action leaves this person's focus for
 * 7 days, and the next of the ranking takes its slot when Today reads it
 * again. The action itself doesn't change. As the person, never throws.
 */
export async function skipTodayFocus(brandId: string, actionId: string): Promise<{ ok: boolean }> {
  if (!isUuid(brandId) || !isUuid(actionId)) return { ok: false };
  const until = new Date(Date.now() + SKIP_DAYS * 86_400_000);
  const hidden = await hideCard(brandId, skipKey(actionId), until);
  if (!hidden.ok) return { ok: false };
  const state = await readUserBrandState(brandId);
  if (state && state.focus.some((pin) => pin.id === actionId.toLowerCase())) {
    await setFocus(
      brandId,
      state.focus.filter((pin) => pin.id !== actionId.toLowerCase()),
    );
  }
  return { ok: true };
}
