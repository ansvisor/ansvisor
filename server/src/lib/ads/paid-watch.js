import supabaseAdmin from '../../config/supabase.js';
import { adsThresholds } from '../../config/ads.js';
import { readAdsSettings } from './opportunities.js';
import { readStanding } from './standing.js';

/**
 * Paid watch (Ads Phase 1 P4): buying-intent prompts where AI already picks
 * the brand and its Google spend on the matched search terms is rising, for
 * the nightly signals pass (signals/library/detect.js, kind paid_overlap).
 * It opens an Action Center suggestion to review those ads; nothing changes
 * in an ad account.
 *
 * - AI picks the brand: it leads the answer, or AI names it within the
 *   workspace's lead position (config/ads.js leadPosition), as the
 *   earn-or-pay rule reads it.
 * - Rising: in the last 30 days the prompt had at least MIN_CLICKS clicks,
 *   and its spend in its first currency grew by RISE_RATIO or more on the 30
 *   days before (or was nothing then), matched over the same prompts
 *   (standing.js paidBefore). Amounts in different currencies are never
 *   compared.
 * - Whether competitors pay isn't measured yet, so "no ads where competitors
 *   are sponsored" isn't raised.
 *
 * Read by the brand and its organization: the organization is the brand's
 * own Google account's, never anything a model gave.
 */

export const WINDOW_DAYS = 30;
/** Spend at least this many times the 30 days before counts as rising. */
export const RISE_RATIO = 1.2;
/** Fewer clicks than this in the window is too little to call a trend. */
export const MIN_CLICKS = 10;

/** The amount in `currency` of a spend list, or 0. */
const amountIn = (spend, currency) =>
  (spend ?? []).find((s) => s.currencyCode === currency)?.amount ?? 0;

/**
 * Whether a prompt's spend is rising: enough clicks, and its first
 * currency's amount up by RISE_RATIO on the period before.
 */
export function spendRising(current, previous) {
  if (!current || current.clicks < MIN_CLICKS || current.spend.length === 0) return false;
  const { currencyCode, amount } = current.spend[0];
  const before = amountIn(previous?.spend, currencyCode);
  return amount > 0 && (before === 0 || amount >= before * RISE_RATIO);
}

/** The brand's organization, from one of its read Google Ads accounts; null with none. */
async function googleAdsOrg(brandId, db) {
  const { data, error } = await db
    .from('ads_accounts')
    .select('organization_id')
    .eq('brand_id', brandId)
    .eq('platform', 'google')
    .in('status', ['active', 'error'])
    .not('synced_through', 'is', null)
    .limit(1);
  if (error) throw new Error(`ads_accounts read: ${error.code ?? 'error'}`);
  return data?.[0]?.organization_id ?? null;
}

/**
 * The prompts AI picks the brand for whose Google spend is rising, the
 * costliest first; [] with no read Google account.
 *
 * @returns {Promise<Array<{ promptId: string, text: string,
 *   spend: Array<{ currencyCode: string | null, amount: number }>,
 *   previousSpend: Array<{ currencyCode: string | null, amount: number }>,
 *   clicks: number, terms: string[] }>>}
 */
export async function readPaidWatch(brandId, { now = new Date(), db = supabaseAdmin } = {}) {
  const orgId = await googleAdsOrg(brandId, db);
  if (!orgId) return [];
  const { thresholds } = await readAdsSettings(orgId);
  const { leadPosition } = adsThresholds(thresholds);
  const { rows, paid } = await readStanding({
    brandId,
    orgId,
    period: `${WINDOW_DAYS}d`,
    thresholds,
    now,
    paidBefore: true,
  });
  if (!paid?.measured) return [];
  return rows
    .filter(
      (r) =>
        r.paid &&
        (r.standing.leader === 'us' ||
          (r.standing.ourPosition != null && r.standing.ourPosition <= leadPosition)) &&
        spendRising(r.paid, r.paidBefore),
    )
    .map((r) => ({
      promptId: r.promptId,
      text: r.text,
      spend: r.paid.spend,
      previousSpend: r.paidBefore?.spend ?? [],
      clicks: r.paid.clicks,
      terms: r.paid.terms.slice(0, 3).map((t) => t.term),
    }))
    .sort((a, b) => (b.spend[0]?.amount ?? 0) - (a.spend[0]?.amount ?? 0));
}
