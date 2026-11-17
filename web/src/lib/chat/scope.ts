import { ALL_MODELS, ALL_SCRAPERS } from '@/config/prompt-options';
import type { PlanLimits } from '@/config/plans';
import { platformFamily, platformName } from '@/lib/signals/names';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { oldestFirst } from './fit';
import type { DayWindow } from '@/lib/insights-windows';
import {
  WHY_PERIOD_FIELDS,
  readsRunDays,
  rollingWindow,
  runDaysWindow,
  whyPeriodsOf,
} from './page-periods';
import { AS_LISTED, pageFilterInputs, type PageScope } from './page-scope';
import { samePage } from './page-route';
import { FALLBACK_RANGE, rangeDaysBack, rangeWindow, type ChatRange } from './range';
import type { ChatTool } from './registry/define-tool';

/**
 * Chat's scope decisions, in one place (CHAT-04 items 2–4, Rule 1; CHAT-20
 * §7 "Platforms by plan"): which dates, platforms and how many rows a read
 * covers. The server sets them, not the model: a read with no dates gets the
 * person's date range (range.ts: one their message named, the page's in the
 * side panel, or their default), or the app's last 30 days, unless the
 * person asked for all time; the page's filters fill the inputs the model
 * left out (page-scope.ts); a plan that tracks some platforms reads only
 * those, and every list stops at its row limit and says it was cut
 * (`truncated`). The engine scopes each read here before it runs
 * (scopeRead) and cuts its rows after (capRows). Server only.
 */

/** A read with no dates and no range set covers the app's last this many days (CHAT-04 item 2). */
export const DEFAULT_RANGE_DAYS = 30;

/** No list a model reads is longer than this (CHAT-04 Rule 1: "at most ~50 rows"). */
export const ROW_CAP = 50;

/**
 * A trend's buckets: every day of a year by day, or years by week. A series
 * is one list the answer reads whole (the Overview's trend shows up to 90
 * days by day); its share of the run (run-limits.ts) cuts a longer one,
 * saying so (fit.ts).
 */
export const TREND_ROWS = 400;

/**
 * Rows per read, by tool: `default` when the model names none, `max` the
 * most it may ask for. A tool with a `limit` input reads `default` (or what
 * the model asked, up to `max`); one without has its lists cut to `default`
 * after it runs. Tools not named here: ROW_CAP. Every list read pages by
 * `offset` (pagedRead): ROW_CAP a page, with its total and the next page,
 * so none is named here for its length (the owner's rule, 2026-11-16).
 */
export const ROW_LIMITS: Readonly<Record<string, { default: number; max: number }>> = {
  get_prompt_insights: { default: 10, max: 24 },
  get_fanout_gaps: { default: 20, max: 49 },
  get_gsc_queries: { default: 25, max: 49 },
  list_ai_answers: { default: 5, max: 9 },
  // A page of all the brand's open actions, ranked on the server, with their total; the next by
  // its offset (registry/read-tools.ts): "most important" judges them all, not the first 10.
  list_action_center_tasks: { default: ROW_CAP, max: ROW_CAP },
  // What's new shows 3 updates at most (CHAT-11 item 10).
  get_whats_new: { default: 3, max: 3 },
  // Every day of the period, as the trend on the page (the owner's plan of 2026-11-16, item 7).
  get_visibility_trend: { default: TREND_ROWS, max: TREND_ROWS },
};

/**
 * Reads that count every row that matches and page by `offset` themselves:
 * their result says the total and the next page, so no extra row is read to
 * see if there are more.
 */
export const PAGED_READS: ReadonlySet<string> = new Set(['list_action_center_tasks']);

/**
 * Reads that can name the rows they return, by the input fields that name
 * them: the actions of the codes a person wrote (list_action_center_tasks'
 * codes, at most 10, each one or two actions), and the other lookups by
 * code, id, words, domain or address (registry/read-tools.ts, the owner's
 * plan of 2026-11-16, item 2). Every row named comes back, never cut by a
 * `limit` given beside it: a code that names two actions shows both (the
 * owner's report, 2026-11-16); words page by offset.
 */
