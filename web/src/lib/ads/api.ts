import { BROWSER_API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/client';
import type { AdsPeriod } from './tabs';

/**
 * Ads' reads from the API server (server/src/routes/ads.js), with the
 * person's session as a bearer token, through the same-origin proxy, as the
 * AI usage meter reads (lib/billing/ai-usage-client.ts): never a server
 * action, which Next runs one at a time behind the page's others.
 */

/** A read that hangs gives up after this, so the page can say so. */
const READ_TIMEOUT_MS = 30_000;

/**
 * The Overview (GET /api/ads/overview, server lib/ads/overview.js), over
 * every buying-intent prompt, for every plan. Null is "not measured", never 0.
 */
export interface AdsOverview {
  period: AdsPeriod;
  /** Buying-intent prompts: the bar's parts add up to it. */
  total: number;
  /** Prompts whose intent isn't analysed yet, so not counted either way. */
  notAnalysed: number;
  /** Opportunities' rows past the plan's (Starter, the trial), from the server. */
  locked: number;
  /** Our sponsored ads are measured: until then the paid parts are null. */
  paidMeasured: boolean;
  bar: {
    earned: number;
    earnedPaid: number | null;
    paidOnly: number | null;
    neither: number;
  };
  paidSov: number | null;
  /** The period's AI-assisted signups; null with conversions off or unread. */
  signups: number | null;
}

export async function readAdsOverview(brandId: string, period: AdsPeriod): Promise<AdsOverview> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const query = new URLSearchParams({ brandId, period });
  const res = await fetch(`${BROWSER_API_BASE_URL}/api/ads/overview?${query}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ads Overview: ${res.status}`);
  return (await res.json()) as AdsOverview;
}
