import { API_BASE_URL } from '@/config/api';
import type {
  AdsOpportunities,
  AdsOpportunity,
  AdsOpportunityDetail,
  AdsOverview,
} from '@/lib/ads/api';
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

/** A read of /api/ads as the run's person; null for a path the server refuses (403, 404). */
type AdsRead = <T>(path: string) => Promise<T | null>;

/**
 * Runs `readWith` with the run's person's way to /api/ads, for a brand in
 * their scope: null outside it, and the server's refusal of the way said in
 * their words.
 */
async function withAds<R>(
  auth: McpAuthContext,
  brandId: string,
  readWith: (get: AdsRead) => Promise<R>,
): Promise<R | { note: string } | null> {
  if (!(await brandAllowed(auth, brandId))) return null;
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
    return await readWith(get);
  } catch (err) {
    // The server took no one to act as, or Chat is off: said in the person's words.
    const refused = actingRefusalOf(err);
    if (refused) return { note: refused.message };
    throw err;
  }
}

export function getAdsOpportunitiesFor(
  auth: McpAuthContext,
  params: { brandId: string; promptId?: string; period?: AdsPeriod },
) {
  return withAds(auth, params.brandId, (get) => readAds(auth, params, get));
}

/** One prompt where Google spend matched, as the overlap read gives it. */
function paidPrompt(row: AdsOpportunity) {
  const paid = row.paid!;
  return {
    promptId: row.promptId,
    text: row.text,
    decision: row.decision,
    recommended: row.recommended,
    leaderName: row.leader === 'us' ? 'you' : row.leaderName,
    ourPosition: row.ourPosition,
    weCited: row.weCited,
    volume: row.volume,
    spend: paid.spend,
    clicks: paid.clicks,
    conversions: paid.conversions,
    termCount: paid.termCount,
    terms: paid.terms,
  };
}

/** The largest amount first: amounts in different currencies are never added. */
const bySpend = (a: { spend: { amount: number }[] }, b: { spend: { amount: number }[] }) =>
  (b.spend[0]?.amount ?? 0) - (a.spend[0]?.amount ?? 0);

/**
 * Chat's read of paid overlap (Ads Phase 1 P3, get_ads_paid_overlap): what
 * the brand paid on Google for search terms matched to its buying-intent
 * prompts (server lib/ads/paid.js), from the Overview's totals and the
 * Opportunities rows the person's plan shows, as the run's person:
 *
 *  - overlap: prompts AI already cites the brand for, where it also pays;
 *  - paidOnly: prompts it pays for and AI doesn't cite it on.
 *
 * Until a Google Ads account is read, `measured` is false and nothing is a
 * number. ChatGPT Ads spend isn't matched to prompts. Null for a brand
 * outside their scope.
 */
export function getAdsPaidOverlapFor(
  auth: McpAuthContext,
  params: { brandId: string; period?: AdsPeriod },
) {
  return withAds(auth, params.brandId, async (get) => {
    const period = params.period ?? DEFAULT_ADS_PERIOD;
    const query = new URLSearchParams({ brandId: params.brandId, period });
    const [overview, list] = await Promise.all([
      get<AdsOverview>(`overview?${query}`),
      get<AdsOpportunities>(`opportunities?${query}`),
    ]);
    if (!overview || !list) return null;
    const notes = {
      chatgptNote:
        "ChatGPT Ads spend isn't matched to prompts: ChatGPT Ads don't say which question an ad showed on. Campaign totals are on Ads › Campaigns.",
      ...(list.locked
        ? {
            lockedNote: `${list.locked} more prompts are past what this plan shows: never guess them. The spend totals cover every prompt.`,
          }
        : {}),
    };
    if (!overview.spend) {
      return {
        period,
        measured: false,
        note: "Google spend isn't measured: no Google Ads account of this brand has been read yet (Ads › Connections). Never guess spend, cost per click or savings.",
        ...notes,
      };
    }
    const paid = list.rows.filter((r) => r.paid);
    return {
      period,
      measured: true,
      spend: overview.spend,
      bar: overview.bar,
      total: overview.total,
      overlap: paid
        .filter((r) => r.weCited)
        .map(paidPrompt)
        .sort(bySpend),
      paidOnly: paid
        .filter((r) => !r.weCited)
        .map(paidPrompt)
        .sort(bySpend),
      ...notes,
    };
  });
}

async function readAds(
  auth: McpAuthContext,
  params: { brandId: string; promptId?: string; period?: AdsPeriod },
  get: AdsRead,
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
