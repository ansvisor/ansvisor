import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { getKpiSnapshots } from '@/lib/actions/kpis';
import { getGettingStarted } from '@/lib/actions/getting-started';
import { getTrackingWindow } from '@/lib/actions/tracking';
import { addDays } from '@/lib/insights-windows';
import { actionCode } from '@/lib/action-center/action-ref';
import { askedCodes, lookUpCodes, type ActionCodeLookup } from '@/lib/action-center/action-codes';
import { actionTexts } from '@/lib/action-center/display';
import { readEntityCounts, withEntityCounts } from '@/lib/action-center/entity-counts';
import { storedPriorityLevel } from '@/lib/action-center/priority';
import {
  OPEN_ACTION_STATUSES,
  taskProgress,
  type ActionStatus,
} from '@/lib/action-center/registry';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { assigneeNames, brandAllowed, staleFor } from './data';
import { asService, newestOf } from './chat-facts';

/**
 * Chat's Action Center reads (CHAT-20 §9 rows 38, 41 and 47): the brand's
 * actions a page at a time, the KPIs page's snapshots and Getting started's
 * steps, read with the service role once the brand is the caller's. Null for
 * a brand outside the organization.
 */

/** A date the app or the model gave as its UTC day; null when it isn't one. */
const kpiDay = (value: string | undefined) => {
  const day = value?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) ? day : null;
};

/**
 * The longest period the KPIs read, in days (the maintainer's review of
 * 2026-11-17): a year. A longer one keeps its last KPI_PERIOD_MAX_DAYS days,
 * as the other reads keep the end of a period too long for them (the Why
 * read's 92 days, Prompts' 90), and the result's note says so.
 */
export const KPI_PERIOD_MAX_DAYS = 365;

/**
 * The brand's KPIs, as the KPIs page reads them: over the period's whole
 * UTC days when both ends are given (the page's date range; at most
 * KPI_PERIOD_MAX_DAYS, its last ones), else each KPI over its own timeframe.
 */
export async function getActionCenterKpisFor(
  auth: McpAuthContext,
  params: { brandId: string; dateFrom?: string; dateTo?: string },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const dayFrom = kpiDay(params.dateFrom);
  const dayTo = kpiDay(params.dateTo);
  const asked = dayFrom && dayTo && dayFrom <= dayTo ? { dayFrom, dayTo } : undefined;
  // A period over a year (2015 to today): its last KPI_PERIOD_MAX_DAYS days.
  const earliest = asked ? addDays(asked.dayTo, -(KPI_PERIOD_MAX_DAYS - 1)) : null;
  const capped = !!asked && !!earliest && asked.dayFrom < earliest;
  const period = asked && capped ? { dayFrom: earliest!, dayTo: asked.dayTo } : asked;
  const [snapshots, window] = await asService(() =>
    Promise.all([getKpiSnapshots(params.brandId, period), getTrackingWindow(params.brandId)]),
  );
  return {
    configured: snapshots.configured,
    kpis: snapshots.kpis.map((kpi) => ({
      key: kpi.key,
      category: kpi.category,
      unit: kpi.unit,
      direction: kpi.direction,
      timeframe: kpi.timeframe,
      value: kpi.value,
      change: kpi.change,
      change_kind: kpi.changeKind,
      target: kpi.target,
      progress: kpi.progress,
      status: kpi.status,
    })),
    // The KPIs read the brand's tracked answers: as of its last completed run.
    data_as_of: window.lastRunAt ?? null,
    ...(period ? { period: { from: period.dayFrom, to: period.dayTo } } : {}),
    ...(capped && asked && period
      ? {
          note: `The period asked, ${asked.dayFrom} to ${asked.dayTo}, is longer than ${KPI_PERIOD_MAX_DAYS} days, the most the KPIs read: they are over its last ${KPI_PERIOD_MAX_DAYS} days, ${period.dayFrom} to ${period.dayTo}.`,
        }
      : {}),
  };
}

