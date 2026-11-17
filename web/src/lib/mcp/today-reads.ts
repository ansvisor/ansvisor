import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { isCloud, isSubscriptionActive } from '@/config/plans';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { actionCode } from '@/lib/action-center/action-ref';
import { actionTexts, taskText } from '@/lib/action-center/display';
import { isReminderKind, type TodayStanding } from '@/lib/action-center/focus';
import {
  HISTORY_SORTS,
  filterHistory,
  summarize,
  type ActionHistoryItem,
  type HistoryFilters,
  type HistorySort,
} from '@/lib/action-center/history';
import { isMondayIn } from '@/lib/action-center/last-week';
import { priorityReasonText } from '@/lib/action-center/priority';
import { changeDirection } from '@/lib/action-center/since';
import {
  finishOne,
  waitingRows,
  type WaitingAction,
  type WaitingRow,
} from '@/lib/action-center/waiting';
import { getActionHistory } from '@/lib/actions/action-history';
import { getMyMenu } from '@/lib/actions/menu-access';
import { getSignalsSummary } from '@/lib/actions/signals';
import { getTodayFirstDay } from '@/lib/actions/today-first-day';
import type { FocusCard } from '@/lib/actions/today-focus';
import { getTodayStart } from '@/lib/actions/today-start';
import { getTodayEnded, getTodayLastWeek, type NamedAction } from '@/lib/actions/today-week';
import { readOnlyReason } from '@/lib/billing/subscription-access';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { signalTexts } from '@/lib/signals/display';
import type { Signal } from '@/lib/signals/map';
import { signalCode } from '@/lib/signals/signal-code';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isCardHidden } from '@/lib/user-brand-state';
import { asService } from './chat-facts';
import { brandAllowed } from './data';
import { pageOfList, type PageMeta } from './list-page';

/**
 * Chat's reads of Action Center › Today, History and the Signals summary
 * (the owner's plan of 2026-11-16, step 6b: Chat reads all a page shows).
 * Each calls the page's own functions, so Chat and the page never disagree:
 * Today's reads as the person (getTodayStart and the parts beside it), and
 * History's and the Signals summary's with the service role once the brand
 * is the caller's (asService). Null for a brand outside the caller's
 * organization or access. Server only.
 */

const t = <N extends string>(namespace: N) => {
  const tr = createTranslator({ locale: 'en', messages, namespace: namespace as never });
  return (key: string, values?: Record<string, string | number>) =>
    tr(key as never, values as never) as string;
};
const textsT = t('actionCenter.actionTexts');
const tasksT = t('actionCenter.actionTasks');
const priorityT = t('actionCenter.actionsPage.priority');
const signalsT = t('actionCenter.signalTexts');
const focusT = t('actionCenter.today.focus');
const endedT = t('actionCenter.today.ended');
const waitingT = t('actionCenter.today.waiting');
const promptsWaitingT = t('prompts.waiting.today');

const day = (at: string | null | undefined) => (at ? at.slice(0, 10) : null);
/** An action's page: the Actions list with its drawer open, as Today's buttons open it. */
const actionHref = (id: string) =>
  `/dashboard/action-center/actions?action=${encodeURIComponent(id)}`;
const titleOf = (action: Pick<NamedAction, 'kind' | 'payload'>) =>
  actionTexts(action as Parameters<typeof actionTexts>[0], textsT).title;

/** A part of Today: its answer, or that its read failed (its part stays away on the page too). */
type Part<T> = { ok: true; value: T } | { ok: false };
const part = <T>(read: Promise<T>): Promise<Part<T>> =>
  read.then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  );
const valueOf = <T>(read: Part<T>): T | null => (read.ok ? read.value : null);

// ─── Today ──────────────────────────────────────────────────────────────────

/** Today is the person's own page: read with their session, never anyone else's. */
const NO_SESSION =
  "Today is the person's own page, read with their session, and this run has none (an agent's or a schedule's run). For what to do first, read list_action_center_tasks (highest Priority Score first) and say it is the Actions list's order, not Today's focus.";

/** Whether the run's person is signed in to this request: Today reads as them. */
async function signedIn(userId: string): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await (await createClient()).auth.getSession();
    return session?.user.id === userId;
  } catch {
    // No request behind the run (the minute tick, a signal): no one signed in.
    return false;
  }
}

