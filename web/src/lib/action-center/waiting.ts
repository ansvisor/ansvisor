import type { ActionItem } from '@/lib/actions/action-center';
import type { TodayStep } from '@/lib/action-center/today';

/**
 * Today's "Waiting for you" (SIMPLE_NAV, simplification plan PR 9): what
 * waits on the person, in order, each row only for a role that can act on
 * it and only while its section is on the person's menu:
 *
 *   1. agent    their agent runs on this brand waiting for an OK (Chat's
 *               Agents at work), with the new Chat on and Chat on their menu
 *   2. drafts   drafts in review in the Library (Content)
 *   3. due      open actions due today or overdue, theirs or no one's
 *   4. reminder recurring reminders, such as the weekly Business Hub numbers
 *   5. review   tasks waiting in Needs review (admins and managers)
 *   6. ideas    new prompt ideas from Search Console or Analytics since they
 *               last looked (admins and managers, Prompts)
 *
 * Nothing is stored; each row reads what the app already keeps. Pure: the
 * server action and the page read, this orders and filters.
 */

export type WaitingType = 'agent' | 'drafts' | 'due' | 'reminder' | 'review' | 'ideas';

/** An action a row opens: its first step still to do, and when it is due. */
export interface WaitingAction {
  id: string;
  action: ActionItem;
  firstStep: TodayStep | null;
  /** YYYY-MM-DD; null for a reminder without one. */
  dueDate: string | null;
}

export type WaitingRow =
  | { type: 'agent'; count: number; chatId: string; title: string | null }
  | { type: 'drafts'; count: number; draftId: string; title: string }
  | { type: 'due'; item: WaitingAction; overdue: boolean }
  | { type: 'reminder'; item: WaitingAction }
  | { type: 'review'; count: number }
  | { type: 'ideas'; count: number; sources: ('gsc' | 'ga')[] };

/** The menu section a row belongs to; the Action Center's rows are always on. */
const SECTION: Record<WaitingType, string | null> = {
  agent: 'agent',
  drafts: 'content',
  due: null,
  reminder: null,
  review: null,
  ideas: 'prompts',
};

/** Rows only admins and managers act on. */
const MANAGERS_ONLY: readonly WaitingType[] = ['review', 'ideas'];

/** Due rows listed at most; the rest wait in All actions. */
export const DUE_ROWS = 3;

/** What each read found; null for a read that wasn't made or failed (its rows stay away). */
export interface WaitingInput {
  canManage: boolean;
  /** The new Chat on for the workspace. */
  chatOn: boolean;
  /** The person's menu sections that are off. */
  hidden: ReadonlySet<string>;
  /** Their own chats on this brand whose agent run waits for them, newest first. */
  agents: { id: string; title: string | null }[] | null;
  /** Drafts in review, newest first. */
  drafts: { id: string; title: string }[] | null;
  /** Open actions due today or before, theirs or no one's, and reminders. */
  actions: WaitingAction[] | null;
  isReminder: (kind: string) => boolean;
  /** The person's day, YYYY-MM-DD. */
  today: string;
  reviews: number | null;
  ideas: { count: number; sources: ('gsc' | 'ga')[] } | null;
}

/** The rows, in order. */
export function waitingRows(input: WaitingInput): WaitingRow[] {
  const rows: WaitingRow[] = [];
  if (input.chatOn && input.agents && input.agents.length > 0) {
    const [first] = input.agents;
    rows.push({ type: 'agent', count: input.agents.length, chatId: first.id, title: first.title });
  }
  if (input.drafts && input.drafts.length > 0) {
    const [first] = input.drafts;
    rows.push({
      type: 'drafts',
      count: input.drafts.length,
      draftId: first.id,
      title: first.title,
    });
  }
  const actions = input.actions ?? [];
  const due = actions
    .filter((item) => !input.isReminder(item.action.kind) && item.dueDate !== null)
    .filter((item) => item.dueDate! <= input.today)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  for (const item of due.slice(0, DUE_ROWS)) {
    rows.push({ type: 'due', item, overdue: item.dueDate! < input.today });
  }
  for (const item of actions.filter((entry) => input.isReminder(entry.action.kind))) {
    rows.push({ type: 'reminder', item });
  }
  if (input.reviews !== null && input.reviews > 0)
    rows.push({ type: 'review', count: input.reviews });
  if (input.ideas && input.ideas.count > 0) rows.push({ type: 'ideas', ...input.ideas });

  return rows.filter((row) => {
    if (MANAGERS_ONLY.includes(row.type) && !input.canManage) return false;
    const section = SECTION[row.type];
    return section === null || !input.hidden.has(section);
  });
}

/**
 * On a day nothing waits: the action in the person's focus that is furthest
 * along (in progress, the most steps done), as "A good day to finish one".
 */
export function finishOne<
  T extends { action: Pick<ActionItem, 'status' | 'taskCompleted' | 'taskTotal'> },
>(cards: readonly T[]): T | null {
  return (
    cards
      .filter(
        (card) =>
          card.action.status === 'in_progress' &&
          card.action.taskCompleted > 0 &&
          card.action.taskCompleted < card.action.taskTotal,
      )
      .sort((a, b) => b.action.taskCompleted - a.action.taskCompleted)[0] ?? null
  );
}