export const NAMED_ROWS: Readonly<Record<string, readonly string[]>> = {
  list_action_center_tasks: ['codes'],
  list_signals: ['codes', 'ids'],
  list_prompts: ['ids', 'search'],
  get_prompt_performance: ['prompt_ids'],
  list_citations: ['domains', 'urls'],
  list_content_opportunities: ['ids', 'search'],
  list_drafts: ['ids', 'search'],
  get_reports: ['ids', 'search'],
};

/**
 * Whether a read's input names its rows (NAMED_ROWS): a list or words in one
 * of its fields. A search as listed (page-scope.ts AS_LISTED, the page's
 * search) names none: it reads the list, its page and limit as the list's.
 */
export function namesRows(toolName: string, input: Record<string, unknown>): boolean {
  const listed = input[AS_LISTED] === true;
  return (NAMED_ROWS[toolName] ?? []).some((field) => {
    if (field === 'search' && listed) return false;
    const value = input[field];
    return Array.isArray(value)
      ? value.length > 0
      : typeof value === 'string' && value.trim() !== '';
  });
}

/**
 * The days a `days` read covers when the model names none: Google's
 * reads keep their pages' 28 days, the fan-out light read its tab's 7;
 * anything else DEFAULT_RANGE_DAYS.
 */
export const DAYS_DEFAULTS: Readonly<Record<string, number>> = {
  get_gsc_summary: 28,
  get_gsc_queries: 28,
  get_ga_summary: 28,
  // The Query Fan-outs tab opens on its last 7 days.
  get_query_fanouts: 7,
};

/** The most days back a `days` read reaches, the Query Fan-out tab's 90 (prompt-options.ts). */
export const DAYS_MAX = 90;

// ─── All time ───────────────────────────────────────────────────────────────

const ALL_TIME = [
  /\ball[- ]time\b/i,
  /\bof all time\b/i,
  /\blifetime\b/i,
  /\bsince (?:we|i) (?:started|began|joined|signed up|launched)\b/i,
  /\bsince (?:the )?(?:start|beginning|launch|day one)\b/i,
  /\bfrom (?:the )?(?:start|beginning|day one)\b/i,
  /\bever since\b/i,
  /\b(?:whole|entire|full) history\b/i,
  /tüm zamanlar/i,
  /başından beri|baştan beri|en baştan/i,
  /başladığımız(?:dan)? beri|ilk günden beri/i,
  /şimdiye kadar|bugüne kadar/i,
  /(?:tüm|bütün) geçmiş/i,
];

