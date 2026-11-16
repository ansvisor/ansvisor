import { API_BASE_URL } from '@/config/api';
import type { AdsOpportunities, AdsOpportunityDetail } from '@/lib/ads/api';
import { DEFAULT_ADS_PERIOD, type AdsPeriod } from '@/lib/ads/tabs';
import { actorOf } from '@/lib/chat/actor/access';
import { actingOpen, actingRefusalOf, apiAs, type ApiAnswer } from '@/lib/chat/actor/api';
import { factsForPage } from '@/lib/content/fact-scope';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { brandAllowed } from './data';

/**
 * Chat's read of Ads (Ads Phase 0 PR 15, get_ads_opportunities): the
 * Opportunities rows and one prompt's drawer, from the API server's /api/ads
 * routes the page reads (lib/ads/api.ts), as the run's person, so the server
 * decides what their plan shows (Starter's and the trial's first rows, and
 * how many more are `locked`), that they reach the brand, and what moved
 * since last week (`sinceLastWeek`). With their own session; in a run no
 * session of theirs is behind (an agent's schedule, PR 18), the acting way
 * (lib/chat/actor/api.ts), which the server checks as their session. The
 * person is always the run's (the tool context), never the model's input.
 * One prompt's read adds the approved facts its ads may state, with the ids
 * save_ad_drafts' claims name, read by the brand and its organization. Null
 * for a brand outside their scope.
 */

/** A GET of /api/ads/{path} as the run's person. */
type AdsGet = (path: string) => Promise<Pick<ApiAnswer, 'status' | 'ok'> & { body: unknown }>;

const NO_WAY =
  'Ads is read as the person this run is for, and this run has neither their session nor a way to act for them.';

/** The signed-in person's session when they are the run's person; none outside a request. */
async function sessionOf(userId: string) {
  try {
    const {
      data: { session },
    } = await (await createClient()).auth.getSession();
    return session?.user.id === userId ? session : null;
  } catch {
    return null;
  }
}

/** The run's person's way to /api/ads: their session, else the acting way while it is open. */
async function adsGetFor(auth: McpAuthContext): Promise<AdsGet | null> {
  const signal = () => AbortSignal.timeout(30_000);
  const session = await sessionOf(auth.userId);
  if (session) {
    return async (path) => {
      const res = await fetch(`${API_BASE_URL}/api/ads/${path}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
        signal: signal(),
      });
      return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) };
    };
  }
  if (!actingOpen()) return null;
  const actor = actorOf(auth);
  return (path) => apiAs(actor, `/api/ads/${path}`, { method: 'GET', signal: signal() });
}

export async function getAdsOpportunitiesFor(
  auth: McpAuthContext,
  params: { brandId: string; promptId?: string; period?: AdsPeriod },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const read = await adsGetFor(auth);
  if (!read) return { note: NO_WAY };
  // A brand or prompt the server refuses (another workspace's, past the plan's rows) is null.
  const get = async <T>(path: string): Promise<T | null> => {
    const res = await read(path);
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new Error(`Ads ${path.split('?')[0]}: ${res.status}`);
    return res.body as T;
  };
  try {
    return await readAds(auth, params, get);
  } catch (err) {
    // The server took no one to act as, or Chat is off: said in the person's words.
    const refused = actingRefusalOf(err);
    if (refused) return { note: refused.message };
    throw err;
  }
}

async function readAds(
  auth: McpAuthContext,
  params: { brandId: string; promptId?: string; period?: AdsPeriod },
  get: <T>(path: string) => Promise<T | null>,
) {
  const period = params.period ?? DEFAULT_ADS_PERIOD;
  const query = new URLSearchParams({ brandId: params.brandId, period });
  const list = await get<AdsOpportunities>(`opportunities?${query}`);
  if (!list) return null;
  const locked = list.locked
    ? { lockedNote: `${list.locked} more prompts are past what this plan shows: never guess them.` }
    : {};
  if (!params.promptId) return { ...list, ...locked };
  const row = list.rows.find((r) => r.promptId === params.promptId);
  if (!row) return { period, prompt: null, note: 'No Ads row this plan shows has that prompt.' };
  const [detail, facts] = await Promise.all([
    get<AdsOpportunityDetail>(`opportunities/${encodeURIComponent(row.promptId)}?${query}`),
    supabaseAdmin
      .from('brand_facts')
      .select('id, kind, value, quote, scope, brands!inner(organization_id)')
      .eq('brand_id', params.brandId)
      .eq('brands.organization_id', auth.organizationId!)
      .eq('status', 'approved')
      .is('gone_at', null)
      .order('first_seen_at'),
  ]);
  if (facts.error) throw new Error(facts.error.message);
  // The brand-wide facts and those of a place the prompt names (lib/content/fact-scope.ts).
  const approvedFacts = factsForPage(facts.data ?? [], [row.text]).map(
    ({ id, kind, value, quote, scope }) => ({ id, kind, value, quote, scope }),
  );
  return { period, ...row, ...detail, approvedFacts };
}
