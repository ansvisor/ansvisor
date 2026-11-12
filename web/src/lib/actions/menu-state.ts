'use server';

import { createClient } from '@/lib/supabase/server';
import { getMyOpenActionCount } from '@/lib/actions/action-center-counts';
import { readBrandIntegrations } from '@/lib/brand-integrations';
import {
  NIGHTLY_AREAS,
  isDotArea,
  type BrokenReason,
  type DotArea,
  type MenuState,
  type WorkingReason,
} from '@/lib/menu-dots';
import { isoTime, isUuid, readNavSeen } from '@/lib/user-brand-state';

/**
 * What the menu's dots and the Action Center's count compare
 * (lib/menu-dots.ts), in one read per brand: run on a brand
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
 *   prompts waiting for a spot   a head count of the brand's prompts (idx_prompts_waiting,
 *                                00535), for admins and managers (PR 16)
 *   the person's visits          user_brand_state.nav_seen (00529)
 *
 * Red, what broke (asked only for admins and managers, `red`):
 *
 *   Google disconnected          the brand's Search Console or Analytics sign-in
 *                                'disconnected' (readBrandIntegrations): expired or revoked
 *   AI crawlers blocked          the latest audit's ai-bot-access check failed
 *                                (site_audits_brand_id_idx, then audit_signal_results' unique key)
 *   a page didn't reach the CMS  the newest failed delivery with no later one through
 *                                (content_draft_deliveries, by organisation and by draft)
 *   an agent's run failed        the latest run of each of the person's agents on the brand
 *                                (chat_agent_runs_brand_idx)
 *
 * Grey, what runs now (everyone), each started within WORKING_WITHIN_MS so a
 * run a stopped server left open doesn't pulse for ever:
 *
 *   an agent run                 chat_agent_runs running (chat_agent_runs_brand_idx)
 *   the Content Agent writing    content_agent_runs write or rewrite, unfinished
 *   a tracking run, any source   the latest started run not completed
 *                                (tracking_runs_brand_started_idx): Visibility and Tracked Prompts
 *   an audit                     the latest site_audits row running
 *
 * Not read, as nothing stored tells it cheaply as the person: a report being
 * generated (its row is written once done), the content opportunities
 * refresh (jobs, which RLS keeps from members), the prompt-suggestion
 * refresh (kept nowhere).
 *
 * Answers as a value and never throws (#1777); null when it can't be read,
 * and a part that couldn't be read is null, so its dot doesn't show.
 */

/** What the menu asks for: the areas it shows a dot for, and whether it shows the count. */
export interface MenuStateAsk {
  areas: DotArea[];
  count: boolean;
  /**
   * Count the prompts waiting for a spot, for Tracked Prompts' yellow dot:
   * asked only for an admin or manager with Tracked Prompts on their menu.
   */
  waiting?: boolean;
  /** Read what broke, for the red dots: asked only for an admin or manager, not on the demo brand. */
  red?: boolean;
}

/** A job running longer than this is taken for one a stopped server left open. */
export const WORKING_WITHIN_MS = 6 * 60 * 60_000;

/** What a red or grey read found for its area; null when it couldn't be read. */
interface StatusOf {
  broken?: BrokenReason;
  working?: WorkingReason;
}

const sinceWorking = () => new Date(Date.now() - WORKING_WITHIN_MS).toISOString();

function recent(at: unknown): boolean {
  const time = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  return !Number.isNaN(time) && Date.now() - time < WORKING_WITHIN_MS;
}

function failedRead(what: string, error: { message: string } | null | undefined): boolean {
  if (error) console.error(`[menu-state] could not read ${what}:`, error.message);
  return Boolean(error);
}

/**
 * The brand's Google sign-ins: 'disconnected' is stored once Ansvisor finds
 * no live account behind one that was connected (expired, or revoked from
 * Google's side); a person's own Disconnect removes the row instead.
 */
async function googleOf(supabase: Client, brandId: string): Promise<StatusOf | null> {
  try {
    const found = await readBrandIntegrations(
      supabase as unknown as Parameters<typeof readBrandIntegrations>[0],
      brandId,
    );
    if (found.get('google-search-console')?.status === 'disconnected') {
      return { broken: 'searchConsole' };
    }
    if (found.get('google-analytics')?.status === 'disconnected') return { broken: 'analytics' };
    return {};
  } catch (error) {
    console.error('[menu-state] could not read the Google connections:', error);
    return null;
  }
}

/**
 * The latest audit: grey while it runs; red, for those who read red, when
 * it finished with the AI bot access check failed (robots.txt blocks AI
 * crawlers, SA-008).
 */
