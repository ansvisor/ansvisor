'use server';

import { createClient } from '@/lib/supabase/server';

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

function getDateRange(days: number): {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
} {
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  const prevTo = from;
  const prevFrom = new Date(now.getTime() - days * 2 * 86400000).toISOString();
  return { from, to, prevFrom, prevTo };
}

export async function getTrafficSummary(brandId: string, days = 7): Promise<TrafficSummary> {
  const supabase = await createClient();
  const { from, prevFrom, prevTo } = getDateRange(days);

  // Current period
  const { data: current } = await supabase
    .from('ai_traffic_logs')
    .select('source_platform, url')
    .eq('brand_id', brandId)
    .gte('created_at', from);

  // Previous period
  const { data: previous } = await supabase
    .from('ai_traffic_logs')
    .select('source_platform, url')
    .eq('brand_id', brandId)
    .gte('created_at', prevFrom)
    .lt('created_at', prevTo);

  const rows = current ?? [];
  const prevRows = previous ?? [];

  // Platform breakdown
  const platformMap = new Map<string, number>();
  const platformMapPrev = new Map<string, number>();

  for (const r of rows) {
    const p = (r.source_platform as string) || 'unknown';
    platformMap.set(p, (platformMap.get(p) ?? 0) + 1);
  }
  for (const r of prevRows) {
    const p = (r.source_platform as string) || 'unknown';
    platformMapPrev.set(p, (platformMapPrev.get(p) ?? 0) + 1);
  }

  const allPlatforms = new Set([...platformMap.keys(), ...platformMapPrev.keys()]);
  const platformBreakdown = Array.from(allPlatforms)
    .map((platform) => ({
      platform,
      visits: platformMap.get(platform) ?? 0,
      visitsPrev: platformMapPrev.get(platform) ?? 0,
    }))
    .sort((a, b) => b.visits - a.visits);

  // Top pages
  const pageMap = new Map<string, number>();
  const pageMapPrev = new Map<string, number>();

  for (const r of rows) {
    const url = r.url as string;
    try {
      const path = new URL(url).pathname;
      pageMap.set(path, (pageMap.get(path) ?? 0) + 1);
    } catch {
      pageMap.set(url, (pageMap.get(url) ?? 0) + 1);
    }
  }
  for (const r of prevRows) {
    const url = r.url as string;
    try {
      const path = new URL(url).pathname;
      pageMapPrev.set(path, (pageMapPrev.get(path) ?? 0) + 1);
    } catch {
      pageMapPrev.set(url, (pageMapPrev.get(url) ?? 0) + 1);
    }
  }

  const topPages = Array.from(pageMap.entries())
    .map(([url, visits]) => ({
      url,
      visits,
      visitsPrev: pageMapPrev.get(url) ?? 0,
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

  return {
    totalVisits: rows.length,
    totalVisitsPrev: prevRows.length,
    platformBreakdown,
    topPages,
  };
}

export async function getTrafficTrend(brandId: string, days = 7): Promise<TrafficTrendPoint[]> {
  const supabase = await createClient();
  const from = new Date(Date.now() - days * 86400000).toISOString();

  const { data } = await supabase
    .from('ai_traffic_logs')
    .select('source_platform, created_at')
    .eq('brand_id', brandId)
    .gte('created_at', from)
    .order('created_at', { ascending: true });

  const rows = data ?? [];

  // Group by day + platform
  const dayMap = new Map<string, Map<string, number>>();
  const allPlatforms = new Set<string>();

  for (const r of rows) {
    const day = (r.created_at as string).slice(0, 10);
    const platform = (r.source_platform as string) || 'unknown';
    allPlatforms.add(platform);

    if (!dayMap.has(day)) dayMap.set(day, new Map());
    const dm = dayMap.get(day)!;
    dm.set(platform, (dm.get(platform) ?? 0) + 1);
  }

  // Fill missing days
  const result: TrafficTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const day = d.toISOString().slice(0, 10);
    const dm = dayMap.get(day);
    const point: TrafficTrendPoint = { date: day };
    for (const p of allPlatforms) {
      point[p] = dm?.get(p) ?? 0;
    }
    result.push(point);
  }

  return result;
}

export async function getTrafficLogs(
  brandId: string,
  opts?: {
    limit?: number;
    offset?: number;
    platform?: string;
    search?: string;
    days?: number;
  },
): Promise<{ logs: TrafficLog[]; total: number }> {
  const supabase = await createClient();
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;
  const platform = opts?.platform;
  const search = opts?.search;
  const days = opts?.days;

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

  if (days) {
    const from = new Date(Date.now() - days * 86400000).toISOString();
    query = query.gte('created_at', from);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  return {
    logs: (data ?? []).map((r) => mapLogRow(r as Record<string, unknown>)),
    total: count ?? 0,
  };
}
