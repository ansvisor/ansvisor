import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { OPEN_ROWS, readAdsSettings, readsEveryOpportunity } from './opportunities.js';
import { ADS_PERIODS, readStanding } from './standing.js';

/**
 * Ads' Overview (ADS-01 §3.1, §9.2) over every buying-intent prompt, on every
 * plan: Starter and the trial see it whole (§8), and `locked` counts the
 * Opportunities rows past theirs.
 *
 * - bar: each prompt in one part, so the parts add up to `total`. Until our
 *   sponsored ads are measured, the paid parts are null: earned or neither.
 * - paidSov: null until sponsored units are captured.
 * - signups: the period's AI-assisted signups from the snippet's conversions
 *   (brand_ai_conversions, 00288); null with conversions off or unread.
 */
export async function readOverview({ brand, orgId, period, now = new Date() }) {
  const { thresholds } = await readAdsSettings(orgId);
  // Reads the brand within the organization first: not found otherwise.
  const standing = { brandId: brand.id, orgId, period, thresholds, now };
  const { rows, notAnalysed } = await readStanding(standing);
  const [everyRow, signups] = await Promise.all([
    readsEveryOpportunity(orgId, brand),
    readSignups(brand.id, period),
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
    paidSov: null,
    signups,
  };
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
