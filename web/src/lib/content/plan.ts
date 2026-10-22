/**
 * The Content plan (Content Editor CE-014, spec v2 §4): one ranked list of
 * what to create, optimize or protect next, built from the brand's open
 * Content Opportunities (new pages AI needs, pages to improve; tasks sent
 * from the Action Center become opportunities too) and its own pages as AI
 * cites them (content_plan_pages, 00220): pages losing citations and the
 * top pages. More of the brand's pages cited for the same prompts is no
 * loss (AI answers aren't a ranking), so that is not a reason to list a
 * page. A page loses ground when
 * it is cited less per tracked answer than in the period before, so a week
 * with fewer runs, or prompts added or removed, moves no page.
 */

import { opportunityPageType } from './asset-types';
import { detectPageType, type SiteType } from './page-types';
import type { DraftMethod, PageType } from './drafts';
import { pageKey } from './sources';

/** The Plan's periods: a week, a month, a quarter. */
export const PLAN_PERIODS = [7, 30, 90] as const;
export type PlanPeriod = (typeof PLAN_PERIODS)[number];

export type PlanAction = 'create' | 'optimize' | 'protect';
/** The cards over the list, each a filter: by its action, or the rows marked as a priority. */
export const PLAN_CARDS = ['create', 'optimize', 'protect', 'priority'] as const;
export type PlanCard = (typeof PLAN_CARDS)[number];

/** The brand's tracked answers in each period: what makes their citations comparable. */
export interface PlanAnswers {
  cur: number;
  prev: number;
}

/**
 * When the brand's tracking began, against the earlier period's first day
 * (UTC dates): an earlier period before it is only partly tracked, or not
 * at all, so pages are compared per answer, or not at all.
 */
export interface PlanTracking {
  prevFrom: string | null;
  trackedSince: string | null;
}

/** One of the brand's pages, as content_plan_pages (00220) reads it. */
export interface PlanPage {
  page: string;
  title: string | null;
  citations: { cur: number; prev: number };
  /** Platform keys citing it at a lower rate than before, the biggest drop first. */
  platformsDown: string[];
  aiVisits: number;
}

/** An open opportunity for one of the brand's own pages. */
export interface PlanOpportunity {
  id: string;
  title: string;
  /** The brief's suggested page title, when it has one. */
  pageTitle: string | null;
  decision: string | null;
  score: number;
  /** The page it works on, for an existing page, and that page's title. */
  targetPage: string | null;
  targetTitle: string | null;
  competitorsCited: string[];
  visibility: number | null;
  prompts: number;
  /** Its primary asset's type as stored (asset-types.ts): the page type it names. */
  assetType: string | null;
}

/** A draft still being written, to open rather than start another. */
export interface PlanDraft {
  id: string;
  author: 'user' | 'agent';
  isMine: boolean;
  method: DraftMethod;
  opportunityId: string | null;
  sourceUrl: string | null;
  /** The Action Center task it was sent as (Start's Team), and who it is assigned to. */
  actionId: string | null;
  assignee: { id: string; name: string } | null;
}

/** An admin's or manager's mark on a row (content_plan_marks, 00229), by the row's key. */
export interface PlanMark {
  rowKey: string;
  priority: boolean;
  hidden: boolean;
}

/** Why a row is on the list, and where the signal comes from. */
export type PlanWhy =
  | { kind: 'competitors'; names: string[]; visibility: number | null }
  | { kind: 'opportunity'; prompts: number }
  | { kind: 'citationsDown'; pct: number; platforms: string[] }
  | { kind: 'top'; citations: number; aiVisits: number };

export interface PlanRow {
  key: string;
  action: PlanAction;
  title: string;
  /** The page it works on; null for a new page. */
  page: string | null;
  pageType: PageType | null;
  why: PlanWhy;
  source: 'opportunity' | 'citations' | 'protect';
  score: number;
  opportunityId: string | null;
  draft: PlanDraft | null;
  /** Marked as a priority: at the top of the list, tagged. */
  priority: boolean;
}

/**
 * A page losing this share of its citations per answer, from at least this
 * many citations, is losing ground.
 */
