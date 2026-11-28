import { mentionExcerpt } from '@/lib/mention-match';
import type { BreakdownMetric } from '@/lib/insights-breakdown';
import type { MetricWindow } from '@/lib/insights-windows';

/**
 * The answers behind an Insights card (the breakdown panel's Answers tab):
 * the prompt_results the card's number is read from, for the same window and
 * filters, a page at a time. Shared by the server action and its tests; the
 * action file only exports async functions ('use server').
 */

export const ANSWERS_PAGE_SIZE = 25;

/** About this many characters of the answer, cut on whole words. */
export const ANSWER_EXCERPT_CHARS = 200;

/**
 * What an answer says about the brand. An answer with no text is "noAnswer":
 * nothing was tracked, so it is never read as "not mentioned".
 */
export type AnswerStatus = 'mentioned' | 'notMentioned' | 'noAnswer';

export interface InsightsAnswer {
  id: string;
  promptId: string;
  promptText: string;
  platform: string;
  model: string | null;
  region: string | null;
  createdAt: string;
  status: AnswerStatus;
  /** The brand's place among the brands the answer names; null when it isn't placed. */
  position: number | null;
  excerpt: string;
  /** Sources the answer cited, and how many of them are the brand's own domains. */
  sources: number;
  ownSources: number;
}

export interface InsightsAnswersPage {
  answers: InsightsAnswer[];
  /** Every answer matching the window and filters, across all pages. */
  total: number;
  /** 1-based. */
  page: number;
  pageSize: number;
}

export const emptyAnswersPage = (page: number): InsightsAnswersPage => ({
  answers: [],
  total: 0,
  page,
  pageSize: ANSWERS_PAGE_SIZE,
});

/** A page number from the caller: a whole number from 1. */
export function answersPage(page: unknown): number {
  const n = Math.floor(Number(page));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The `.range()` of a 1-based page. */
export function answersRange(page: number): { from: number; to: number } {
  const from = (page - 1) * ANSWERS_PAGE_SIZE;
  return { from, to: from + ANSWERS_PAGE_SIZE - 1 };
}

/**
 * The created_at bounds of the card's window, as insights_breakdown_groups
 * (00129) reads them: whole UTC days from the first day's midnight to before
 * the midnight after the last, or a timestamp range inclusive on both ends.
 * An absent bound is open (All time).
 */
export function answersCreatedAtBounds(win: MetricWindow): {
  gte?: string;
  lt?: string;
  lte?: string;
} {
  if (win.kind === 'days') {
    const { dayFrom, dayTo } = win.days;
    return {
      ...(dayFrom ? { gte: `${dayFrom}T00:00:00.000Z` } : {}),
      ...(dayTo ? { lt: nextDay(dayTo) } : {}),
    };
  }
  return {
    ...(win.from ? { gte: win.from } : {}),
    ...(win.to ? { lte: win.to } : {}),
  };
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/**
 * Which answers a card counts: Visibility reads every answer; Mentions'
 * total comes from the answers that name the brand.
 */
export const mentionedOnly = (metric: BreakdownMetric) => metric === 'mentions';

/** One prompt_results row as the action reads it. */
export interface AnswerRow {
  id: string;
  prompt_id: string;
  platform: string;
  model_used: string | null;
  region: string | null;
  created_at: string;
  response: string | null;
  citations: unknown;
  mention_count: number | null;
  mention_position: number | null;
  citation_count: number | null;
  prompts?: { text?: string | null } | { text?: string | null }[] | null;
}

/** A row as the Answers tab shows it, its excerpt around the brand's first mention. */
export function mapAnswerRow(row: AnswerRow, brandTerms: string[]): InsightsAnswer {
  const response = row.response ?? '';
  const prompt = Array.isArray(row.prompts) ? row.prompts[0] : row.prompts;
  const status: AnswerStatus = !response.trim()
    ? 'noAnswer'
    : (row.mention_count ?? 0) > 0
      ? 'mentioned'
      : 'notMentioned';
  return {
    id: row.id,
    promptId: row.prompt_id,
    promptText: prompt?.text ?? '',
    platform: row.platform,
    model: row.model_used ?? null,
    region: row.region ?? null,
    createdAt: row.created_at,
    status,
    position: status === 'mentioned' ? (row.mention_position ?? null) : null,
    excerpt: status === 'noAnswer' ? '' : answerExcerpt(response, brandTerms),
    sources: Array.isArray(row.citations) ? row.citations.length : 0,
    ownSources: row.citation_count ?? 0,
  };
}

/** About 200 characters of the answer as prose, around the brand's name when it has one. */
export function answerExcerpt(response: string, brandTerms: string[]): string {
  const excerpt = mentionExcerpt(response, brandTerms);
  if (excerpt.length <= ANSWER_EXCERPT_CHARS + 2) return excerpt;
  // mentionExcerpt keeps ~110 characters each side of the name; trim the end.
  const end = excerpt.lastIndexOf(' ', ANSWER_EXCERPT_CHARS);
  return `${excerpt.slice(0, end > 0 ? end : ANSWER_EXCERPT_CHARS).trimEnd()}…`;
}