/** The person asked for all of the data, not a recent window (CHAT-04 item 4). */
export function asksAllTime(question: string | null | undefined): boolean {
  return !!question && ALL_TIME.some((pattern) => pattern.test(question));
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** A date the model gave, as a timestamp; null when it isn't one. */
function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/** How a read's dates were chosen, for its step and its record. */
export type DateChoice = 'asked' | 'default' | 'all_time' | 'days' | 'none';

interface DatesUsed {
  dateFrom: string | null;
  dateTo: string | null;
  dates: DateChoice;
  days?: number;
  /** The range a read with no dates took (range.ts): the page's, the person's or the app's. */
  range?: ChatRange;
  /**
   * How its page cuts that range (page-periods.ts): `latest_run`, Last 24
   * hours as the latest completed tracking run's days (Overview, Citations);
   * `rolling`, the last N × 24 hours (Prompts, AI Traffic). Left out: whole
   * UTC days.
   */
  window?: 'latest_run' | 'rolling';
}

/** Whether a read's input gives its own period: dates, or days back. */
export function givesDates(input: Record<string, unknown>): boolean {
  const named = (value: unknown) => typeof value === 'string' && value.trim() !== '';
  return named(input.date_from) || named(input.date_to) || typeof input.days === 'number';
}

/** Whether a read covers a period: it takes dates or days back. */
export function takesDates(tool: Pick<ChatTool, 'inputSchema'>): boolean {
  return hasField(tool, 'date_from') || hasField(tool, 'date_to') || hasField(tool, 'days');
}

/**
 * A read's dates: the model's when it gave valid ones (a missing end is
 * today, a missing start the default window before the end, the end never
 * past today); none when the person asked for all time; else `range`'s
 * window, as the app's pages cut it (range.ts rangeWindow): the person's
 * range, or the app's last 30 days.
 */
export function resolveDates(
  from: unknown,
  to: unknown,
  allTime: boolean,
  now: Date,
  range: ChatRange = FALLBACK_RANGE,
): Pick<DatesUsed, 'dateFrom' | 'dateTo' | 'dates' | 'range'> & {
  values: Record<string, string>;
} {
  const today = now.getTime();
  let start = parseDate(from);
  let end = parseDate(to);
  if (start === null && end === null) {
    if (allTime) return { dateFrom: null, dateTo: null, dates: 'all_time', values: {} };
    const { dateFrom, dateTo } = rangeWindow(range, now);
    return {
      dateFrom,
      dateTo,
      dates: 'default',
      range,
      values: { date_from: dateFrom, date_to: dateTo },
    };
  }
  // The model's own strings where they stand, so a timestamp keeps its time.
  let fromText = start === null ? null : (from as string);
  let toText = end === null ? null : (to as string);
  if (start !== null && start > today) [start, fromText] = [today, dayOf(today)];
  if (end !== null && end > today) [end, toText] = [today, dayOf(today)];
  if (start !== null && end !== null && start > end) {
    [start, end] = [end, start];
    [fromText, toText] = [toText, fromText];
  }
  if (end === null) [end, toText] = [today, dayOf(today)];
  if (start === null && !allTime) fromText = dayOf(end - DEFAULT_RANGE_DAYS * DAY_MS);
  const values: Record<string, string> = { date_to: toText! };
  if (fromText) values.date_from = fromText;
  return { dateFrom: fromText, dateTo: toText, dates: 'asked', values };
}

// ─── Platforms ──────────────────────────────────────────────────────────────

/** The platforms a plan reads (CHAT-20 §7), as scraper ids and AI models; null for every one. */
export interface PlanPlatforms {
  /** The scraped apps it tracks ("chatgpt-web"). */
  scrapers: readonly string[];
  /** The API models it tracks ("claude-sonnet-5"). */
  models: readonly string[];
  /** Their engines ("openai", "copilot"): what a model slug or platform id is checked by. */
  families: ReadonlySet<string>;
  /** It keeps to some scraped apps, not all (Starter): a read with no platform is held to them. */
  someScrapers: boolean;
}

type PlatformLimits = Pick<PlanLimits, 'allowedScrapers' | 'allowedModels'>;

/** What the plan tracks; null when it tracks every platform and model (self-hosted). */
export function planPlatforms(limits: PlatformLimits | null | undefined): PlanPlatforms | null {
  if (!limits || (!limits.allowedScrapers && !limits.allowedModels)) return null;
  const scrapers = limits.allowedScrapers
    ? ALL_SCRAPERS.filter((s) => limits.allowedScrapers!.includes(s.id)).map((s) => s.id)
    : ALL_SCRAPERS.map((s) => s.id);
  const models = limits.allowedModels
    ? ALL_MODELS.filter((m) => limits.allowedModels!.includes(m.id)).map((m) => m.id)
    : ALL_MODELS.map((m) => m.id);
  const families = new Set<string>();
  for (const slug of [...scrapers, ...models]) {
    const family = platformFamily(slug);
    if (family) families.add(family);
  }
  return { scrapers, models, families, someScrapers: !!limits.allowedScrapers };
}

/** Whether the plan tracks a platform id or a model slug (by its engine). */
export function onPlan(plan: PlanPlatforms, slug: string): boolean {
  if (plan.scrapers.includes(slug) || plan.models.includes(slug)) return true;
  const family = platformFamily(slug);
  return family !== null && plan.families.has(family);
}

/** The plan's platforms by name, each once ("ChatGPT", "Microsoft Copilot"). */
export function planPlatformNames(plan: PlanPlatforms): string[] {
  return [...new Set([...plan.scrapers, ...plan.models].map(platformName))];
}

const slugsOf = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean)
    : [];

