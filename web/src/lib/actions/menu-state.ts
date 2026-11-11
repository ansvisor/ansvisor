'use server';

import { createClient } from '@/lib/supabase/server';
import { getMyOpenActionCount } from '@/lib/actions/action-center-counts';
import { NIGHTLY_AREAS, isDotArea, type DotArea, type MenuState } from '@/lib/menu-dots';
import { isoTime, isUuid, readNavSeen } from '@/lib/user-brand-state';

/**
 * What the simplified menu's dots and the Action Center's count compare
 * (SIMPLE_NAV; lib/menu-dots.ts), in one read per brand: run on a brand
 * switch and at most every 5 minutes while the person moves around, never
 * at night. A handful of indexed single-row reads in parallel, as the
 * person (RLS), each only for an area the person's menu shows:
 *
 *   the latest nightly run       tracking_runs, source cron (tracking_runs_brand_completed_idx)
 *   the newest new suggestion    prompt_suggestions (idx_prompt_suggestions_brand_status)
 *   the newest new action        actions, unassigned or the person's (actions_brand_status_idx)
 *   the newest new opportunity   content_opportunities (content_opportunities_brand_created_idx)
 *   AI traffic connected, when   the first AI visit (idx_ai_traffic_logs_brand_created);
 *                                the brand's Analytics property and the workspace's connection
 *   the open-action count        getMyOpenActionCount, the Actions tab's own read
 *   the person's visits          user_brand_state.nav_seen (00529)
 *
 * Prompts waiting for a spot come with PR 16. Answers as a value and never
 * throws (#1777); null when it can't be read, and a part that couldn't be
 * read is null, so its dot doesn't show.
 */

/** What the menu asks for: the areas it shows a dot for, and whether it shows the count. */
export interface MenuStateAsk {
  areas: DotArea[];
  count: boolean;
}

type Client = Awaited<ReturnType<typeof createClient>>;

/** One read's time column, or null when there is none or the read failed. */
async function timeOf(
  read: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  column: string,
  what: string,
): Promise<string | null> {
  const { data, error } = await read;
  if (error) {
    console.error(`[menu-state] could not read ${what}:`, error.message);
    return null;
  }
  return isoTime((data as Record<string, unknown> | null)?.[column]);
}

/**
 * When AI Referral Traffic was connected: the earlier of the brand's first
 * AI visit (the snippet works) and its Google Analytics connection (a
 * property chosen for the brand, the workspace connected). Null while
 * neither is; undefined when it couldn't be read.
 */
async function trafficOf(
  supabase: Client,
  brandId: string,
): Promise<MenuState['traffic'] | undefined> {
  const [visit, brand, analytics] = await Promise.all([
    supabase
      .from('ai_traffic_logs')
      .select('created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('brands')
      .select('organization_id, ga_property_id')
      .eq('id', brandId)
      .maybeSingle(),
    supabase
      .from('integration_connections')
      .select('organization_id, updated_at')
      .eq('provider', 'google-analytics')
      .eq('status', 'connected'),
  ]);
  const error = visit.error ?? brand.error ?? analytics.error;
  if (error) {
    console.error('[menu-state] could not read the traffic connection:', error.message);
    return undefined;
  }
  const times = [isoTime(visit.data?.created_at)];
  if (brand.data?.ga_property_id?.trim()) {
    const connection = analytics.data?.find(
      (row) => row.organization_id === brand.data?.organization_id,
    );
    times.push(isoTime(connection?.updated_at));
  }
  const connected = times.filter((time): time is string => time !== null).sort();
  return { connectedAt: connected[0] ?? null };
}

export async function getMenuState(brandId: string, ask: MenuStateAsk): Promise<MenuState | null> {
  if (!isUuid(brandId)) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const areas = new Set((Array.isArray(ask?.areas) ? ask.areas : []).filter(isDotArea));
    const none = Promise.resolve(null);

    const [
      nightlyRunAt,
      newSuggestionAt,
      newActionAt,
      newOpportunityAt,
      traffic,
      openActions,
      seen,
    ] = await Promise.all([
      NIGHTLY_AREAS.some((area) => areas.has(area))
        ? timeOf(
            supabase
              .from('tracking_runs')
              .select('completed_at')
              .eq('brand_id', brandId)
              .eq('source', 'cron')
              .not('completed_at', 'is', null)
              .order('completed_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            'completed_at',
            'the latest nightly run',
          )
        : none,
      areas.has('prompts/suggestions')
        ? timeOf(
            supabase
              .from('prompt_suggestions')
              .select('generated_at')
              .eq('brand_id', brandId)
              .eq('status', 'new')
              .order('generated_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            'generated_at',
            'the newest suggestion',
          )
        : none,
      areas.has('action-center/actions')
        ? timeOf(
            supabase
              .from('actions')
              .select('created_at')
              .eq('brand_id', brandId)
              .eq('status', 'new')
              .is('deleted_at', null)
              .or(`assignee_id.is.null,assignee_id.eq.${user.id}`)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            'created_at',
            'the newest action',
          )
        : none,
      areas.has('content')
        ? timeOf(
            supabase
              .from('content_opportunities')
              .select('created_at')
              .eq('brand_id', brandId)
              .eq('status', 'new')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            'created_at',
            'the newest opportunity',
          )
        : none,
      areas.has('traffic') ? trafficOf(supabase, brandId) : Promise.resolve(undefined),
      ask?.count ? getMyOpenActionCount(brandId) : none,
      supabase
        .from('user_brand_state')
        .select('nav_seen')
        .eq('user_id', user.id)
        .eq('brand_id', brandId)
        .maybeSingle(),
    ]);
    if (seen.error) console.error('[menu-state] could not read the visits:', seen.error.message);

    const state: MenuState = {
      nightlyRunAt,
      newSuggestionAt,
      newActionAt,
      newOpportunityAt,
      openActions,
      navSeen: seen.error ? null : readNavSeen(seen.data?.nav_seen),
    };
    if (traffic) state.traffic = traffic;
    return state;
  } catch (error) {
    console.error('[menu-state] could not read the menu state:', error);
    return null;
  }
}
