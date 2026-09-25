/**
 * What a brand actually has to work with (#818, phase 4).
 *
 * A definition declares the data it needs; this module answers whether a
 * given brand has it. Today that answer only gates generation — a brand with
 * no analytics connection is not offered the traffic definition — but the
 * same answer is what phase 5's task planner needs in order to give two
 * brands different plans for the same action kind, so it is computed once
 * here rather than inferred twice.
 *
 * Deliberately coarse. "Does this brand have competitors configured" is a
 * stable fact about the workspace; "are there competitor rows in the last
 * seven days" is a detector's question, and detectors already ask it.
 */

import supabaseAdmin from '../../config/supabase.js';

/**
 * Every source a definition may declare. Validation rejects anything else,
 * so a typo in a definition file fails at load rather than silently making
 * that definition ineligible for every brand forever.
 */
export const SOURCES = Object.freeze([
  /** Our own prompt tracking. Every brand has it — a brand without it is not
   *  a brand yet — so it is the source a definition declares when it needs
   *  nothing beyond what the product collects by itself. */
  'tracking',
  /** Competitors configured on the brand. */
  'competitors',
  /** Site Audit runs. */
  'site_audits',
  /** An analytics integration connected for the brand's organization. */
  'analytics',
]);

/**
 * The sources available to one brand.
 *
 * @param {string} brandId
 * @returns {Promise<Set<string>>}
 */
export async function resolveBrandSources(brandId) {
  const available = new Set(['tracking']);

  const [competitors, audits, brand] = await Promise.all([
    supabaseAdmin.from('competitors').select('id').eq('brand_id', brandId).limit(1),
    supabaseAdmin.from('site_audits').select('id').eq('brand_id', brandId).limit(1),
    supabaseAdmin.from('brands').select('organization_id').eq('id', brandId).limit(1),
  ]);

  if (competitors.error) throw new Error(competitors.error.message);
  if (audits.error) throw new Error(audits.error.message);
  if (brand.error) throw new Error(brand.error.message);

  if ((competitors.data ?? []).length > 0) available.add('competitors');
  if ((audits.data ?? []).length > 0) available.add('site_audits');

  // Integrations are connected per organization, not per brand: every brand
  // in a workspace sees the same analytics connection.
  const organizationId = (brand.data ?? [])[0]?.organization_id;
  if (organizationId) {
    const { data, error } = await supabaseAdmin
      .from('integration_connections')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('provider', 'google-analytics')
      .eq('status', 'connected')
      .limit(1);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) available.add('analytics');
  }

  return available;
}
