'use server';

import { createClient } from '@/lib/supabase/server';
import { expandDateToEndOfDay } from '@/lib/dates';

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
}

export interface TrafficTrendPoint {
  date: string;
  [platform: string]: string | number;
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
  const [totalVisits, totalVisitsPrev] = await Promise.all([
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
  ]);

  const allPlatforms = new Set([...platformMap.keys(), ...platformMapPrev.keys()]);
  const platformBreakdown = Array.from(allPlatforms)
    .map((platform) => ({
      platform,
      visits: platformMap.get(platform) ?? 0,
      visitsPrev: platformMapPrev.get(platform) ?? 0,
    }))
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