/**
 * The AI models a brand's answers name (prompt_results.model_used), which a
 * `model` filter matches: what holds a read to the plan's platforms. Null
 * when it can't be read: the read then fails rather than reading nothing.
 */
export async function brandModels(brandId: string): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin.rpc('insights_filter_options', {
    p_brand_id: brandId,
  });
  if (error) {
    console.error('[chat/scope] could not read the brand’s models:', error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { models?: unknown } | null;
  return Array.isArray(row?.models)
    ? row.models.filter((m): m is string => typeof m === 'string')
    : [];
}

// ─── A read's scope ─────────────────────────────────────────────────────────

/** The scope a read ran with, kept on its step (CHAT-04 item 4, `scope_json.used`). */
export interface ScopeUsed extends DatesUsed {
  /** The platforms the plan held it to (ids and models); null when it wasn't held. */
  platforms: string[] | null;
  /** The rows it asked for, or its lists were cut to. */
  rows: number;
  /** What the page set (page-scope.ts): `period`, and its filters' keys (`platform`, `sources`, `search`). */
  page?: string[];
  /** The page's search, as the read took it (page-scope.ts), when it took one. */
  pageSearch?: string;
}

/** A read the plan doesn't cover: the model says so, it doesn't run (CHAT-04 item 2). */
export interface NotOnPlan {
  code: 'not_on_plan';
  plan: string;
  /** What was asked for, by name. */
  asked: string[];
  /** What the plan tracks, by name. */
  on_plan: string[];
}

export interface ScopeFacts {
  /** The person's question: an all-time ask lifts the default window. */
  question: string | null | undefined;
  /**
   * The range a read with no dates covers (range.ts): one their message
   * named, the page's, or the person's default. Null or left out: none is
   * set, and the app's last 30 days are read (Google's reads keep their
   * pages' 28).
   */
  range?: ChatRange | null;
  /**
   * Where the range came from: a period the message named (or a short
   * range), the page the question was asked on (range.ts pageDatesOf), or
   * the person's default (picked on the card, or kept). Left out: default.
   */
  rangeFrom?: 'message' | 'page' | 'default';
  /** The page shows all time: a read with no dates covers all of it, as asked. */
  allTime?: boolean;
  /** The page's filters, for the reads that take them (page-scope.ts). */
  page?: PageScope | null;
  /** The plan's platform limits; null when they couldn't be read. */
  limits: PlatformLimits | null;
  planName: string;
  now?: Date;
  /** The brand's AI models (brandModels); a test's own. Null: they couldn't be read. */
  modelsOf?: (brandId: string) => Promise<readonly string[] | null>;
  /**
   * The UTC days of the brand's latest completed tracking run (the pages'
   * getTrackingWindow), for Overview's and Citations' Last 24 hours; null
   * before its first run, or when it can't be read: the rolling 24 hours.
   */
  runDaysOf?: (brandId: string) => Promise<DayWindow | null>;
}

export type ScopedRead =
  | {
      kind: 'read';
      input: Record<string, unknown>;
      used: ScopeUsed;
      /** The step's platform names when the plan picked them; else the input's. */
      platformNames: string[] | null;
      /** The rows its lists are cut to, and whether a longer list means "more, count unknown". */
      cap: RowCap;
    }
  | { kind: 'not_on_plan'; result: NotOnPlan }
  /** The plan's platforms couldn't be matched to the brand's rows: not read, never read as empty. */
  | { kind: 'failed' };

export interface RowCap {
  rows: number;
  /** A list of this length was read one past the cap to see if there were more. */
  probe: number | null;
}

function hasField(tool: Pick<ChatTool, 'inputSchema'>, field: string): boolean {
  return field in (tool.inputSchema.shape as Record<string, unknown>);
}

/**
 * A list read that pages by `offset` (lib/mcp/list-page.ts): it counts what
 * matches and says where the next page starts, so no extra row is read to
 * see if there are more, and a result cut for size stays a page (fit.ts).
 */
export function pagedRead(tool: Pick<ChatTool, 'name' | 'inputSchema'>): boolean {
  return PAGED_READS.has(tool.name) || hasField(tool, 'offset');
}

/** Whether the tool's input takes these values (its schema's own limits). */
const accepts = (tool: Pick<ChatTool, 'inputSchema'>, input: Record<string, unknown>) =>
  tool.inputSchema.safeParse(input).success;

/**
 * A read's input with the server's scope (CHAT-04 item 4): its dates, the
 * page's filters, its platforms and its rows. A platform the plan doesn't
 * track (the page's too) is refused (`not_on_plan`) rather than read empty
 * or read anyway.
 */
export async function scopeRead(
  tool: Pick<ChatTool, 'name' | 'inputSchema' | 'planGate'> & Partial<Pick<ChatTool, 'route'>>,
  raw: Record<string, unknown>,
  facts: ScopeFacts,
): Promise<ScopedRead> {
  const now = facts.now ?? new Date();
  const askedAllTime = asksAllTime(facts.question);
  const allTime = askedAllTime || facts.allTime === true;
  // The page's filters, where the read takes them and the model gave none (page-scope.ts).
  const fromPage = pageFilterInputs(tool, raw, facts.page ?? null, facts.question);
  const input = fromPage.input;

  // Platforms: what was asked must be on the plan; nothing asked, the plan's.
  const plan = planPlatforms(facts.limits);
  let platforms: string[] | null = null;
  let platformNames: string[] | null = null;
  if (plan) {
    for (const field of ['platform', 'model'] as const) {
      if (!hasField(tool, field)) continue;
      const asked = slugsOf(input[field]);
      if (asked.length === 0) continue;
      const kept = asked.filter((slug) => onPlan(plan, slug));
      if (kept.length === 0) {
        return {
          kind: 'not_on_plan',
          result: {
            code: 'not_on_plan',
            plan: facts.planName,
            asked: [...new Set(asked.map(platformName))],
            on_plan: planPlatformNames(plan),
          },
        };
      }
      if (kept.length < asked.length) input[field] = kept.join(',');
      platforms = kept;
    }
    // A read that names no platform, on a plan that tracks some: held to the plan's.
    if (!platforms && plan.someScrapers && tool.planGate?.platforms && hasField(tool, 'model')) {
      const seen =
        input.brand_id && facts.modelsOf ? await facts.modelsOf(String(input.brand_id)) : [];
      // Not read: holding to the plan's ids below would make the read come back empty.
      if (seen === null) return { kind: 'failed' };
      const own = seen.filter((slug) => onPlan(plan, slug));
      // None of theirs seen yet: the plan's own ids, which match its rows or none.
      platforms = own.length > 0 ? own : [...plan.scrapers, ...plan.models];
      input.model = platforms.join(',');
      platformNames = planPlatformNames(plan);
    }
  }

  // Dates.
  let dates: DatesUsed = { dateFrom: null, dateTo: null, dates: 'none' };
  if (hasField(tool, 'date_from') || hasField(tool, 'date_to')) {
    const resolved = resolveDates(
      input.date_from,
      input.date_to,
      allTime,
      now,
      facts.range ?? FALLBACK_RANGE,
    );
    delete input.date_from;
    delete input.date_to;
    // A range the app set, cut as the read's own page cuts it (page-periods.ts).
    const pageWindow = resolved.range
      ? await ownPageWindow(tool, resolved.range, input, facts, now)
      : null;
    const values = pageWindow
      ? { date_from: pageWindow.dateFrom, date_to: pageWindow.dateTo }
      : resolved.values;
    for (const [key, value] of Object.entries(values)) {
      if (hasField(tool, key)) input[key] = value;
    }
    dates = {
      dateFrom: pageWindow?.dateFrom ?? resolved.dateFrom,
      dateTo: pageWindow?.dateTo ?? resolved.dateTo,
      dates: resolved.dates,
      ...(resolved.range ? { range: resolved.range } : {}),
      ...(pageWindow ? { window: pageWindow.window } : {}),
    };
  } else if (hasField(tool, 'days')) {
    const asked = typeof input.days === 'number' ? input.days : null;
    // The person's range in days back; none set, the page's own default for the read.
    const range = asked === null && !allTime ? (facts.range ?? null) : null;
    const days =
      asked ??
      (allTime
        ? DAYS_MAX
        : range
          ? rangeDaysBack(range, now, DAYS_MAX)
          : (DAYS_DEFAULTS[tool.name] ?? DEFAULT_RANGE_DAYS));
    const fits = accepts(tool, { ...input, days }) ? days : DEFAULT_RANGE_DAYS;
    input.days = fits;
    dates = {
      dateFrom: dayOf(now.getTime() - fits * DAY_MS),
      dateTo: dayOf(now.getTime()),
      dates: asked === null && allTime ? 'all_time' : 'days',
      days: fits,
      ...(range && fits === days ? { range } : {}),
    };
  } else if (hasField(tool, 'period_b_from')) {
    // The Why read compares the run's period with as many days before (page-periods.ts),
    // unless the model named periods or a day; too short a period keeps its own 7 against 7.
    const named = WHY_PERIOD_FIELDS.some((field) => input[field] !== undefined);
    const periods = !named && facts.range && !allTime ? whyPeriodsOf(facts.range, now) : null;
    if (periods && accepts(tool, { ...input, ...periods })) {
      Object.assign(input, periods);
      dates = {
        dateFrom: periods.period_b_from,
        dateTo: periods.period_b_to,
        dates: 'default',
        range: facts.range!,
      };
    }
  } else if (hasField(tool, 'period') && input.period === undefined && facts.range && !allTime) {
    // A read of a named period (Ads' 7d, 30d, 90d) takes one the message named, or its own
    // page's; never the person's default nor another page's range: else its own default, as
    // its page opens on (the owner, 2026-11-16).
    const ownPage = samePage(tool.route, facts.page?.route);
    const named = facts.rangeFrom === 'message' || (facts.rangeFrom === 'page' && ownPage);
    if (named && accepts(tool, { ...input, period: facts.range })) {
      input.period = facts.range;
      const window = rangeWindow(facts.range, now);
      dates = { ...window, dates: 'default', range: facts.range };
    }
  }
  // The page's period: a read that took the range, or all time, the page set.
  const pagePeriod =
    facts.rangeFrom === 'page' &&
    !askedAllTime &&
    (dates.range !== undefined || dates.dates === 'all_time');
  const page = [...(pagePeriod ? ['period'] : []), ...fromPage.applied];

  // Rows: the model's count, held to the tool's max; one more read to see if there are more,
  // unless the read counts them itself.
  const limits = ROW_LIMITS[tool.name];
  let cap: RowCap = { rows: limits?.default ?? ROW_CAP, probe: null };
  if (namesRows(tool.name, input)) {
    delete input.limit;
    cap = { rows: ROW_CAP, probe: null };
  } else if (hasField(tool, 'limit')) {
    const max = limits?.max ?? ROW_CAP;
    const asked = typeof input.limit === 'number' ? input.limit : null;
    const rows = Math.max(1, Math.min(asked ?? limits?.default ?? ROW_CAP, max));
    const probe = rows + 1;
    const probes = !pagedRead(tool) && accepts(tool, { ...input, limit: probe });
    input.limit = probes ? probe : rows;
    cap = { rows, probe: probes ? probe : null };
  }

  return {
    kind: 'read',
    input,
    used: {
      ...dates,
      platforms,
      rows: cap.rows,
      ...(page.length > 0 ? { page } : {}),
      ...(fromPage.applied.includes('search') ? { pageSearch: String(input.search) } : {}),
    },
    platformNames,
    cap,
  };
}

/**
 * The window a range covers on the read's own page, when that page cuts it
 * its own way (page-periods.ts): Overview's and Citations' Last 24 hours,
 * the latest completed run's days (the rolling 24 hours before a first run,
 * or when they can't be read); Prompts' and AI Traffic's presets, the last
 * N × 24 hours.
 * Null: whole UTC days, as rangeWindow cuts them.
 */
async function ownPageWindow(
  tool: Partial<Pick<ChatTool, 'route'>>,
  range: ChatRange,
  input: Record<string, unknown>,
  facts: ScopeFacts,
  now: Date,
): Promise<{ dateFrom: string; dateTo: string; window: 'latest_run' | 'rolling' } | null> {
  if (range === '24h' && readsRunDays(tool.route) && facts.runDaysOf) {
    const brandId = typeof input.brand_id === 'string' ? input.brand_id : null;
    const days = brandId ? await facts.runDaysOf(brandId).catch(() => null) : null;
    const window = runDaysWindow(days);
    return window ? { ...window, window: 'latest_run' } : null;
  }
  const rolling = rollingWindow(tool.route, range, now);
  return rolling ? { ...rolling, window: 'rolling' } : null;
}

// ─── Rows ───────────────────────────────────────────────────────────────────

/** Cuts one list; how many it left out, null when a probe says "more" without a count. */
function cutList(list: Json[], cap: RowCap): { items: Json[]; more: number | null } | null {
  if (list.length <= cap.rows) return null;
  const more = cap.probe !== null && list.length === cap.probe ? null : list.length - cap.rows;
  const items = oldestFirst(list) ? list.slice(-cap.rows) : list.slice(0, cap.rows);
  return { items, more };
}

/**
 * A read's output with every list cut to its row limit (CHAT-04 item 6):
 * the first rows (a series oldest first: its latest), `{list}_more` (how
 * many were left out; null when there
 * were more but their count isn't known) and `truncated: true`. Lists one
 * level down (a `totals` or `data` object's) are cut too; lists inside rows
 * stay as they are.
 */
export function capRows(value: Json, cap: RowCap): { value: Json; cut: boolean } {
  if (Array.isArray(value)) {
    const cut = cutList(value, cap);
    return cut
      ? { value: { items: cut.items, more: cut.more, truncated: true }, cut: true }
      : { value, cut: false };
  }
  if (!value || typeof value !== 'object') return { value, cut: false };
  let cut = false;
  const capObject = (record: Record<string, Json>, depth: number): Record<string, Json> => {
    const out: Record<string, Json> = { ...record };
    for (const [key, field] of Object.entries(record)) {
      if (Array.isArray(field)) {
        const list = cutList(field, cap);
        if (!list) continue;
        out[key] = list.items;
        out[`${key}_more`] = list.more;
        cut = true;
      } else if (depth === 0 && field && typeof field === 'object') {
        out[key] = capObject(field as Record<string, Json>, depth + 1);
      }
    }
    return out;
  };
  const capped = capObject(value as Record<string, Json>, 0);
  if (cut) capped.truncated = true;
  return { value: cut ? capped : value, cut };
}