export const DROP_SHARE = 0.2;
export const MIN_PREV_CITATIONS = 3;
/** Top pages: cited at least this often, and not losing ground. */
export const MIN_TOP_CITATIONS = 5;
export const MAX_PROTECT = 5;
export const MAX_ROWS = 50;

/**
 * The rank of each kind of row, on the opportunities' 0–100 scale: an
 * opportunity keeps its own score; a page losing citations ranks by how much
 * it lost, the citations more than the share (40 + a fifth of the drop in
 * percent + up to 40 for the citations lost), so 200 → 118 outranks 3 → 0;
 * a top page by how much it is cited (20 + citations, at most 60), so
 * protecting comes after the work to do.
 */
export function citationsDownScore(pct: number, lost: number): number {
  return Math.min(100, 40 + Math.round(pct / 5) + Math.min(40, lost));
}
export function protectScore(citations: number): number {
  return Math.min(60, 20 + citations);
}

const CREATE_DECISIONS = new Set(['create']);
/** An opportunity to defend a page the brand holds: protecting it, not optimizing. */
const PROTECT_DECISIONS = new Set(['defend']);

/**
 * Every row, ranked, and what each card counts: the list shows the first
 * MAX_ROWS of a card's rows (rowsFor), so a card never counts rows it can't
 * show. Rows marked as a priority come first; hidden rows leave the list
 * and its counts for `hidden`, to be shown again.
 */
export function buildPlan({
  pages,
  answers,
  opportunities,
  drafts,
  marks = [],
  siteType,
}: {
  pages: PlanPage[];
  answers: PlanAnswers;
  opportunities: PlanOpportunity[];
  drafts: PlanDraft[];
  marks?: PlanMark[];
  siteType: SiteType;
}): { rows: PlanRow[]; hidden: PlanRow[]; counts: Record<PlanCard, number> } {
  const byPage = new Map<string, PlanPage>();
  for (const page of pages) {
    const key = pageKey(page.page);
    if (key && !byPage.has(key)) byPage.set(key, page);
  }
  const draftFor = (opportunityId: string | null, page: string | null): PlanDraft | null => {
    const key = page ? pageKey(page) : null;
    return (
      drafts.find(
        (d) =>
          (opportunityId && d.opportunityId === opportunityId) ||
          (key && d.method === 'optimize' && d.sourceUrl && pageKey(d.sourceUrl) === key),
      ) ?? null
    );
  };
  const typeOf = (title: string, page: string | null) =>
    detectPageType({ title, url: page ?? undefined }, siteType);

  const rows: PlanRow[] = [];
  const pagesTaken = new Set<string>();

  for (const o of opportunities) {
    const create = !o.decision || CREATE_DECISIONS.has(o.decision) || !o.targetPage;
    const key = o.targetPage ? pageKey(o.targetPage) : null;
    const page = key ? byPage.get(key) : undefined;
    // A new page by the title its brief suggests; an existing one by its own.
    const title = (create ? o.pageTitle : o.targetTitle) || o.title;
    const drop = page ? dropOf(page, answers) : null;
    rows.push({
      key: `opportunity:${o.id}`,
      action: create ? 'create' : PROTECT_DECISIONS.has(o.decision ?? '') ? 'protect' : 'optimize',
      title,
      page: create ? null : o.targetPage,
      // A new page is what the opportunity names; an existing one is what
      // its address or title shows, else what the opportunity names.
      pageType: create
        ? (opportunityPageType(o.assetType, siteType) ?? typeOf(title, null))
        : (typeOf(title, o.targetPage) ?? opportunityPageType(o.assetType, siteType)),
      // The period's own signal, when the page is losing ground, says more.
      why:
        page && drop
          ? dropWhy(page, drop)
          : o.competitorsCited.length
            ? { kind: 'competitors', names: o.competitorsCited, visibility: o.visibility }
            : { kind: 'opportunity', prompts: o.prompts },
      source: drop ? 'citations' : 'opportunity',
      score: drop
        ? Math.max(o.score, citationsDownScore(drop.pct, drop.lost))
        : Math.round(o.score),
      opportunityId: o.id,
      draft: draftFor(o.id, create ? null : o.targetPage),
      priority: false,
    });
    if (key && !create) pagesTaken.add(key);
  }

  const protect: PlanRow[] = [];
  for (const [key, page] of byPage) {
    if (pagesTaken.has(key)) continue;
    const title = page.title?.trim() || page.page;
    const base = {
      title,
      page: page.page,
      pageType: typeOf(title, page.page),
      opportunityId: null,
      draft: draftFor(null, page.page),
      priority: false,
    };
    const drop = dropOf(page, answers);
    if (drop) {
      rows.push({
        ...base,
        key: `page:${key}`,
        action: 'optimize',
        why: dropWhy(page, drop),
        source: 'citations',
        score: citationsDownScore(drop.pct, drop.lost),
      });
    } else if (page.citations.cur >= MIN_TOP_CITATIONS) {
      protect.push({
        ...base,
        key: `page:${key}`,
        action: 'protect',
        why: { kind: 'top', citations: page.citations.cur, aiVisits: page.aiVisits },
        source: 'protect',
        score: protectScore(page.citations.cur),
      });
    }
  }
  protect.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  rows.push(...protect.slice(0, MAX_PROTECT));

  const markOf = new Map(marks.map((m) => [m.rowKey, m]));
  const hidden: PlanRow[] = [];
  const listed: PlanRow[] = [];
  for (const row of rows) {
    const mark = markOf.get(row.key);
    if (mark?.hidden) hidden.push(row);
    else listed.push({ ...row, priority: Boolean(mark?.priority) });
  }
  const ranked = (a: PlanRow, b: PlanRow) => b.score - a.score || a.title.localeCompare(b.title);
  listed.sort((a, b) => Number(b.priority) - Number(a.priority) || ranked(a, b));
  hidden.sort(ranked);
  return {
    rows: listed,
    hidden,
    counts: {
      create: listed.filter((r) => r.action === 'create').length,
      optimize: listed.filter((r) => r.action === 'optimize').length,
      protect: listed.filter((r) => r.action === 'protect').length,
      priority: listed.filter((r) => r.priority).length,
    },
  };
}