/**
 * Whether Today shows its read-only day for the brand, as the dashboard's
 * upgrade gate decides it: the cloud plan ended (not a payment being
 * retried), once ever subscribed, and the brand isn't the demo brand.
 */
async function planEnded(auth: McpAuthContext, brandId: string): Promise<boolean> {
  if (!isCloud() || !auth.organizationId) return false;
  const [org, brand] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('subscription_status, stripe_subscription_id')
      .eq('id', auth.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('brands')
      .select('is_demo')
      .eq('id', brandId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle(),
  ]);
  // A row that couldn't be read decides nothing, as on the dashboard.
  if (org.error || !org.data || brand.data?.is_demo) return false;
  const status = (org.data.subscription_status as string | null) ?? null;
  return (
    !isSubscriptionActive(status) &&
    readOnlyReason(status) === 'ended' &&
    Boolean(org.data.stripe_subscription_id)
  );
}

/** The person's own chats on the brand whose agent run waits for them, newest first. */
async function agentsWaiting(auth: McpAuthContext, brandId: string) {
  // Read when it is needed: Chat's list imports the engine, which lists this read.
  const { CHAT_LIST_DEFAULT, listChats } = await import('@/lib/chat/conversations');
  const list = await listChats(
    await createClient(),
    { userId: auth.userId, email: auth.email, organizationId: auth.organizationId! },
    { view: 'active', limit: CHAT_LIST_DEFAULT, brandId },
  );
  return list.chats
    .filter((chat) => chat.mine && chat.state === 'needsYou')
    .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
    .map((chat) => ({ id: chat.id, title: chat.title }));
}

/** A focus card as Today shows it, with its code: the first is what to do first. */
function focusRow(card: FocusCard, index: number) {
  const { action } = card;
  const texts = actionTexts(action, textsT);
  return {
    position: index + 1,
    id: card.id,
    ref: actionCode(action),
    title: texts.title,
    why: action.priorityReason
      ? priorityReasonText(action.priorityReason, priorityT)
      : texts.description,
    category: action.category,
    status: action.status,
    priority: action.priorityScore,
    priority_level: action.priorityLevel,
    effort: card.effort,
    steps: action.taskTotal > 0 ? `${action.taskCompleted}/${action.taskTotal}` : null,
    first_step: card.firstStep ? taskText(card.firstStep, tasksT) || null : null,
    who: card.who,
    new: card.isNew,
    open: actionHref(card.id),
  };
}

/** A change as Since yesterday lists it: its code, the line in the page's words, which way. */
function changeRow(signal: Signal) {
  return {
    id: signal.id,
    code: signalCode(signal),
    title: signalTexts(signal, signalsT).title,
    direction: changeDirection(signal),
    impact: signal.impact,
    category: signal.category,
    kind: signal.kind,
    detected: day(signal.lastDetectedAt ?? signal.detectedAt),
    action_added: Boolean(signal.actionId),
  };
}

/** What a waiting action's line names: its first step, else its title. */
const waitingWhat = (item: WaitingAction) =>
  (item.firstStep ? taskText(item.firstStep, tasksT) : null) || titleOf(item.action);

/** A row of Waiting for you, in the page's words, with where it opens. */
function waitingRow(row: WaitingRow) {
  switch (row.type) {
    case 'fix':
      return { type: row.type, line: waitingT(`fix.${row.reason}`) };
    case 'agent':
      return {
        type: row.type,
        count: row.count,
        line:
          row.count === 1
            ? row.title
              ? waitingT('agent.one', { title: row.title })
              : waitingT('agent.oneUntitled')
            : waitingT('agent.many', { count: row.count }),
        open: `/dashboard/chat/${encodeURIComponent(row.chatId)}`,
      };
    case 'drafts':
      return {
        type: row.type,
        count: row.count,
        line: waitingT('drafts.line', { count: row.count }),
        draft: row.title,
        open:
          row.count === 1
            ? `/dashboard/content/editor/${encodeURIComponent(row.draftId)}`
            : '/dashboard/content/library',
      };
    case 'due':
      return {
        type: row.type,
        ref: actionCode(row.item.action),
        title: titleOf(row.item.action),
        line: waitingT(row.overdue ? 'due.overdue' : 'due.today', { task: waitingWhat(row.item) }),
        due: row.item.dueDate,
        open: actionHref(row.item.id),
      };
    case 'reminder':
      return {
        type: row.type,
        ref: actionCode(row.item.action),
        line: waitingT('reminder.line', { title: titleOf(row.item.action) }),
        open: actionHref(row.item.id),
      };
    case 'review':
      return {
        type: row.type,
        count: row.count,
        line: waitingT('review.line', { count: row.count }),
        open: '/dashboard/action-center/review',
      };
    case 'prompts':
      return {
        type: row.type,
        count: row.count,
        line: !row.fits
          ? promptsWaitingT('line', { count: row.count })
          : row.free === null
            ? promptsWaitingT('roomUnlimited', { count: row.count })
            : promptsWaitingT('room', { free: row.free, count: row.count }),
        open: '/dashboard/prompts/tracked?status=waiting&swap=1',
      };
    case 'ideas':
      return {
        type: row.type,
        count: row.count,
        line: waitingT('ideas.line', {
          count: row.count,
          source: row.sources.length === 1 ? row.sources[0] : 'both',
        }),
        open: '/dashboard/prompts/suggestions',
      };
  }
}

