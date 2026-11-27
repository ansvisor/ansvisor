import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { readCampaigns } from './campaigns.js';
import { OPEN_ROWS, readAdsSettings, readsEveryOpportunity } from './opportunities.js';
import { sumSpend } from './paid.js';
import { ADS_PERIODS, readStanding } from './standing.js';

/**
 * Ads' Overview (ADS-01 §3.1, §9.2) over every buying-intent prompt, on every
 * plan: Starter and the trial see it whole (§8), and `locked` counts the
 * Opportunities rows past theirs.
 *
 * - bar: each prompt in one part, so the parts add up to `total`. Until our
 *   Google spend is measured (a Google account read, paid.js), the paid
 *   parts are null: earned or neither.
 * - spend: what the brand paid on Google for the matched search terms, per
 *   currency: on prompts AI already cites it for (`overlap`, Earned + paid),
 *   on all matched prompts (`matched`), and on terms no prompt matched
 *   (`unmatched`); null until measured.
 * - paidSov: null until sponsored units are captured.
 * - signups: the period's AI-assisted signups from the snippet's conversions
 *   (brand_ai_conversions, 00288); null with conversions off or unread.
 * - cost: the period's ad spend on every read account (Google and ChatGPT
 *   campaigns, per currency) and, in one currency with signups, the cost
 *   per AI-assisted signup; null until an ad account of the brand is read.
 */
export async function readOverview({ brand, orgId, period, now = new Date() }) {
  const { thresholds } = await readAdsSettings(orgId);
  // Reads the brand within the organization first: not found otherwise.
  const standing = { brandId: brand.id, orgId, period, thresholds, now };
  const { rows, notAnalysed, paid } = await readStanding(standing);
  const [everyRow, signups, adSpend] = await Promise.all([
    readsEveryOpportunity(orgId, brand),
    readSignups(brand.id, period),
    readAdSpend(orgId, brand.id, period, now),
  ]);

  const paidMeasured = rows.length > 0 && rows.every((r) => r.standing.wePay !== null);
  const bar = { earned: 0, earnedPaid: 0, paidOnly: 0, neither: 0 };
  for (const { standing: s } of rows) {
    const pays = paidMeasured && s.wePay;
    bar[s.weCited ? (pays ? 'earnedPaid' : 'earned') : pays ? 'paidOnly' : 'neither'] += 1;
  }
  return {
    period,
    total: rows.length,
    notAnalysed,
    locked: everyRow ? 0 : Math.max(0, rows.length - OPEN_ROWS),
    paidMeasured,
    bar: paidMeasured ? bar : { ...bar, earnedPaid: null, paidOnly: null },
    spend: paidMeasured
      ? {
          overlap: sumSpend(
            rows.filter((r) => r.standing.weCited && r.paid).map((r) => r.paid.spend),
          ),
          matched: sumSpend(rows.map((r) => r.paid?.spend)),
          unmatched: paid?.unmatched ?? [],
        }
      : null,
    paidSov: null,
    signups,
    cost: costPerSignup(adSpend, signups),
  };
}

/**
 * The period's spend on the brand's read ad accounts, per currency (the
 * Campaigns tab's own read); null with no account read yet, or when it
 * can't be read: the card then says Not measured, never a number.
 */
async function readAdSpend(orgId, brandId, period, now) {
  try {
    const { accounts, campaigns } = await readCampaigns({ orgId, brandId, period }, { now });
    if (!accounts.some((a) => a.syncedThrough && a.status !== 'disconnected')) return null;
    return sumSpend(campaigns.map((c) => [{ currencyCode: c.currencyCode, amount: c.spend }]));
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[ads] ad spend unread');
    return null;
  }
}

/**
 * The cost per AI-assisted signup: the spend divided by the signups, only
 * in one currency (never added across currencies) and with at least one
 * signup; otherwise null, and `spend` says what was spent.
 */
export function costPerSignup(spend, signups) {
  if (!spend) return null;
  const one = spend.length === 1 ? spend[0] : null;
  const perSignup =
    one && typeof signups === 'number' && signups > 0
      ? { currencyCode: one.currencyCode, amount: Math.round((one.amount / signups) * 100) / 100 }
      : null;
  return { spend, perSignup };
}

async function readSignups(brandId, period) {
  const { data, error } = await supabaseAdmin.rpc('brand_ai_conversions', {
    p_brand_id: brandId,
    p_days: ADS_PERIODS[period] ?? ADS_PERIODS['30d'],
  });
  if (error) logger.warn({ brandId, err: error.message }, '[ads] AI-assisted signups unread');
  if (error || !data?.enabled) return null;
  return Number(data.goals?.find((g) => g.goal === 'signup')?.count ?? 0);
}