export async function getOnboardingProgressFor(auth: McpAuthContext, params: { brandId: string }) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const status = await asService(() => getGettingStarted(params.brandId));
  if (!status) return null;
  return {
    active: status.active,
    skipped: status.skipped,
    done: status.done,
    total: status.total,
    steps: status.steps.map((step) => ({
      key: step.key,
      stage: step.stage,
      state: step.state,
      progress: step.progress,
    })),
    data_as_of: newestOf(status.steps.map((step) => step.updatedAt)),
  };
}

// ─── The brand's actions, a page at a time ──────────────────────────────────

/** The most actions one page holds, and how many a page holds when none is asked (CHAT-04's ~50 rows). */
export const ACTIONS_PAGE_MAX = 50;

/**
 * Which actions a page counts: `open` (New, In progress, On hold), `all`
 * (every status, as the Actions list opens), or one status.
 */
export type ActionsPageStatus = 'open' | 'all' | ActionStatus;
export type ActionsPageSort = 'priority' | 'updated';

export interface ActionsPageParams {
  brandId: string;
  /** `open` when left out. */
  status?: ActionsPageStatus;
  category?: string;
  /**
   * `priority` (default): highest Priority Score first, unscored last;
   * `updated`: most recently updated first, as the Actions list opens
   * (lib/action-center/sort.ts), its later number first on the same instant.
   */
  sort?: ActionsPageSort;
  /** Rows on this page, 1 to ACTIONS_PAGE_MAX; ACTIONS_PAGE_MAX when left out. */
  limit?: number;
  /** Rows before this page, in the same order: a page's `next_offset`. */
  offset?: number;
}

/** One action, compact: what an answer names it by and what ranks it, nothing more. */
export interface ActionsPageRow {
  /** For get_action; never shown. */
  id: string;
  /** Its code as the app shows and links it, "AC-12" (actionCode: its brand's number, 00534). */
  ref: string;
  /** Its title, as the Actions list words it. */
  title: string;
  category: string;
  status: string;
  /** Its 0–100 Priority Score and its level; null until the Action Center scored it. */
  priority: number | null;
  priority_level: string | null;
  /** The day it went stale (New for 30 days with no one's event); only on a stale action. */
  stale_since?: string;
  /** Its due day; only when it has one. */
  due?: string;
  /** Who it is assigned to; only when someone is. */
  assignee?: string;
  /** Its tasks done of its tasks, as the list's "1/3". */
  tasks: string;
  /** The day it last changed. */
  updated: string;
}

export interface ActionsPage {
  status: ActionsPageStatus;
  category: string | null;
  sort: ActionsPageSort;
  /** Every action that matches, not only this page's. */
  total: number;
  /** Rows before this page. */
  offset: number;
  /** The offset of the next page; null on the last one. */
  next_offset: number | null;
  /** "Showing N of M", in words the model repeats. */
  note: string;
  actions: ActionsPageRow[];
}

/** PostgREST's answer to an offset past the rows it counted (416). */
const PAST_THE_END = 'PGRST103';

const textsT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionTexts' });

/** The plain (key, values) translator display.ts's helpers take. */
const plainTexts = (key: string, values?: Record<string, string | number>) =>
  textsT(key as never, values as never);

const STATUS_WORDS: Record<Exclude<ActionsPageStatus, 'all'>, string> = {
  open: 'open',
  new: 'New',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  dismissed: 'Dismissed',
};

const day = (at: string | null | undefined) => (at ? at.slice(0, 10) : undefined);

/** What the page holds against what matches, so the answer says how much it judged. */
export function actionsPageNote(page: {
  status: ActionsPageStatus;
  category: string | null;
  sort: ActionsPageSort;
  total: number;
  offset: number;
  shown: number;
}): string {
  const { total, offset, shown } = page;
  const where = page.category ? ` in ${page.category}` : '';
  const status = page.status === 'all' ? '' : `${STATUS_WORDS[page.status]} `;
  const what = `${status}actions${where}${page.status === 'all' ? ', every status' : ''}`;
  const order =
    page.sort === 'updated' ? 'most recently updated first' : 'highest Priority Score first';
  const naming = 'Name each by its title, with its ref.';
  if (total === 0) return `No ${what}.`;
  if (shown === 0) return `No ${what} past offset ${offset}: there are ${total} in all.`;
  const end = offset + shown;
  if (offset === 0 && end >= total) {
    return total === 1
      ? `The only ${status}action${where}. Name it by its title, with its ref.`
      : `All ${total} ${what}, ${order}. ${naming}`;
  }
  const left = total - end;
  return [
    `Showing ${offset + 1}–${end} of ${total} ${what}, ${order}.`,
    left > 0
      ? `${left} more not shown: read them with offset ${end}, or say the answer covers ${offset === 0 ? `the top ${end}` : `${offset + 1}–${end}`} of ${total}.`
      : `The first ${offset} were on earlier pages.`,
    naming,
  ].join(' ');
}

