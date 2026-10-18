'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { TRAFFIC_PAGE_SIZE, countTrafficLogs, scanTrafficLogs } from '@/lib/traffic-scan';
import { expandDateToEndOfDay, utcDay } from '@/lib/dates';
import { isHourlyWindow, listUtcHours, utcHourKey } from '@/lib/traffic-buckets';
import { getSuggestionSourceStates, type SourceState } from '@/lib/actions/integrations';

export interface TrafficDateWindow {
  dateFrom?: string;
  dateTo?: string;
}

export interface TrafficLog {
  id: string;
  brandId: string;
  url: string;
  referrer: string | null;
  sourcePlatform: string | null;
  country: string | null;
  language: string | null;
  screen: string | null;
  createdAt: string;
  /** Pageviews in this visit: 1, plus each reload or further link (AT-003). */
  pageviews: number;
}

/**
 * Every count here is of visits, one per session (AT-003): a row whose
 * `visit_of` is null starts a visit, and the rows pointing at it are its
 * further pageviews. Pageviews are counted on their own.
 */
export interface TrafficSummary {
  totalVisits: number;
  totalVisitsPrev: number;
  /**
   * The snippet's pageviews in the window, the visits' first ones included.
   * Google Analytics reports none, so on days it filled (AT-004) there are
   * visits without pageviews.
   */
  totalPageviews: number;
  /** The UTC days in the window whose visits came from Google Analytics (AT-004). */
  analyticsDays: string[];
  /** False for all time, which has no previous period to compare with. */
  hasPreviousPeriod: boolean;
  platformBreakdown: {
    platform: string;
    visits: number;
    visitsPrev: number;
    /** Google Analytics' engagement for the platform over the range's days; null without any (AT-005). */
    analytics: TrafficEngagement | null;
  }[];
  topPages: {
    url: string;
    visits: number;
    visitsPrev: number;
    /** Times tracked AI answers cited the page in the range (AT-006). */
    citations: number;
  }[];
  hasAnyData: boolean;
}

export interface TrafficTrendPoint {
  /** The bucket: a UTC day ("2026-10-17"), or an hour ("2026-10-17T13:00:00.000Z") in a 24-hour window. */
  date: string;
  [platform: string]: string | number;
}

/** What feeds the page, for the data sources strip (AT-001). */
export interface TrafficSources {
  /** The snippet's newest visit, or null when it has never sent one. */
  snippetLastVisitAt: string | null;
  ga: SourceState;
  gsc: SourceState;
}

/**
 * The tracking snippet, Google Analytics and Google Search Console as the
 * strip shows them, in one call: the snippet's last visit beside each
 * Google source's connection, the brand's property and its last sync.
 */