/**
 * The rows a card shows, the first MAX_ROWS: its action's, or the
 * priorities; all without a card. A page type (the mix's filter) narrows
 * them before the cut, so its rows are never cut off by others.
 */
export function rowsFor(
  rows: PlanRow[],
  card: PlanCard | null,
  pageType: PageType | null = null,
): PlanRow[] {
  return rows
    .filter(
      (r) =>
        (!card || (card === 'priority' ? r.priority : r.action === card)) &&
        (!pageType || r.pageType === pageType),
    )
    .slice(0, MAX_ROWS);
}

/** Whether the earlier period was tracked in full, partly, or not at all. */
export function earlierPeriod(
  answers: PlanAnswers,
  tracking: PlanTracking,
): 'full' | 'partial' | 'none' {
  if (answers.prev <= 0) return 'none';
  if (tracking.prevFrom && tracking.trackedSince && tracking.trackedSince > tracking.prevFrom) {
    return 'partial';
  }
  return 'full';
}

/**
 * How much ground a page lost, per tracked answer: null when it isn't losing
 * any (or the brand had no answers in a period to compare). `lost` is the
 * citations it would have had at the earlier rate, less the ones it got.
 */
function dropOf(page: PlanPage, answers: PlanAnswers): { pct: number; lost: number } | null {
  const { cur, prev } = page.citations;
  if (prev < MIN_PREV_CITATIONS || answers.cur <= 0 || answers.prev <= 0) return null;
  const rateNow = cur / answers.cur;
  const rateBefore = prev / answers.prev;
  if (rateNow > rateBefore * (1 - DROP_SHARE)) return null;
  return {
    pct: Math.round(((rateBefore - rateNow) / rateBefore) * 100),
    lost: Math.max(0, Math.round(rateBefore * answers.cur - cur)),
  };
}

function dropWhy(page: PlanPage, drop: { pct: number }): PlanWhy {
  return { kind: 'citationsDown', pct: drop.pct, platforms: page.platformsDown };
}
