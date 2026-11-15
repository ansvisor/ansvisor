import { API_BASE_URL } from '@/config/api';
import type { AdsOpportunities, AdsOpportunityDetail } from '@/lib/ads/api';
import { DEFAULT_ADS_PERIOD, type AdsPeriod } from '@/lib/ads/tabs';
import { factsForPage } from '@/lib/content/fact-scope';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { brandAllowed } from './data';

/**
 * Chat's read of Ads (Ads Phase 0 PR 15, get_ads_opportunities): the
 * Opportunities rows and one prompt's drawer, from the API server's /api/ads
 * routes the page reads (lib/ads/api.ts), as the signed-in person, so the
 * server decides what their plan shows (Starter's and the trial's first
 * rows, and how many more are `locked`) and that they reach the brand. One
 * prompt's read adds the approved facts its ads may state, with the ids
 * save_ad_drafts' claims name, read by the brand and its organization. It
 * needs the person's own session. Null for a brand outside their scope.
 */
export async function getAdsOpportunitiesFor(
  auth: McpAuthContext,
  params: { brandId: string; promptId?: string; period?: AdsPeriod },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const {
    data: { session },
  } = await (await createClient()).auth.getSession();
  if (session?.user.id !== auth.userId) {
    return { note: 'Ads is read as the person signed in, and this run has no session of theirs.' };
  }
  // A brand or prompt the server refuses (another workspace's, past the plan's rows) is null.
  const get = async <T>(path: string): Promise<T | null> => {
    const res = await fetch(`${API_BASE_URL}/api/ads/${path}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new Error(`Ads ${path.split('?')[0]}: ${res.status}`);
    return (await res.json()) as T;
  };
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