const named = (list: { count: number; actions: NamedAction[] } | null) =>
  list && {
    count: list.count,
    actions: list.actions.map((action) => ({ id: action.id, title: titleOf(action) })),
  };

const standingOf = (standing: TodayStanding | null) =>
  standing && {
    score: standing.score,
    change: standing.change,
    rank: standing.rank,
    of: standing.of,
    neighbour: standing.neighbour,
    competitors: standing.competitors,
  };

/**
 * Action Center › Today as the person sees it now (get_today): the page's
 * own reads (getTodayStart, as Today calls it, with the person's menu and
 * whether the plan ended; Last week on their Monday, the first day's or the
 * ended day's read on those days), each part as the page shows it. Its
 * focus is in the cards' order: the first card is what to do first. Read
 * with the person's session only, as their Today is theirs; a run with none
 * gets a note saying what to read instead. Nothing is kept for the visit:
 * Today's "seen" stays the page's.
 */
export async function getTodayFor(
  auth: McpAuthContext,
  params: { brandId: string; timezone?: string | null; now?: Date },
) {
  if (!auth.organizationId || !(await brandAllowed(auth, params.brandId))) return null;
  if (!(await signedIn(auth.userId))) return { note: NO_SESSION };
  const { brandId } = params;
  const zone = params.timezone ?? null;
  const now = params.now ?? new Date();

  const [menu, ended] = await Promise.all([
    getMyMenu().catch(() => null),
    planEnded(auth, brandId).catch(() => false),
  ]);
  const hidden = menu?.hidden ?? [];
  const start = await getTodayStart(brandId, zone, hidden, ended);
  const [overview, state, focus, changes, waiting, setup, standing] = await Promise.all([
    part(start.overview),
    part(start.state),
    part(start.focus),
    part(start.changes),
    part(start.waiting),
    part(start.setup),
    part(start.standing),
  ]);
  const read = valueOf(overview);
  // As the page decides it: a failed overview shows the normal day.
  const mode = ended ? 'ended' : read?.lastRunAt === null ? 'first_day' : 'normal';
  const monday = mode === 'normal' && read !== null && isMondayIn(now, read.zone);
  const readAgents = chatAgenticEnabled(auth.organizationId) && !hidden.includes('agent');

  const [lastWeek, firstDay, endedRead, agents] = await Promise.all([
    monday ? part(getTodayLastWeek(brandId, zone)) : null,
    mode === 'first_day' ? part(getTodayFirstDay(brandId)) : null,
    mode === 'ended' ? part(getTodayEnded(brandId)) : null,
    mode === 'normal' && readAgents ? part(agentsWaiting(auth, brandId)) : null,
  ]);
  const week = lastWeek ? valueOf(lastWeek) : null;

  // Null on a day that shows no focus (a brand's first day), or when its read failed.
  const shown = valueOf(focus);
  const cards = shown ?? [];
  const waitingRead = valueOf(waiting);
  const rows =
    mode === 'normal' && waitingRead
      ? waitingRows({
          ...waitingRead,
          chatOn: readAgents,
          hidden: new Set(hidden),
          agents: agents ? valueOf(agents) : null,
          isReminder: isReminderKind,
          broken: null,
        }).map(waitingRow)
      : null;
  const finish = rows && rows.length === 0 ? finishOne(cards) : null;
  const personState = valueOf(state);
  const steps = valueOf(setup);
  const setupShown =
    mode === 'normal' &&
    steps !== null &&
    !steps.skipped &&
    steps.done < steps.total &&
    !(personState && isCardHidden(personState.hidden, 'setup'));
  const sinceRead = valueOf(changes);
  const first = cards[0] ? focusRow(cards[0], 0) : null;

  return {
    day: monday && week ? 'monday' : mode,
    answers_updated_at: read?.lastRunAt ?? null,
    loop: read && {
      tracked_prompts: read.trackedPrompts,
      open_actions: read.openActions,
      done_this_week: read.doneThisWeek,
    },
    focus: shown
      ? {
          title:
            mode === 'ended' ? endedT('focus.title') : week ? focusT('weekTitle') : focusT('title'),
          cards: cards.map(focusRow),
          ...(cards.length === 0 ? { empty: focusT('empty') } : {}),
        }
      : null,
    since_yesterday:
      mode === 'normal' && sinceRead
        ? {
            from: sinceRead.since,
            changes: sinceRead.items.map(changeRow),
            not_listed: Math.max(0, sinceRead.total - sinceRead.items.length),
            small_moves: sinceRead.small,
          }
        : null,
    waiting_for_you: rows && {
      rows,
      ...(rows.length === 0 ? { line: waitingT('nothing') } : {}),
      ...(finish
        ? {
            finish_one: waitingT('finish', {
              title: titleOf(finish.action),
              done: finish.action.taskCompleted,
              total: finish.action.taskTotal,
            }),
          }
        : {}),
    },
    where_you_stand: mode === 'normal' && !week ? standingOf(valueOf(standing)) : null,
    last_week: week && {
      visibility: standingOf(week.visibility),
      done: named(week.done),
      results: named(week.results),
    },
    setup: setupShown
      ? {
          done: steps.done,
          total: steps.total,
          steps_left: steps.steps
            .filter((step) => step.state !== 'done' && step.state !== 'skipped')
            .map((step) => ({ key: step.key, state: step.state, open: step.href })),
        }
      : null,
    first_day:
      firstDay && valueOf(firstDay)
        ? (({ engines, prompts, total, checked, suggestions }) => ({
            engines,
            prompts: prompts.map((p) => ({ text: p.text, topic: p.topic, demand: p.demand })),
            tracked_prompts: total,
            checked,
            suggestions: suggestions.map((s) => s.text),
          }))(valueOf(firstDay)!)
        : null,
    ended:
      endedRead && valueOf(endedRead)
        ? (({ lastRunAt, trial, prompts, competitors, done, improved, open, drafts }) => ({
            tracking_paused_since: lastRunAt,
            trial: standingOf(trial),
            prompts,
            competitors,
            done,
            improved: named(improved),
            open,
            drafts,
          }))(valueOf(endedRead)!)
        : null,
    note: first
      ? `The first action on Today is the first card of its focus: ${first.title} (${first.ref}). Name each card by its title, with its ref.`
      : mode === 'first_day'
        ? "The brand's first day: no AI answers yet, so Today has no focus and asks the person to check the prompts tracked for them (first_day)."
        : "Today's focus has no card now: new actions arrive after the nightly check. Say so, and offer the Actions list.",
  };
}