async function auditOf(supabase: Client, brandId: string, red: boolean): Promise<StatusOf | null> {
  const latest = await supabase
    .from('site_audits')
    .select('id, status, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (failedRead('the latest audit', latest.error)) return null;
  const audit = latest.data as { id: string; status: string; created_at: string } | null;
  if (!audit) return {};
  if (audit.status === 'running')
    return recent(audit.created_at) ? { working: 'auditRunning' } : {};
  if (!red || audit.status !== 'completed') return {};
  const check = await supabase
    .from('audit_signal_results')
    .select('status')
    .eq('audit_id', audit.id)
    .eq('signal_key', 'ai-bot-access')
    .maybeSingle();
  if (failedRead('the audit’s AI bot access', check.error)) return null;
  return (check.data as { status?: string } | null)?.status === 'fail'
    ? { broken: 'aiBotsBlocked' }
    : {};
}

/** The newest send to the CMS that failed, unless a later one for its draft went through. */
async function deliveryOf(supabase: Client, brandId: string): Promise<StatusOf | null> {
  const failed = await supabase
    .from('content_draft_deliveries')
    .select('draft_id, created_at')
    .eq('brand_id', brandId)
    .eq('status', 'failed')
    .not('draft_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (failedRead('the newest failed delivery', failed.error)) return null;
  const row = failed.data as { draft_id: string; created_at: string } | null;
  if (!row) return {};
  const later = await supabase
    .from('content_draft_deliveries')
    .select('id')
    .eq('draft_id', row.draft_id)
    .in('status', ['sent', 'published'])
    .gt('created_at', row.created_at)
    .limit(1)
    .maybeSingle();
  if (failedRead('the later deliveries', later.error)) return null;
  return later.data ? {} : { broken: 'publishFailed' };
}

/** Runs read to find each of the person's agents' latest. */
const AGENT_RUNS = 20;

/**
 * Agents: grey while one of the brand's runs works; red, for those who read
 * red, when the latest run of one of the person's own agents on the brand
 * failed (a run waiting for them stays yellow, in Chat).
 */
async function agentsOf(
  supabase: Client,
  brandId: string,
  userId: string,
  red: boolean,
): Promise<StatusOf | null> {
  const [running, mine] = await Promise.all([
    supabase
      .from('chat_agent_runs')
      .select('id')
      .eq('brand_id', brandId)
      .eq('status', 'running')
      .gte('started_at', sinceWorking())
      .limit(1)
      .maybeSingle(),
    red
      ? supabase
          .from('chat_agent_runs')
          .select('agent_id, status, chat_agents!inner(owner_id)')
          .eq('brand_id', brandId)
          .eq('chat_agents.owner_id', userId)
          .not('status', 'in', '(queued,skipped)')
          .order('queued_at', { ascending: false })
          .limit(AGENT_RUNS)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (failedRead('the agent runs', running.error ?? mine.error)) return null;
  const status: StatusOf = {};
  if (running.data) status.working = 'agentRunning';
  const latest = new Map<string, string>();
  for (const run of (mine.data ?? []) as { agent_id: string | null; status: string }[]) {
    if (run.agent_id && !latest.has(run.agent_id)) latest.set(run.agent_id, run.status);
  }
  if ([...latest.values()].includes('failed')) status.broken = 'agentFailed';
  return status;
}

/** The Content Agent writing a page for the brand (Write this, Start now). */
async function writingOf(supabase: Client, brandId: string): Promise<StatusOf | null> {
  const { data, error } = await supabase
    .from('content_agent_runs')
    .select('id, content_drafts!content_agent_runs_draft_id_fkey!inner(brand_id)')
    .eq('content_drafts.brand_id', brandId)
    .in('kind', ['write', 'rewrite'])
    .is('finished_at', null)
    .gte('started_at', sinceWorking())
    .limit(1)
    .maybeSingle();
  if (failedRead('the Content Agent’s runs', error)) return null;
  return data ? { working: 'writing' } : {};
}

/**
 * A tracking run under way, any source (the nightly run, the first, a
 * person's): the brand's latest started run, not completed yet.
 */
async function trackingOf(supabase: Client, brandId: string): Promise<StatusOf | null> {
  const { data, error } = await supabase
    .from('tracking_runs')
    .select('started_at, completed_at')
    .eq('brand_id', brandId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (failedRead('the latest tracking run', error)) return null;
  const run = data as { started_at: string; completed_at: string | null } | null;
  return run && !run.completed_at && recent(run.started_at) ? { working: 'trackingRunning' } : {};
}

/** How many of the brand's prompts wait for a spot; null when it couldn't be read. */
async function waitingCount(supabase: Client, brandId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)', { count: 'exact', head: true })
    .eq('prompt_sets.brand_id', brandId)
    .not('waiting_since', 'is', null);
  if (error) {
    console.error('[menu-state] could not count the prompts waiting for a spot:', error.message);
    return null;
  }
  return count ?? 0;
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
    const red = ask?.red === true;
    const none = Promise.resolve(null);

    const [
      nightlyRunAt,
      newSuggestionAt,
      newActionAt,
      newOpportunityAt,
      traffic,
      openActions,
      waitingPrompts,
      seen,
      google,
      audit,
      delivery,
      agents,
      writing,
      tracking,
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
      ask?.waiting && areas.has('prompts/tracked') ? waitingCount(supabase, brandId) : none,
      supabase
        .from('user_brand_state')
        .select('nav_seen')
        .eq('user_id', user.id)
        .eq('brand_id', brandId)
        .maybeSingle(),
      red && areas.has('traffic') ? googleOf(supabase, brandId) : none,
      areas.has('audit') ? auditOf(supabase, brandId, red) : none,
      red && areas.has('content/library') ? deliveryOf(supabase, brandId) : none,
      areas.has('agents') ? agentsOf(supabase, brandId, user.id, red) : none,
      areas.has('content/editor') ? writingOf(supabase, brandId) : none,
      areas.has('insights') || areas.has('prompts/tracked') ? trackingOf(supabase, brandId) : none,
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
    if (waitingPrompts !== null) state.waitingPrompts = waitingPrompts;
    const statuses: [DotArea, StatusOf | null][] = [
      ['traffic', google],
      ['audit', audit],
      ['content/library', delivery],
      ['agents', agents],
      ['content/editor', writing],
      ['insights', tracking],
      ['prompts/tracked', tracking],
    ];
    const broken: NonNullable<MenuState['broken']> = {};
    const working: NonNullable<MenuState['working']> = {};
    for (const [area, status] of statuses) {
      if (red && status?.broken) broken[area] = status.broken;
      if (status?.working) working[area] = status.working;
    }
    if (red) state.broken = broken;
    if (Object.keys(working).length > 0) state.working = working;
    return state;
  } catch (error) {
    console.error('[menu-state] could not read the menu state:', error);
    return null;
  }
}