export async function getTrafficSources(brandId: string): Promise<TrafficSources> {
  const supabase = await createClient();
  const [states, lastVisit] = await Promise.all([
    getSuggestionSourceStates(brandId),
    supabase
      .from('ai_traffic_logs')
      .select('created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (lastVisit.error) throw new Error(lastVisit.error.message);
  return {
    snippetLastVisitAt: (lastVisit.data?.created_at as string | undefined) ?? null,
    ga: states.ga,
    gsc: states.gsc,
  };
}

function mapLogRow(row: Record<string, unknown>): TrafficLog {
  return {
    id: row.id as string,
    brandId: row.brand_id as string,
    url: row.url as string,
    referrer: row.referrer as string | null,
    sourcePlatform: row.source_platform as string | null,
    country: row.country as string | null,
    language: row.language as string | null,
    screen: row.screen as string | null,
    createdAt: row.created_at as string,
    pageviews: 1,
  };
}

/** Window of equal length immediately before [from, to]. */
function previousWindow(from: string, to: string): { from: string; to: string } {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  return { from: new Date(fromMs - (toMs - fromMs)).toISOString(), to: from };
}

function resolveTrafficWindow(window?: TrafficDateWindow): {
  from?: string;
  to?: string;
  prevFrom?: string;
  prevTo?: string;
} {
  if (!window?.dateFrom && !window?.dateTo) {
    return {};
  }

  const from = window.dateFrom;
  const to = expandDateToEndOfDay(window.dateTo) ?? new Date().toISOString();

  if (!from) {
    return { to };
  }

  const prev = previousWindow(from, to);
  return { from, to, prevFrom: prev.from, prevTo: prev.to };
}

/** Cap daily trend buckets so an "all time" scan stays chart-friendly. */
const TRAFFIC_TREND_MAX_DAYS = 365;

function listUtcDays(from: string, to: string): string[] {
  const days: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cursor <= endDay) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

/**
 * AI-referred visits in a window from the snippet and Google Analytics, day
 * by day (AT-004, spec §5.2; 00176): a UTC day with a snippet visit is the
 * snippet's, any other whole day in the window is Analytics'. Never summed.
 */
interface MergedTraffic {
  visits: number;
  pageviews: number;
  analyticsDays: string[];
  platforms: { platform: string; visits: number }[];
  pages: { page: string; visits: number }[];
  days: { day: string; platform: string; visits: number }[];
}

async function readMergedTraffic(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  window: { from?: string; to?: string; toInclusive?: boolean },
): Promise<MergedTraffic> {
  // The 24-hour range trends hour by hour, which Analytics can't fill: it
  // reads the snippet alone (AT-004).
  const hourly = Boolean(window.from && window.to && isHourlyWindow(window.from, window.to));
  const { data, error } = await supabase.rpc('ai_traffic_merged', {
    p_brand_id: brandId,
    p_from: window.from ?? null,
    p_to: window.to ?? null,
    p_to_inclusive: window.toInclusive ?? true,
    p_analytics: !hourly,
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as {
    visits?: number;
    pageviews?: number;
    analytics_days?: string[];
    platforms?: { platform: string; visits: number }[];
    pages?: { page: string; visits: number }[];
    days?: { day: string; platform: string; visits: number }[];
  };
  return {
    visits: Number(raw.visits) || 0,
    pageviews: Number(raw.pageviews) || 0,
    analyticsDays: raw.analytics_days ?? [],
    platforms: (raw.platforms ?? []).map((p) => ({ ...p, visits: Number(p.visits) || 0 })),
    pages: (raw.pages ?? []).map((p) => ({ ...p, visits: Number(p.visits) || 0 })),
    days: (raw.days ?? []).map((d) => ({ ...d, visits: Number(d.visits) || 0 })),
  };
}

export async function getTrafficSummary(
  brandId: string,
  window?: TrafficDateWindow,
  /** The page shows the top 10 landing pages; an export takes them all. */
  opts?: { topPages?: number },
): Promise<TrafficSummary> {
  const supabase = await createClient();
  const { from, to, prevFrom, prevTo } = resolveTrafficWindow(window);
  const hasPrev = Boolean(prevFrom && prevTo);

  // Visits, platforms and pages from the snippet and Google Analytics, day
  // by day (AT-004), summed in the database: no row cap applies.
  const [current, previous, lifetime, value, cited] = await Promise.all([
    readMergedTraffic(supabase, brandId, { from, to, toInclusive: true }),
    hasPrev
      ? readMergedTraffic(supabase, brandId, { from: prevFrom, to: prevTo, toInclusive: false })
      : null,
    // Whether the brand has any AI traffic at all, from either origin.
    from || to
      ? Promise.all([
          countTrafficLogs(supabase, brandId, {}),
          supabase
            .from('ga_ai_traffic_stats')
            .select('id')
            .eq('brand_id', brandId)
            .gt('sessions', 0)
            .limit(1),
        ])
      : null,
    // What each platform's visitors did, from Analytics over the range's
    // days (AT-005): engagement and key events are rates of its sessions,
    // so they read Analytics alone, whichever origin counted the visits.
    supabase.rpc('ga_platform_value', {
      p_brand_id: brandId,
      p_since: utcDay(from) ?? null,
      p_until: utcDay(to) ?? new Date().toISOString().slice(0, 10),
    }),
    // How often tracked answers cite each page, for Top Landing Pages (AT-006).
    supabase.rpc('ai_traffic_page_citations', {
      p_brand_id: brandId,
      p_since: utcDay(from) ?? null,
      p_until: utcDay(to) ?? null,
    }),
  ]);
  if (cited.error) throw new Error(cited.error.message);
  const citationsByPage = new Map(
    (cited.data ?? []).map((row) => [row.page_key, Number(row.citations) || 0]),
  );
  if (lifetime?.[1].error) throw new Error(lifetime[1].error.message);
  if (value.error) throw new Error(value.error.message);
  const valueByPlatform = new Map(
    (value.data ?? []).map((row) => [
      row.platform,
      {
        sessions: Number(row.sessions) || 0,
        engagedSessions: Number(row.engaged_sessions) || 0,
        keyEvents: Number(row.key_events) || 0,
        keyEventSessions: Number(row.key_event_sessions) || 0,
      },
    ]),
  );
  const hasAnyData = lifetime
    ? lifetime[0] > 0 || (lifetime[1].data ?? []).length > 0
    : current.visits > 0;

  const previousByPlatform = new Map(previous?.platforms.map((p) => [p.platform, p.visits]));
  const previousByPage = new Map(previous?.pages.map((p) => [p.page, p.visits]));

  return {
    totalVisits: current.visits,
    totalVisitsPrev: previous?.visits ?? 0,
    totalPageviews: current.pageviews,
    analyticsDays: current.analyticsDays,
    hasPreviousPeriod: hasPrev,
    platformBreakdown: current.platforms
      .filter((p) => p.visits > 0)
      .map((p) => ({
        ...p,
        visitsPrev: previousByPlatform.get(p.platform) ?? 0,
        analytics: valueByPlatform.get(p.platform) ?? null,
      })),
    topPages: current.pages.slice(0, opts?.topPages ?? 10).map((p) => ({
      url: p.page,
      visits: p.visits,
      visitsPrev: previousByPage.get(p.page) ?? 0,
      citations: citationsByPage.get(p.page.toLowerCase()) ?? 0,
    })),
    hasAnyData,
  };
}

export async function getTrafficTrend(
  brandId: string,
  window?: TrafficDateWindow,
): Promise<TrafficTrendPoint[]> {
  const supabase = await createClient();
  const { from, to } = resolveTrafficWindow(window);
  // A day or less reads hour by hour (AT-017); longer windows by day.
  const hourly = Boolean(from && to && isHourlyWindow(from, to));

  // Group by day (or hour) + platform.
  const dayMap = new Map<string, Map<string, number>>();
  const allPlatforms = new Set<string>();
  const add = (day: string, platform: string, visits: number) => {
    allPlatforms.add(platform);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    const dm = dayMap.get(day)!;
    dm.set(platform, (dm.get(platform) ?? 0) + visits);
  };

  if (hourly) {
    // The snippet alone: Analytics has no hours (AT-004).
    await scanTrafficLogs(
      supabase,
      brandId,
      { columns: 'source_platform, created_at, id', from, to, toInclusive: true },
      (r) => add(utcHourKey(r.created_at as string), (r.source_platform as string) || 'unknown', 1),
    );
  } else {
    // Day by day from the snippet or Google Analytics (AT-004).
    const merged = await readMergedTraffic(supabase, brandId, { from, to, toInclusive: true });
    for (const d of merged.days) add(d.day, d.platform, d.visits);
  }

  let days: string[];
  if (from && to) {
    days = hourly ? listUtcHours(from, to) : listUtcDays(from, to);
  } else {
    days = [...dayMap.keys()].sort();
    if (days.length > TRAFFIC_TREND_MAX_DAYS) {
      days = days.slice(-TRAFFIC_TREND_MAX_DAYS);
    }
    if (days.length === 0) days = [new Date().toISOString().slice(0, 10)];
  }

  return days.map((day) => {
    const dm = dayMap.get(day);
    const point: TrafficTrendPoint = { date: day };
    for (const p of allPlatforms) {
      point[p] = dm?.get(p) ?? 0;
    }
    return point;
  });
}

/**
 * The visit list's filters over ai_traffic_logs: platform, a URL search and
 * the window. Shared by the list and its export, so the file holds the rows
 * the list shows.
 */
function visitListQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  filters: { platform?: string; search?: string; from?: string; to?: string },
  columns: string,
  head: boolean,
) {
  let query = supabase
    .from('ai_traffic_logs')
    .select(columns, { count: 'exact', head })
    .eq('brand_id', brandId);
  if (filters.platform) query = query.eq('source_platform', filters.platform);
  if (filters.search) {
    // Escape \, % and _ for ILIKE to treat them as literals, not wildcards
    const escaped = filters.search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    query = query.ilike('url', `%${escaped}%`);
  }
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lte('created_at', filters.to);
  return query;
}

/**
 * The window's visits, newest first, one row per visit with its pageviews
 * (AT-003). `total` counts the visits that match; `pageviews` counts every
 * pageview that does, so the list can say "4 visits (7 pageviews)".
 */
export async function getTrafficLogs(
  brandId: string,
  opts?: {
    limit?: number;
    offset?: number;
    platform?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<{ logs: TrafficLog[]; total: number; pageviews: number }> {
  const supabase = await createClient();
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;
  const platform = opts?.platform;
  const search = opts?.search;
  const { from, to } = resolveTrafficWindow({
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
  });

  // One set of filters for the visits and for the pageview count.
  const filters = { platform, search, from, to };
  const matching = (columns: string, head: boolean) =>
    visitListQuery(supabase, brandId, filters, columns, head);

  const [visits, pageviews] = await Promise.all([
    matching('*', false)
      .is('visit_of', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    matching('id', true),
  ]);
  if (visits.error) throw new Error(visits.error.message);
  if (pageviews.error) throw new Error(pageviews.error.message);

  const logs = ((visits.data ?? []) as unknown as Record<string, unknown>[]).map(mapLogRow);

  // Each listed visit's further pageviews, counted from the rows pointing
  // at it. The repeats of one page of visits are few, so one read does it.
  if (logs.length > 0) {
    const { data: repeats, error } = await supabase
      .from('ai_traffic_logs')
      .select('visit_of')
      .in(
        'visit_of',
        logs.map((log) => log.id),
      );
    if (error) throw new Error(error.message);
    const extra = new Map<string, number>();
    for (const row of repeats ?? []) {
      const id = row.visit_of as string;
      extra.set(id, (extra.get(id) ?? 0) + 1);
    }
    for (const log of logs) log.pageviews += extra.get(log.id) ?? 0;
  }

  return { logs, total: visits.count ?? 0, pageviews: pageviews.count ?? 0 };
}

/**
 * Every visit the list would show, for an export (AT-015): the list's
 * filters, all of its pages, each visit with its pageviews. Null when there
 * are more than `max`, which the export refuses rather than build slowly.
 *
 * The pageviews come from one scan of the window's repeat rows rather than
 * an id list per page of visits: a thousand ids don't fit in a request URL.
 * A visit's repeats follow it, so the scan starts with the window and has
 * no end, as the list counts them.
 */
export async function getTrafficVisitsForExport(
  brandId: string,
  opts: { platform?: string; search?: string; dateFrom?: string; dateTo?: string; max: number },
): Promise<TrafficLog[] | null> {
  const supabase = await createClient();
  const { from, to } = resolveTrafficWindow({ dateFrom: opts.dateFrom, dateTo: opts.dateTo });
  const filters = { platform: opts.platform, search: opts.search, from, to };

  const counted = await visitListQuery(supabase, brandId, filters, 'id', true).is('visit_of', null);
  if (counted.error) throw new Error(counted.error.message);
  const total = counted.count ?? 0;
  if (total > opts.max) return null;

  const visits: TrafficLog[] = [];
  for (let start = 0; start < total; start += TRAFFIC_PAGE_SIZE) {
    const { data, error } = await visitListQuery(supabase, brandId, filters, '*', false)
      .is('visit_of', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + TRAFFIC_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    visits.push(...batch.map(mapLogRow));
    if (batch.length < TRAFFIC_PAGE_SIZE) break;
  }
  if (visits.length === 0) return visits;

  const extra = new Map<string, number>();
  for (let start = 0; ; start += TRAFFIC_PAGE_SIZE) {
    let query = supabase
      .from('ai_traffic_logs')
      .select('id, visit_of')
      .eq('brand_id', brandId)
      .not('visit_of', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + TRAFFIC_PAGE_SIZE - 1);
    if (from) query = query.gte('created_at', from);
    if (opts.platform) query = query.eq('source_platform', opts.platform);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = row.visit_of as string;
      extra.set(id, (extra.get(id) ?? 0) + 1);
    }
    if ((data ?? []).length < TRAFFIC_PAGE_SIZE) break;
  }
  for (const visit of visits) visit.pageviews += extra.get(visit.id) ?? 0;
  return visits;
}

/**
 * The Pages section (AT-006, spec §3.5; 00178): the brand's pages in the
 * page's range with their AI visits (the snippet or Analytics, day by day),
 * how often tracked answers cite them, the prompts pointing to them and
 * their traffic from every channel, sorted into three work lists.
 */
export type TrafficPagesTab = 'noAiTraffic' | 'citedNotClicked' | 'trafficNoPrompt' | 'all';

const TAB_PARAM: Record<TrafficPagesTab, string> = {
  noAiTraffic: 'no_ai_traffic',
  citedNotClicked: 'cited_not_clicked',
  trafficNoPrompt: 'traffic_no_prompt',
  all: 'all',
};

export interface TrafficPageRow {
  /** The path, as normalize_page_path writes it. */
  page: string;
  aiVisits: number;
  /** Key events in AI sessions, from Analytics. */
  aiKeyEvents: number;
  /** The assistants that sent the most visits, most first (up to three). */
  aiPlatforms: string[];
  /** Times tracked AI answers cited the page in the range. */
  citations: number;
  /** Active prompts with the page as a target URL. */
  targetingPrompts: number;
  /** Every channel's traffic, from Analytics. */
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  transactions: number;
  revenue: number;
  engagementSeconds: number;
  inSitemap: boolean;
  /** The page's place on the site by value, among pages with traffic. */
  valueRank: number | null;
}

export interface TrafficPages {
  counts: Record<TrafficPagesTab, number>;
  rows: TrafficPageRow[];
}

export async function getTrafficPages(
  brandId: string,
  window: TrafficDateWindow | undefined,
  opts: { tab: TrafficPagesTab; limit?: number; offset?: number },
): Promise<TrafficPages> {
  const supabase = await createClient();
  const { from, to } = resolveTrafficWindow(window);
  const { data, error } = await supabase.rpc('ai_traffic_pages', {
    p_brand_id: brandId,
    p_from: from ?? null,
    p_to: to ?? null,
    p_tab: TAB_PARAM[opts.tab],
    p_limit: opts.limit ?? 10,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as { counts?: Record<string, number>; rows?: Record<string, unknown>[] };
  const counts = raw.counts ?? {};
  return {
    counts: {
      noAiTraffic: Number(counts.no_ai_traffic) || 0,
      citedNotClicked: Number(counts.cited_not_clicked) || 0,
      trafficNoPrompt: Number(counts.traffic_no_prompt) || 0,
      all: Number(counts.all) || 0,
    },
    rows: (raw.rows ?? []).map((row) => ({
      page: row.page as string,
      aiVisits: Number(row.ai_visits) || 0,
      aiKeyEvents: Number(row.ai_key_events) || 0,
      aiPlatforms: (row.ai_platforms as string[] | null) ?? [],
      citations: Number(row.citations) || 0,
      targetingPrompts: Number(row.targeting_prompts) || 0,
      sessions: Number(row.sessions) || 0,
      engagedSessions: Number(row.engaged_sessions) || 0,
      keyEvents: Number(row.key_events) || 0,
      transactions: Number(row.transactions) || 0,
      revenue: Number(row.revenue) || 0,
      engagementSeconds: Number(row.engagement_seconds) || 0,
      inSitemap: Boolean(row.in_sitemap),
      valueRank:
        row.value_rank === null || row.value_rank === undefined ? null : Number(row.value_rank),
    })),
  };
}

/** A list a page can be sent to the Action Center from (AT-006). */
export type TrafficPagesReason = 'cited_not_clicked' | 'no_ai_traffic';

/**
 * "Send to Action Center" on the Pages section (AT-006): pages from the
 * Cited, not clicked or No AI traffic list as one action. The server reads
 * the list again over the same range and keeps the pages still on it; the
 * same pages sent again return the open action.
 */
export async function sendTrafficPagesToActionCenter(
  brandId: string,
  window: TrafficDateWindow | undefined,
  pages: string[],
  reason: TrafficPagesReason,
): Promise<{ actionId: string; actionNo: number; created: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const { from, to } = resolveTrafficWindow(window);
  const res = await fetch(`${API_BASE_URL}/api/action-center/pages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, pages, reason, from, to }),
  });

  // Returned, not thrown: a thrown error's message is masked in production.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.details || body.error || `Server error: ${res.status}` };
  }
  return res.json();
}

/** A prompt suggested for one page (AT-006 part B2). */
export interface PagePromptSuggestion {
  text: string;
  topic: string;
  reason: string;
  /** The Search Console query it came from, when it did. */
  sourceQuery: string | null;
  impressions: number | null;
}

export interface PagePromptSuggestions {
  page: { path: string; title: string | null };
  /** Search Console queries that shared the page's words. */
  queries: number;
  suggestions: PagePromptSuggestion[];
}

/**
 * "Add prompts" on the Pages section (AT-006 part B2): prompts whose best
 * answer is this page, written from what the page says, its figures over the
 * page's range and the brand's Search Console queries that share its words.
 * Nothing is stored until the person tracks some.
 */
export async function suggestPagePrompts(
  brandId: string,
  window: TrafficDateWindow | undefined,
  page: string,
): Promise<PagePromptSuggestions | { error: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const { from, to } = resolveTrafficWindow(window);
  const res = await fetch(
    `${API_BASE_URL}/api/prompts/suggestions/${encodeURIComponent(brandId)}/page`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ page, from, to }),
    },
  );

  // Returned, not thrown: a thrown error's message is masked in production.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.message || body.error || `Server error: ${res.status}` };
  }
  return res.json();
}

/** Analytics' engagement figures for one group of sessions (AT-005). */
export interface TrafficEngagement {
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  /** Sessions with at least one key event: the key event rate is this over sessions. */
  keyEventSessions: number;
}

/**
 * The Google side of the AI Traffic KPI cards (AT-017, spec §3.2): from
 * Analytics, all sessions and the AI channel's sessions, engaged sessions
 * and key events; from Search Console, clicks against the period before.
 * Each is asked for only when its source has data for the brand.
 */

export interface TrafficGoogleTotals {
  ga: {
    sessions: number;
    aiSessions: number;
    aiEngagedSessions: number;
    aiKeyEvents: number;
    aiKeyEventSessions: number;
    /** AI sessions' purchase revenue, in the property's currency; 0 without e-commerce. */
    aiRevenue: number;
    /** Google organic (the Organic Search channel), the page's comparison (AT-005). */
    organic: TrafficEngagement;
  } | null;
  gsc: {
    /** The days the clicks cover; no first day for all time. */
    since: string | null;
    until: string;
    clicks: number;
    /** The same-length period before; null for all time. */
    prevClicks: number | null;
  } | null;
}

export async function getTrafficGoogleTotals(
  brandId: string,
  window: TrafficDateWindow,
  opts: {
    ga: boolean;
    gsc: boolean;
    /**
     * Short ranges read Search Console's latest reported day(s) — 1 for the
     * 24-hour range, 7 for the week — because Google reports about two days
     * late (spec §3.01). Null reads the range as it is.
     */
    gscLatestDays: number | null;
  },
): Promise<TrafficGoogleTotals> {
  const supabase = await createClient();
  // Both sources store whole days, so the range goes as its first and last.
  const since = utcDay(window.dateFrom) ?? null;
  const until = utcDay(window.dateTo) ?? new Date().toISOString().slice(0, 10);
  const shift = (day: string, days: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  const [ga, gsc] = await Promise.all([
    opts.ga
      ? supabase
          .rpc('ga_traffic_totals', { p_brand_id: brandId, p_since: since, p_until: until })
          .single()
      : null,
    opts.gsc
      ? supabase
          .rpc('gsc_click_totals', {
            p_brand_id: brandId,
            p_since: opts.gscLatestDays ? shift(until, 1 - opts.gscLatestDays) : since,
            p_until: until,
            p_latest: Boolean(opts.gscLatestDays),
          })
          .single()
      : null,
  ]);
  if (ga?.error) throw new Error(ga.error.message);
  if (gsc?.error) throw new Error(gsc.error.message);

  const gaRow = ga?.data;
  const gscRow = gsc?.data;
  return {
    ga: gaRow
      ? {
          sessions: Number(gaRow.sessions) || 0,
          aiSessions: Number(gaRow.ai_sessions) || 0,
          aiEngagedSessions: Number(gaRow.ai_engaged_sessions) || 0,
          aiKeyEvents: Number(gaRow.ai_key_events) || 0,
          aiKeyEventSessions: Number(gaRow.ai_key_event_sessions) || 0,
          aiRevenue: Number(gaRow.ai_revenue) || 0,
          organic: {
            sessions: Number(gaRow.organic_sessions) || 0,
            engagedSessions: Number(gaRow.organic_engaged_sessions) || 0,
            keyEvents: Number(gaRow.organic_key_events) || 0,
            keyEventSessions: Number(gaRow.organic_key_event_sessions) || 0,
          },
        }
      : null,
    gsc: gscRow
      ? {
          since: gscRow.since,
          until: gscRow.until ?? until,
          clicks: Number(gscRow.clicks) || 0,
          prevClicks: gscRow.prev_clicks === null ? null : Number(gscRow.prev_clicks) || 0,
        }
      : null,
  };
}