// ─── History ────────────────────────────────────────────────────────────────

/** A date the model or the run's range gave, as a timestamp the page's read takes. */
function stamp(value: string | undefined, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const at = Date.parse(bare ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

export interface HistoryPageParams {
  brandId: string;
  /** The window on when an action was raised, as History's range; none: all time. */
  dateFrom?: string;
  dateTo?: string;
  status?: HistoryFilters['status'];
  category?: HistoryFilters['type'];
  priority?: HistoryFilters['priority'];
  source?: HistoryFilters['source'];
  search?: string;
  /** newest (default), oldest or priority, as History's sort. */
  sort?: HistorySort;
  limit?: number;
  offset?: number;
}

const SORT_WORDS: Record<HistorySort, string> = {
  newest: 'newest first',
  oldest: 'oldest first',
  priority: 'highest Priority Score first',
};

/** An action as History's list shows it, compact: what it was, what it moved, when. */
function historyRow(item: ActionHistoryItem) {
  const reading = item.readings?.length ? item.readings[item.readings.length - 1] : null;
  return {
    id: item.id,
    ref: actionCode(item),
    title: titleOf(item),
    category: item.type,
    status: item.status,
    outcome: item.outcome,
    // A reading so far until the day-30 one.
    final: item.outcomeFinal === true,
    ...(reading ? { reading_day: reading.day } : {}),
    priority_level: item.priorityLevel,
    sources: item.sources,
    raised: day(item.createdAt),
    closed: day(item.completedAt),
    ...(item.timeToCloseDays !== null ? { days_to_close: item.timeToCloseDays } : {}),
    results: item.results.map((m) => ({
      metric: m.metric,
      before: m.before,
      after: m.after,
      unit: m.unit,
    })),
    ...(item.primaryMetric ? { judged_by: item.primaryMetric } : {}),
    ...(item.controlNet ? { net_of_control: item.controlNet.net } : {}),
    ...(item.dismissReason ? { dismiss_reason: item.dismissReason } : {}),
    ...(item.assignee?.fullName ? { assignee: item.assignee.fullName } : {}),
  };
}

/**
 * Action Center › History as the page lists it (get_action_history): the
 * page's own read (getActionHistory: its statuses, up to 500 raised in the
 * range, newest raised first), narrowed by the page's own filters and in
 * its order (filterHistory), a page at a time, with the summary cards over
 * the rows that match. The page's read is made whole for each page, as the
 * page makes it on each load.
 */
export async function historyPageFor(
  auth: McpAuthContext,
  params: HistoryPageParams,
): Promise<
  | (PageMeta & {
      range: { from: string | null; to: string | null };
      sort: HistorySort;
      summary: ReturnType<typeof summarize>;
      actions: ReturnType<typeof historyRow>[];
    })
  | null
> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const from = stamp(params.dateFrom, false);
  const to = stamp(params.dateTo, true);
  const items = await asService(() => getActionHistory(params.brandId, { from, to }));
  const sort = params.sort && HISTORY_SORTS.includes(params.sort) ? params.sort : 'newest';
  const rows = filterHistory(
    items,
    {
      status: params.status,
      type: params.category,
      priority: params.priority,
      source: params.source,
      search: params.search,
    },
    sort,
    (item) => {
      const texts = actionTexts(item as Parameters<typeof actionTexts>[0], textsT);
      return `${texts.title} ${texts.description} ${actionCode(item)}`;
    },
  );
  const { rows: page, ...meta } = pageOfList(rows, params, {
    what: 'actions in History',
    order: SORT_WORDS[sort],
  });
  return {
    ...meta,
    range: { from: day(from), to: day(to) },
    sort,
    summary: summarize(rows),
    actions: page.map(historyRow),
  };
}

// ─── The Signals summary ────────────────────────────────────────────────────

/** The Signals page's window when none is given: its default 30 days, to today (UTC). */
const SIGNALS_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * The Signals page's summary cards (get_signals_summary): its own read
 * (getSignalsSummary, the signals_summary function) over its window, by
 * day: the findings active in it, the high-impact ones, the new and the
 * resolved, each against the window before, and how many there are by
 * category and by source. Counts findings, as the page does (copies of one
 * finding count once).
 */
export async function getSignalsSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; dateFrom?: string; dateTo?: string; now?: Date },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const today = (params.now ?? new Date()).getTime();
  const dayTo = day(stamp(params.dateTo, true)) ?? day(new Date(today).toISOString())!;
  const dayFrom =
    day(stamp(params.dateFrom, false)) ??
    day(new Date(Date.parse(dayTo) - (SIGNALS_WINDOW_DAYS - 1) * DAY_MS).toISOString())!;
  const [first, last] = dayFrom <= dayTo ? [dayFrom, dayTo] : [dayTo, dayFrom];
  const s = await asService(() => getSignalsSummary(params.brandId, first, last));
  return {
    window: { from: first, to: last },
    active: { now: s.total, before: s.prevTotal },
    high_impact: { now: s.important, before: s.prevImportant },
    new: { now: s.newCount, before: s.prevNew },
    resolved: { now: s.resolved, before: s.prevResolved },
    by_category: s.byCategory,
    by_source: s.bySource,
    note: 'Counts of findings in the window (copies of one finding count once), each against the same number of days before it; by_category and by_source count the active ones.',
  };
}
