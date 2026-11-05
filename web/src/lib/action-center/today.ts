import type { ActionItem } from '@/lib/actions/action-center';
import type { TaskStatus } from '@/lib/action-center/registry';
import type { GettingStartedStep } from '@/lib/getting-started/steps';
import { dayIn, startOfDayIn } from '@/lib/time-zone';

/**
 * The Today card on Action Center › Actions (AC-011, ROADMAP-plan §06):
 * what to do today, the Next 7 after it, and what was done this week.
 *
 * The order is the server's (GET /api/action-center/today): the ranking of
 * the Inbox's daily suggestion (CHAT-26), with today's suggestion first.
 * Nothing here ranks; this joins the order with the list the page holds and
 * says who does each item's first step.
 */

/** Getting started's steps shown on the card while it runs. */
export const TODAY_STEPS = 3;

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

export interface TodayItem {
  id: string;
  /** The Inbox's daily suggestion for the person today. */
  suggested: boolean;
  firstStep: TodayStep | null;
  who: TodayWho;
}

export interface TodayRead {
  today: TodayItem[];
  /** The Next 7, in order. */
  next: { id: string }[];
  /** The brand's actions completed since Monday, in the person's time zone. */
  doneThisWeek: number;
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

/** The statuses Today lists, as the Inbox does: not on hold, completed or dismissed. */
const TODAY_STATUSES: readonly string[] = ['new', 'in_progress'];

/**
 * The card's rows: each item with its action from the page's list, in the
 * server's order. One the list no longer holds, or holds closed or on hold
 * since, is left out until the order is read again.
 */
export function todayRows<T extends { id: string }>(
  items: readonly T[],
  actions: readonly ActionItem[],
): { item: T; action: ActionItem }[] {
  const byId = new Map(actions.map((action) => [action.id, action]));
  return items.flatMap((item) => {
    const action = byId.get(item.id);
    return action && TODAY_STATUSES.includes(action.status) ? [{ item, action }] : [];
  });
}

/** Getting started's next steps for the card: the ones ready now ('new'), in order. */
export function nextSteps(steps: readonly GettingStartedStep[]): GettingStartedStep[] {
  return steps.filter((step) => step.state === 'new').slice(0, TODAY_STEPS);
}
