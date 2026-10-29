import type { McpAuthContext } from '@/lib/mcp-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getTrafficGoogleTotals } from '@/lib/actions/traffic';
import { brandInOrg } from './data';
import { asService } from './chat-facts';

/**
 * Chat's Google reads (CHAT-20 §9 row 35): Search Console clicks and
 * Analytics sessions over a window, against the window before, as AI
 * Referral Traffic reads them (getTrafficGoogleTotals). A brand without the
 * source connected says so (`connected: false`). `data_as_of` is the last
 * day Google reported, with `source_lag` (§15a). Null for a brand outside
 * the organization.
 */

const DAY_MS = 86_400_000;
const windowOf = (days: number) => ({
  dateFrom: new Date(Date.now() - (days - 1) * DAY_MS).toISOString(),
  dateTo: new Date().toISOString(),
});

async function propertiesOf(brandId: string) {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('gsc_property, ga_property_id')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { gsc: Boolean(data?.gsc_property), ga: Boolean(data?.ga_property_id) };
}

export async function getGscSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number },
) {
  if (!(await brandInOrg(auth, params.brandId))) return null;
  const days = params.days ?? 28;
  if (!(await propertiesOf(params.brandId)).gsc) {
    return { connected: false, days, data_as_of: null, source_lag: '2–3 days' };
  }
  const totals = await asService(() =>
    getTrafficGoogleTotals(params.brandId, windowOf(days), {
      ga: false,
      gsc: true,
      gscLatestDays: null,
    }),
  );
  return {
    connected: true,
    days,
    clicks: totals.gsc?.clicks ?? 0,
    previous_clicks: totals.gsc?.prevClicks ?? null,
    since: totals.gsc?.since ?? null,
    until: totals.gsc?.until ?? null,
    data_as_of: totals.gsc?.until ?? null,
    source_lag: '2–3 days',
  };
}

export async function getGaSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number },
) {
  if (!(await brandInOrg(auth, params.brandId))) return null;
  const days = params.days ?? 28;
  if (!(await propertiesOf(params.brandId)).ga) {
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
    // The last day Analytics reported for the brand.
    supabaseAdmin
      .from('ga_ai_traffic_stats')
      .select('date')
      .eq('brand_id', params.brandId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (latest.error) throw new Error(latest.error.message);
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
    data_as_of: latest.data?.date ?? null,
    source_lag: '1 day',
  };
}
