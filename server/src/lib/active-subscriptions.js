/**
 * Which organizations the paid nightly work may still run for (2026-10-27).
 *
 * On the cloud, an organization whose free trial ended or whose plan was
 * cancelled is read-only: its people can look around, and the nightly
 * database-only upkeep (rollups, counters, retention) still runs for it, but
 * nothing that costs: no tracking, no AI, no agent, no scraping, no sync
 * with an outside service. Those sweeps, and the job recovery, keep to the
 * ids these let through, as webflow-status.js and brand-facts-sweep.js
 * already did.
 *
 * Self-hosted, everything is let through (billing doesn't apply), and
 * nothing is read.
 */

import supabaseAdmin from '../config/supabase.js';
import { isCloud, isSubscriptionActive } from '../config/plans.js';
import { selectInChunks } from './chunked-in.js';

/**
 * The subscription statuses isSubscriptionActive takes as active, for a
 * filter in a query (`.in(...)`); kept equal to it by a test.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

const everyone = () => true;

function uniqueIds(ids) {
  return [...new Set((ids ?? []).filter(Boolean))];
}

/**
 * A test for the ids among `orgIds`: whether the organization has an active
 * or trialing subscription. Throws when the organizations can't be read: a
 * sweep that can't tell runs for nobody.
 *
 * @param {string[]} orgIds
 * @returns {Promise<(orgId: string) => boolean>}
 */
export async function activeOrgFilter(orgIds) {
  if (!isCloud()) return everyone;
  const ids = uniqueIds(orgIds);
  if (ids.length === 0) return () => false;
  const { data, error } = await selectInChunks(ids, (chunk) =>
    supabaseAdmin.from('organizations').select('id, subscription_status').in('id', chunk),
  );
  if (error) throw new Error(`organizations read: ${error.message}`);
  const active = new Set(
    (data ?? [])
      .filter((org) => isSubscriptionActive(org.subscription_status))
      .map((org) => org.id),
  );
  return (orgId) => active.has(orgId);
}

/**
 * A test for the ids among `brandIds`: whether the brand's organization has
 * an active or trialing subscription. Throws when the brands can't be read.
 *
 * @param {string[]} brandIds
 * @returns {Promise<(brandId: string) => boolean>}
 */
export async function activeBrandFilter(brandIds) {
  if (!isCloud()) return everyone;
  const ids = uniqueIds(brandIds);
  if (ids.length === 0) return () => false;
  const { data, error } = await selectInChunks(ids, (chunk) =>
    supabaseAdmin.from('brands').select('id, organizations(subscription_status)').in('id', chunk),
  );
  if (error) throw new Error(`brands read: ${error.message}`);
  const active = new Set(
    (data ?? [])
      .filter((brand) => isSubscriptionActive(brand.organizations?.subscription_status))
      .map((brand) => brand.id),
  );
  return (brandId) => active.has(brandId);
}

/**
 * Whether one organization has an active or trialing subscription (always,
 * self-hosted): for a route that reads what is kept instead of starting a
 * read that costs.
 *
 * @param {string} orgId
 * @returns {Promise<boolean>}
 */
export async function isOrgActive(orgId) {
  return (await activeOrgFilter([orgId]))(orgId);
}
