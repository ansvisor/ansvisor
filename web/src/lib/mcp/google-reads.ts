import type { McpAuthContext } from '@/lib/mcp-auth';
import { readBrandIntegrations } from '@/lib/brand-integrations';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getTrafficGoogleTotals } from '@/lib/actions/traffic';
import { brandAllowed } from './data';
import { asService } from './chat-facts';

/**
 * Chat's Google reads (CHAT-20 §9 row 35): Search Console clicks and
 * Analytics sessions over a window, against the window before, as AI
 * Referral Traffic reads them (getTrafficGoogleTotals), and Search
 * Console's queries (the /prompts skill's). A brand without the
 * source connected (the Google sign-in it uses on, its property picked)
 * says so (`connected: false`). `data_as_of` is the last
 * day Google reported, with `source_lag` (§15a). Null for a brand outside
 * the organization.
 */

const DAY_MS = 86_400_000;
const windowOf = (days: number) => ({
  dateFrom: new Date(Date.now() - (days - 1) * DAY_MS).toISOString(),
  dateTo: new Date().toISOString(),
});

/**
 * Whether each source is connected for the brand, as AI Referral Traffic
 * reads it (googleSourceStatus): the Google sign-in the brand uses is on
 * (00470, lib/brand-integrations.ts) and the brand has its property picked.
 * The brand is the caller's (brandAllowed, before this).
 */
async function sourcesOf(brandId: string) {
  const [brand, integrations] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('gsc_property, ga_property_id')
      .eq('id', brandId)
      .maybeSingle(),
    readBrandIntegrations(supabaseAdmin, brandId),
  ]);
  if (brand.error) throw new Error(brand.error.message);
  const on = (provider: string) => Boolean(integrations.get(provider)?.connected);
  return {
    gsc: on('google-search-console') && Boolean(brand.data?.gsc_property),
    ga: on('google-analytics') && Boolean(brand.data?.ga_property_id),
  };
}

/** The day `days` before a YYYY-MM-DD day, as YYYY-MM-DD. */
const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

/** The last day a Google source reported for the brand; null with none. */
async function lastReportedDay(table: 'gsc_query_stats' | 'ga_ai_traffic_stats', brandId: string) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('date')
    .eq('brand_id', brandId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { date?: string } | null)?.date ?? null;
}

export async function getGscSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = params.days ?? 28;
  if (!(await sourcesOf(params.brandId)).gsc) {
    return { connected: false, days, data_as_of: null, source_lag: '2–3 days' };
  }
  const [totals, lastDay] = await Promise.all([
    asService(() =>
      getTrafficGoogleTotals(params.brandId, windowOf(days), {
        ga: false,
        gsc: true,
        // As the page reads a short range (traffic-kpis): Google's latest
        // reported days, since it reports about two days late.
        gscLatestDays: days <= 7 ? days : null,
      }),
    ),
    lastReportedDay('gsc_query_stats', params.brandId),
  ]);
  return {
    connected: true,
    days,
    clicks: totals.gsc?.clicks ?? 0,
    previous_clicks: totals.gsc?.prevClicks ?? null,
    since: totals.gsc?.since ?? null,
    until: totals.gsc?.until ?? null,
    data_as_of: lastDay,
    source_lag: '2–3 days',
  };
}

/** Search Console queries listed, the most seen first. */
const GSC_QUERIES_SHOWN = 25;

/** A query's row as ae_gsc_queries (00091) sums it: this span, and the span before. */
interface GscQueryRow {
  query: string;
  cur_clicks: number | null;
  cur_impressions: number | null;
  cur_position: number | null;
  prev_clicks: number | null;
  prev_impressions: number | null;
}

const asCount = (value: unknown) => (value == null ? null : Number(value));

/**
 * The brand's Search Console queries (AGENTS plan §3 #10, the /prompts
 * skill): each query's clicks, impressions and average position over the
 * last `days` days Google reported, against the same span before, the most
 * seen first. Summed in the database by the function Action Center's
 * detectors read them with (ae_gsc_queries, service role only), once the
 * brand is the caller's; at most its 500 most seen queries. A brand without
 * Search Console connected says so.
 */
export async function getGscQueriesFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number; limit?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = params.days ?? 28;
  const none = { days, queries_total: 0, queries: [], source_lag: '2–3 days' };
  if (!(await sourcesOf(params.brandId)).gsc) {
    return { connected: false, ...none, data_as_of: null };
  }
  // Google reports two to three days late: the spans end on the last day it reported.
  const until = await lastReportedDay('gsc_query_stats', params.brandId);
  if (!until) return { connected: true, ...none, data_as_of: null };
  const since = daysBefore(until, days - 1);
  const { data, error } = await supabaseAdmin.rpc('ae_gsc_queries', {
    p_brand_id: params.brandId,
    p_cur_from: since,
    p_cur_to: until,
    p_prev_from: daysBefore(until, 2 * days - 1),
    p_prev_to: daysBefore(until, days),
  });
  if (error) throw new Error(error.message);
  const seen = ((Array.isArray(data) ? data : []) as GscQueryRow[]).filter(
    (row) => Number(row.cur_impressions) > 0,
  );
  return {
    connected: true,
    days,
    since,
    until,
    queries_total: seen.length,
    queries: seen.slice(0, params.limit ?? GSC_QUERIES_SHOWN).map((row) => ({
      query: row.query,
      clicks: Number(row.cur_clicks ?? 0),
      impressions: Number(row.cur_impressions),
      position: row.cur_position == null ? null : Math.round(Number(row.cur_position) * 10) / 10,
      previous_clicks: asCount(row.prev_clicks),
      previous_impressions: asCount(row.prev_impressions),
    })),
    data_as_of: until,
    source_lag: '2–3 days',
  };
}

export async function getGaSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = params.days ?? 28;
  if (!(await sourcesOf(params.brandId)).ga) {
    return { connected: false, days, data_as_of: null, source_lag: '1 day' };
  }
  const [totals, latest] = await Promise.all([
    asService(() =>
      getTrafficGoogleTotals(params.brandId, windowOf(days), {
        ga: true,
        gsc: false,
        gscLatestDays: null,
      }),
    ),
    lastReportedDay('ga_ai_traffic_stats', params.brandId),
  ]);
  const ga = totals.ga;
  return {
    connected: true,
    days,
    sessions: ga?.sessions ?? 0,
    ai_sessions: ga?.aiSessions ?? 0,
    ai_engaged_sessions: ga?.aiEngagedSessions ?? 0,
    ai_key_events: ga?.aiKeyEvents ?? 0,
    ai_revenue: ga?.aiRevenue ?? 0,
    organic_sessions: ga?.organic.sessions ?? 0,
    data_as_of: latest,
    source_lag: '1 day',
  };
}
