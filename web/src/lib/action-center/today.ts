import type { TaskStatus } from '@/lib/action-center/registry';
import { dayIn, startOfDayIn } from '@/lib/time-zone';

/**
 * Helpers for Action Center › Today: an action's first step, who does it,
 * and when the week started. The order is the server's (GET
 * /api/action-center/today), shared with the Inbox's daily suggestion
 * (CHAT-26); nothing here ranks.
 */

/** Who does an item's first step: read from its assignee and that step's mode, never chosen here. */
export type TodayWho = 'me' | 'agent' | 'team';

/** An item's first step: its task's text parts and the page it's done on (AC-010). */
export interface TodayStep {
  taskKey: string | null;
  title: string | null;
  titleParams: Record<string, string | number>;
  /** The exact page, or null when the task names none. */
  url: string | null;
}

/** A task as read for the first step: what the card shows and what picks it. */
export interface TodayTaskRow {
  action_id: string;
  position: number;
  task_key: string | null;
  title: string | null;
  title_params: Record<string, string | number> | null;
  status: string;
  mode: string | null;
  url: string | null;
}

/** A task still to do: not completed, skipped or failed. */
const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'waiting_approval'];

/**
 * An action's first step: its first task still to do that a person or an
 * agent does. A `system` task (a check the Action Center runs itself) is
 * nobody's step, so it's passed over.
 */
export function firstOpenTask(tasks: readonly TodayTaskRow[]): TodayTaskRow | null {
  return (
    [...tasks]
      .sort((a, b) => a.position - b.position)
      .find(
        (task) =>
          (OPEN_TASK_STATUSES as readonly string[]).includes(task.status) && task.mode !== 'system',
      ) ?? null
  );
}

/**
 * Who does it: an agent when the first step is an agent's; else the person
 * when it's assigned to them; else the team (no one's yet). Today lists only
 * open actions that are unassigned or the person's own, as the Inbox does.
 */
export function whoDoesIt(
  step: Pick<TodayTaskRow, 'mode'> | null,
  assigneeId: string | null,
  userId: string,
): TodayWho {
  if (step?.mode === 'agent') return 'agent';
  if (assigneeId !== null && assigneeId === userId) return 'me';
  return 'team';
}

/** The first step as the card shows it. */
export function todayStep(task: TodayTaskRow | null): TodayStep | null {
  if (!task) return null;
  return {
    taskKey: task.task_key,
    title: task.title,
    titleParams: task.title_params ?? {},
    url: task.url,
  };
}

/** When this week started: Monday 00:00 on `timeZone`'s clock, as an ISO instant. */
export function weekStart(now: Date, timeZone: string): string {
  const day = dayIn(now.getTime(), timeZone);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const monday = new Date(Date.parse(`${day}T00:00:00Z`) - ((weekday + 6) % 7) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return startOfDayIn(monday, timeZone);
}
