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
  /** Every pageview in the window, the visits' first ones included. */
  totalPageviews: number;
  /** False for all time, which has no previous period to compare with. */
  hasPreviousPeriod: boolean;
  platformBreakdown: { platform: string; visits: number; visitsPrev: number }[];
  topPages: { url: string; visits: number; visitsPrev: number }[];
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

export async function getTrafficSummary(
  brandId: string,
  window?: TrafficDateWindow,
  /** The page shows the top 10 landing pages; an export takes them all. */
  opts?: { topPages?: number },
): Promise<TrafficSummary> {
  const supabase = await createClient();
  const { from, to, prevFrom, prevTo } = resolveTrafficWindow(window);

  // Exact totals — count queries transfer no rows and are immune to the cap.
  const countRows = (
    fromTs?: string,
    toTs?: string,
    toInclusive = false,
    opts?: { visits?: boolean },
  ) => countTrafficLogs(supabase, brandId, { from: fromTs, to: toTs, toInclusive }, opts);

  // Platform breakdown + top pages, aggregated per batch.
  const platformMap = new Map<string, number>();
  const platformMapPrev = new Map<string, number>();
  const pageMap = new Map<string, number>();
  const pageMapPrev = new Map<string, number>();

  const aggregate = (platforms: Map<string, number>, pages: Map<string, number>) => {
    return (r: Record<string, unknown>) => {
      const p = (r.source_platform as string) || 'unknown';
      platforms.set(p, (platforms.get(p) ?? 0) + 1);

      const url = r.url as string;
      let key = url;
      try {
        key = new URL(url).pathname;
      } catch {
        // Not a parseable URL — bucket by the raw value.
      }
      pages.set(key, (pages.get(key) ?? 0) + 1);
    };
  };

  const columns = 'source_platform, url, created_at, id';
  const hasPrev = Boolean(prevFrom && prevTo);
  // The window is already the full lifetime when neither bound is set, so
  // totalVisits doubles as the lifetime check — only worth a second cheap
  // count query when the window actually narrows the result.
  const hasWindow = Boolean(from || to);
  const [totalVisits, totalVisitsPrev, totalPageviews, , , lifetimeVisits] = await Promise.all([
    countRows(from, to, true),
    hasPrev ? countRows(prevFrom, prevTo) : Promise.resolve(0),
    countRows(from, to, true, { visits: false }),
    scanTrafficLogs(
      supabase,
      brandId,
      { columns, from, to, toInclusive: true },
      aggregate(platformMap, pageMap),
    ),
    hasPrev
      ? scanTrafficLogs(
          supabase,
          brandId,
          { columns, from: prevFrom, to: prevTo },
          aggregate(platformMapPrev, pageMapPrev),
        )
      : Promise.resolve(),
    hasWindow ? countRows() : Promise.resolve(null),
  ]);

  const hasAnyData = hasWindow ? (lifetimeVisits as number) > 0 : totalVisits > 0;

  const allPlatforms = new Set([...platformMap.keys(), ...platformMapPrev.keys()]);
  const platformBreakdown = Array.from(allPlatforms)
    .map((platform) => ({
      platform,
      visits: platformMap.get(platform) ?? 0,
      visitsPrev: platformMapPrev.get(platform) ?? 0,
    }))
    .filter((p) => p.visits > 0)
    .sort((a, b) => b.visits - a.visits);

  const topPages = Array.from(pageMap.entries())
    .map(([url, visits]) => ({
      url,
      visits,
      visitsPrev: pageMapPrev.get(url) ?? 0,
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, opts?.topPages ?? 10);

  return {
    totalVisits,
    totalVisitsPrev,
    totalPageviews,
    hasPreviousPeriod: hasPrev,
    platformBreakdown,
    topPages,
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

  // Group by day (or hour) + platform, aggregated per batch (#450).
  const dayMap = new Map<string, Map<string, number>>();
  const allPlatforms = new Set<string>();

  await scanTrafficLogs(
    supabase,
    brandId,
    { columns: 'source_platform, created_at, id', from, to, toInclusive: true },
    (r) => {
      const created = r.created_at as string;
      const day = hourly ? utcHourKey(created) : created.slice(0, 10);
      const platform = (r.source_platform as string) || 'unknown';
      allPlatforms.add(platform);

      if (!dayMap.has(day)) dayMap.set(day, new Map());
      const dm = dayMap.get(day)!;
      dm.set(platform, (dm.get(platform) ?? 0) + 1);
    },
  );

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
 * Pages that carry commercial weight and got no AI visit in the page's range
 * (#719, AT-002), from Analytics' AI channel or the tracking snippet.
 *
 * The server ranks the range the page shows when asked, with the nightly
 * engine's signal, floors and exclusions. The page used to read the nightly
 * findings, always the last 28 days, so the list could contradict the
 * snippet visits beside it.
 */
export interface PageOpportunity {
  landingPage: string;
  /** Which metric ranked this page — never present it as anything else. */
  valueSignal: 'revenue' | 'transactions' | 'key_events' | 'engagement';
  valuePercentile: number;
  valueRank: number;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  transactions: number;
  revenue: number;
  engagementSeconds: number;
  /**
   * Why this page gets nothing from AI engines — cited anyway, targeted by a
   * prompt and not cited, or not targeted at all.
   */
  citationState: 'cited' | 'targeted_not_cited' | 'not_targeted';
  citations: number;
  citingPrompts: number;
  targetingPrompts: number;
}

export interface PageOpportunities {
  /** Pages Analytics reported in the range; 0 when it has no data there. */
  pages: number;
  /** The best ten, best first. */
  rows: PageOpportunity[];
}

export async function getPageOpportunities(
  brandId: string,
  window?: TrafficDateWindow,
  /** The card shows the best ten; an export asks for more. */
  opts?: { limit?: number },
): Promise<PageOpportunities> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  // Analytics stores whole days, so the range goes as its first and last
  // day; an open end stays open.
  const params = new URLSearchParams({ brandId });
  const from = utcDay(window?.dateFrom);
  const to = utcDay(window?.dateTo);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (opts?.limit) params.set('limit', String(opts.limit));

  const res = await fetch(
    `${API_BASE_URL}/api/integrations/google-analytics/page-opportunities?${params}`,
    { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);

  const findings = (body.findings ?? []) as Record<string, unknown>[];
  return {
    pages: Number(body.pages) || 0,
    rows: findings.map((row) => ({
      landingPage: row.landing_page as string,
      valueSignal: row.value_signal as PageOpportunity['valueSignal'],
      valuePercentile: Number(row.value_percentile) || 0,
      valueRank: Number(row.value_rank) || 0,
      sessions: Number(row.sessions) || 0,
      engagedSessions: Number(row.engaged_sessions) || 0,
      keyEvents: Number(row.key_events) || 0,
      transactions: Number(row.transactions) || 0,
      revenue: Number(row.revenue) || 0,
      engagementSeconds: Number(row.engagement_seconds) || 0,
      citationState: row.citation_state as PageOpportunity['citationState'],
      citations: Number(row.citations) || 0,
      citingPrompts: Number(row.citing_prompts) || 0,
      targetingPrompts: Number(row.targeting_prompts) || 0,
    })),
  };
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
