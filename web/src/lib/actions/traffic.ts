'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { expandDateToEndOfDay, utcDay } from '@/lib/dates';
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
}

export interface TrafficSummary {
  totalVisits: number;
  totalVisitsPrev: number;
  platformBreakdown: { platform: string; visits: number; visitsPrev: number }[];
  topPages: { url: string; visits: number; visitsPrev: number }[];
  hasAnyData: boolean;
}

export interface TrafficTrendPoint {
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
 * PostgREST silently caps un-paginated selects at 1000 rows, which froze the
 * visits KPI at 1000 and truncated every breakdown on busy brands (#450).
 * Totals come from exact count queries; the breakdown/trend scans page
 * through the window with deterministic ordering and a hard ceiling so a
 * pathological brand can't pin the server action.
 */
const TRAFFIC_PAGE_SIZE = 1000;
const TRAFFIC_MAX_ROWS = 50_000;

async function scanTrafficLogs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  window: { columns: string; from?: string; to?: string; toInclusive?: boolean },
  onRow: (row: Record<string, unknown>) => void,
): Promise<void> {
  for (let start = 0; start < TRAFFIC_MAX_ROWS; start += TRAFFIC_PAGE_SIZE) {
    let query = supabase
      .from('ai_traffic_logs')
      .select(window.columns)
      .eq('brand_id', brandId)
      // Deterministic order so .range() pages don't shuffle between requests.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + TRAFFIC_PAGE_SIZE - 1);
    if (window.from) query = query.gte('created_at', window.from);
    if (window.to) {
      query = window.toInclusive
        ? query.lte('created_at', window.to)
        : query.lt('created_at', window.to);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of batch) onRow(row);
    if (batch.length < TRAFFIC_PAGE_SIZE) break;
  }
}

export async function getTrafficSummary(
  brandId: string,
  window?: TrafficDateWindow,
): Promise<TrafficSummary> {
  const supabase = await createClient();
  const { from, to, prevFrom, prevTo } = resolveTrafficWindow(window);

  // Exact totals — count queries transfer no rows and are immune to the cap.
  const countVisits = async (fromTs?: string, toTs?: string, toInclusive = false) => {
    let query = supabase
      .from('ai_traffic_logs')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId);
    if (fromTs) query = query.gte('created_at', fromTs);
    if (toTs) {
      query = toInclusive ? query.lte('created_at', toTs) : query.lt('created_at', toTs);
    }
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

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
  const [totalVisits, totalVisitsPrev, , , lifetimeVisits] = await Promise.all([
    countVisits(from, to, true),
    hasPrev ? countVisits(prevFrom, prevTo) : Promise.resolve(0),
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
    hasWindow ? countVisits() : Promise.resolve(null),
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
    .slice(0, 10);

  return {
    totalVisits,
    totalVisitsPrev,
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

  // Group by day + platform, aggregated per batch (#450).
  const dayMap = new Map<string, Map<string, number>>();
  const allPlatforms = new Set<string>();

  await scanTrafficLogs(
    supabase,
    brandId,
    { columns: 'source_platform, created_at, id', from, to, toInclusive: true },
    (r) => {
      const day = (r.created_at as string).slice(0, 10);
      const platform = (r.source_platform as string) || 'unknown';
      allPlatforms.add(platform);

      if (!dayMap.has(day)) dayMap.set(day, new Map());
      const dm = dayMap.get(day)!;
      dm.set(platform, (dm.get(platform) ?? 0) + 1);
    },
  );

  let days: string[];
  if (from && to) {
    days = listUtcDays(from, to);
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
): Promise<{ logs: TrafficLog[]; total: number }> {
  const supabase = await createClient();
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;
  const platform = opts?.platform;
  const search = opts?.search;
  const { from, to } = resolveTrafficWindow({
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
  });

  let query = supabase
    .from('ai_traffic_logs')
    .select('*', { count: 'exact' })
    .eq('brand_id', brandId);

  // Apply filters
  if (platform) {
    query = query.eq('source_platform', platform);
  }

  if (search) {
    // Escape \, % and _ for ILIKE to treat them as literals, not wildcards
    const escaped = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    query = query.ilike('url', `%${escaped}%`);
  }

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    logs: (data ?? []).map((r) => mapLogRow(r as Record<string, unknown>)),
    total: count ?? 0,
  };
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