interface ActionsPageDbRow {
  id: string;
  action_no: number;
  brand_no?: number | null;
  kind: string;
  category: string;
  status: string;
  assignee_id: string | null;
  due_date: string | null;
  updated_at: string;
  priority_score: number | null;
  priority_level: string | null;
  stale_at: string | null;
  payload: Record<string, unknown> | null;
}

/**
 * The brand's actions a page at a time, for Chat (CHAT-20 §9 row 38): every
 * one that matches is counted and ordered on the server, highest Priority
 * Score first, so the page is the top of all of them, never the first few
 * read. Each row is compact (its number, title, score, status, stale, due
 * day, assignee, category, tasks and last change), so a page of 50 stays
 * cheap, and `total`, `next_offset` and `note` say how much of the whole it
 * is. Open actions unless a status is asked; never a deleted one. Null for a
 * brand outside the caller's organization or access.
 */
export async function listActionsPageFor(
  auth: McpAuthContext,
  params: ActionsPageParams,
): Promise<ActionsPage | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const status = params.status ?? 'open';
  const category = params.category ?? null;
  const sort = params.sort ?? 'priority';
  const limit = Math.min(
    Math.max(Math.trunc(params.limit ?? ACTIONS_PAGE_MAX), 1),
    ACTIONS_PAGE_MAX,
  );
  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);

  // The brand's actions that match; `head` for their count alone.
  const matching = (head: boolean) => {
    let query = supabaseAdmin
      .from('actions')
      .select(
        'id, action_no, brand_no, kind, category, status, assignee_id, due_date, updated_at, priority_score, priority_level, stale_at, payload',
        { count: 'exact', head },
      )
      .eq('brand_id', params.brandId)
      // A deleted action (00168) is gone for everyone but the nightly generator.
      .is('deleted_at', null);
    if (status === 'open') query = query.in('status', [...OPEN_ACTION_STATUSES]);
    else if (status !== 'all') query = query.eq('status', status);
    return category ? query.eq('category', category) : query;
  };
  const ordered =
    sort === 'updated'
      ? // As the Actions list orders it (sort.ts byUpdated): the later number first on the same instant.
        matching(false)
          .order('updated_at', { ascending: false })
          .order('action_no', { ascending: false })
      : matching(false)
          .order('priority_score', { ascending: false, nullsFirst: false })
          .order('updated_at', { ascending: false });
  // Its id last, so a page starts where the one before ended, ties and all.
  const { data, count, error } = await ordered.order('id').range(offset, offset + limit - 1);

  const page = (total: number, actions: ActionsPageRow[]): ActionsPage => {
    const end = offset + actions.length;
    return {
      status,
      category,
      sort,
      total,
      offset,
      next_offset: actions.length > 0 && end < total ? end : null,
      note: actionsPageNote({ status, category, sort, total, offset, shown: actions.length }),
      actions,
    };
  };
  if (error?.code === PAST_THE_END) {
    // Past the last match: an empty page, with the count of them all.
    const { count: total, error: countError } = await matching(true);
    if (countError) throw new Error(countError.message);
    return page(total ?? 0, []);
  }
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ActionsPageDbRow[];
  const total = count ?? rows.length;
  if (rows.length === 0) return page(total, []);
  return page(total, await compactRows(rows));
}

