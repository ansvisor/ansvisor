/**
 * The Content plan (Content Editor CE-014, spec v2 §4): one ranked list of
 * what to create, optimize or protect next, built from the brand's open
 * Content Opportunities (new pages AI needs, pages to improve; tasks sent
 * from the Action Center become opportunities too) and its own pages as AI
 * cites them (content_plan_pages, 00220): pages losing citations, the top
 * pages, and pages competing for the same prompts.
 */

import { detectPageType, type SiteType } from './page-types';
import type { DraftMethod, PageType } from './drafts';
import { pageKey } from './sources';

export const PLAN_PERIODS = [7, 30] as const;
export type PlanPeriod = (typeof PLAN_PERIODS)[number];

export type PlanAction = 'create' | 'optimize' | 'protect';
/** The cards over the list, each a filter: the actions, and the pages competing. */
export const PLAN_CARDS = ['create', 'optimize', 'protect', 'overlaps'] as const;
export type PlanCard = (typeof PLAN_CARDS)[number];

/** One of the brand's pages, as content_plan_pages (00220) reads it. */
export interface PlanPage {
  page: string;
  title: string | null;
  citations: { cur: number; prev: number };
  prompts: number;
  /** Platform keys citing it less than before, the biggest drop first. */
  platformsDown: string[];
  aiVisits: number;
  /** The brand's other pages cited for two or more of the same prompts. */
  overlaps: number;
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
}

/** A draft still being written, to open rather than start another. */
export interface PlanDraft {
  id: string;
  author: 'user' | 'agent';
  isMine: boolean;
  method: DraftMethod;
  opportunityId: string | null;
  sourceUrl: string | null;
}

/** Why a row is on the list, and where the signal comes from. */
export type PlanWhy =
  | { kind: 'competitors'; names: string[]; visibility: number | null }
  | { kind: 'opportunity'; prompts: number }
  | { kind: 'citationsDown'; pct: number; platforms: string[] }
  | { kind: 'top'; citations: number; aiVisits: number }
  | { kind: 'overlap'; pages: number };

export interface PlanRow {
  key: string;
  action: PlanAction;
  title: string;
  /** The page it works on; null for a new page. */
  page: string | null;
  pageType: PageType | null;
  why: PlanWhy;
  source: 'opportunity' | 'citations' | 'protect' | 'overlap';
  /** The brand's other pages competing with this one. */
  overlaps: number;
  score: number;
  opportunityId: string | null;
  draft: PlanDraft | null;
}

/** A page losing this share of its citations, from at least this many, is losing ground. */
export const DROP_SHARE = 0.2;
export const MIN_PREV_CITATIONS = 3;
/** Top pages: cited at least this often, and not losing ground. */
export const MIN_TOP_CITATIONS = 5;
export const MAX_PROTECT = 5;
export const MAX_ROWS = 50;

/**
 * The rank of each kind of row, on the opportunities' 0–100 scale: an
 * opportunity keeps its own score; a page losing citations ranks by how much
 * it lost (40 + half the drop in percent + up to 20 for the citations lost);
 * a page only competing with others, 45; a top page by how much it is cited
 * (20 + citations, at most 60), so protecting comes after the work to do.
 */
export function citationsDownScore(pct: number, lost: number): number {
  return Math.min(100, 40 + Math.round(pct / 2) + Math.min(20, lost));
}
export const OVERLAP_SCORE = 45;
export function protectScore(citations: number): number {
  return Math.min(60, 20 + citations);
}

const CREATE_DECISIONS = new Set(['create']);

export function buildPlan({
  pages,
  opportunities,
  drafts,
  siteType,
}: {
  pages: PlanPage[];
  opportunities: PlanOpportunity[];
  drafts: PlanDraft[];
  siteType: SiteType;
}): { rows: PlanRow[]; counts: Record<PlanCard, number> } {
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
    const dropping = page && isDropping(page);
    rows.push({
      key: `opportunity:${o.id}`,
      action: create ? 'create' : 'optimize',
      title,
      page: create ? null : o.targetPage,
      pageType: typeOf(title, create ? null : o.targetPage),
      // The period's own signal, when the page is losing ground, says more.
      why: dropping
        ? dropWhy(page)
        : o.competitorsCited.length
          ? { kind: 'competitors', names: o.competitorsCited, visibility: o.visibility }
          : { kind: 'opportunity', prompts: o.prompts },
      source: dropping ? 'citations' : 'opportunity',
      overlaps: page?.overlaps ?? 0,
      score: dropping
        ? Math.max(o.score, citationsDownScore(dropPct(page), lost(page)))
        : Math.round(o.score),
      opportunityId: o.id,
      draft: draftFor(o.id, create ? null : o.targetPage),
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
      overlaps: page.overlaps,
      opportunityId: null,
      draft: draftFor(null, page.page),
    };
    if (isDropping(page)) {
      rows.push({
        ...base,
        key: `page:${key}`,
        action: 'optimize',
        why: dropWhy(page),
        source: 'citations',
        score: citationsDownScore(dropPct(page), lost(page)),
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
    } else if (page.overlaps > 0) {
      rows.push({
        ...base,
        key: `page:${key}`,
        action: 'optimize',
        why: { kind: 'overlap', pages: page.overlaps },
        source: 'overlap',
        score: OVERLAP_SCORE,
      });
    }
  }
  protect.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  rows.push(...protect.slice(0, MAX_PROTECT));

  rows.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const kept = rows.slice(0, MAX_ROWS);
  return {
    rows: kept,
    counts: {
      create: kept.filter((r) => r.action === 'create').length,
      optimize: kept.filter((r) => r.action === 'optimize').length,
      protect: kept.filter((r) => r.action === 'protect').length,
      overlaps: kept.filter((r) => r.overlaps > 0).length,
    },
  };
}

/** The rows a card shows: its action's, or the pages competing; all without a card. */
export function rowsFor(rows: PlanRow[], card: PlanCard | null): PlanRow[] {
  if (!card) return rows;
  if (card === 'overlaps') return rows.filter((r) => r.overlaps > 0);
  return rows.filter((r) => r.action === card);
}

function isDropping(page: PlanPage): boolean {
  const { cur, prev } = page.citations;
  return prev >= MIN_PREV_CITATIONS && cur <= prev * (1 - DROP_SHARE);
}

function dropPct(page: PlanPage): number {
  const { cur, prev } = page.citations;
  return prev > 0 ? Math.round(((prev - cur) / prev) * 100) : 0;
}

function lost(page: PlanPage): number {
  return Math.max(0, page.citations.prev - page.citations.cur);
}

function dropWhy(page: PlanPage): PlanWhy {
  return { kind: 'citationsDown', pct: dropPct(page), platforms: page.platformsDown };
}