/** Each action as a page row: its tasks, assignee and what is left of its targets read with it. */
async function compactRows(rows: ActionsPageDbRow[]): Promise<ActionsPageRow[]> {
  const ids = rows.map((row) => row.id);
  const [tasks, names, entityCounts] = await Promise.all([
    supabaseAdmin.from('action_tasks').select('action_id, status').in('action_id', ids),
    assigneeNames(rows.map((row) => row.assignee_id)),
    // Each action's list (AC-009): named with what is left of its targets, as the list does.
    readEntityCounts(supabaseAdmin, ids),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  const statuses = new Map<string, string[]>();
  for (const task of (tasks.data ?? []) as { action_id: string; status: string }[]) {
    statuses.set(task.action_id, [...(statuses.get(task.action_id) ?? []), task.status]);
  }

  return rows.map((row) => {
    const payload = withEntityCounts(row.payload ?? {}, entityCounts.get(row.id));
    const progress = taskProgress(statuses.get(row.id) ?? []);
    const stale = staleFor(row);
    const assignee = row.assignee_id ? names.get(row.assignee_id) : null;
    const due = day(row.due_date);
    const score = row.priority_score === null ? null : Number(row.priority_score);
    return {
      id: row.id,
      ref: actionCode({ actionNo: row.action_no, brandNo: row.brand_no }),
      title: actionTexts(
        { kind: row.kind, payload } as Parameters<typeof actionTexts>[0],
        plainTexts,
      ).title,
      category: row.category,
      status: row.status,
      priority: score,
      // As the list shows it: the stored level, or the score's when that is missing.
      priority_level: storedPriorityLevel(row.priority_level, score),
      ...(stale.stale && stale.stale_at ? { stale_since: day(stale.stale_at) } : {}),
      ...(due ? { due } : {}),
      ...(assignee ? { assignee } : {}),
      tasks: `${progress.completed}/${progress.total}`,
      updated: day(row.updated_at) ?? row.updated_at,
    };
  });
}

// ─── The brand's actions by their codes ─────────────────────────────────────

/** What the codes found: each action a code named, with its page row, and the codes not found. */
export type ActionsByCode = ActionCodeLookup<ActionsPageRow>;

/**
 * The brand's actions by the codes a person wrote ("AC-481", "AC 481",
 * "ac481", "#481", "481", "AC-07"), for Chat (the owner's report of
 * 2026-11-16: "what is AC-481?" was answered from a page of the list that
 * didn't hold it). A code is read as the Actions list's search and the
 * actions/code route read it (matchesActionCode, action-codes.ts): the
 * brand's number (brand_no, 00534) or the old global number (action_no),
 * so one code can name two actions, and both come back, never one picked.
 * Every status, Completed and Dismissed included; never a deleted action.
 * Only this brand of the caller's organization is read, its organization
 * joined on the rows too: a code of another brand or workspace is not
 * found. Null for a brand outside the caller's organization or access.
 */
export async function listActionsByCodeFor(
  auth: McpAuthContext,
  params: { brandId: string; codes: readonly string[] },
): Promise<ActionsByCode | null> {
  if (!auth.organizationId || !(await brandAllowed(auth, params.brandId))) return null;
  const asked = askedCodes(params.codes);
  const numbers = asked.flatMap((code) => (code.no === null ? [] : [code.no]));

  let rows: ActionsPageDbRow[] = [];
  if (numbers.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('actions')
      .select(
        'id, action_no, brand_no, kind, category, status, assignee_id, due_date, updated_at, priority_score, priority_level, stale_at, payload, brands!inner(organization_id)',
      )
      .eq('brand_id', params.brandId)
      .eq('brands.organization_id', auth.organizationId)
      // A deleted action (00168) is gone for everyone but the nightly generator.
      .is('deleted_at', null)
      // Numbers only (searchedActionNo): none of the model's text reaches the filter.
      .or(numbers.flatMap((no) => [`brand_no.eq.${no}`, `action_no.eq.${no}`]).join(','))
      .order('id');
    if (error) throw new Error(error.message);
    rows = (data ?? []) as unknown as ActionsPageDbRow[];
  }
  const compact = rows.length > 0 ? await compactRows(rows) : [];
  return lookUpCodes(
    asked,
    rows.map((row, i) => ({
      numbered: { actionNo: Number(row.action_no), brandNo: row.brand_no ?? null },
      row: compact[i],
    })),
  );
}
