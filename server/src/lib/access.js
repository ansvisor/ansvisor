/**
 * Resource ownership guards for authenticated `/api` routes.
 *
 * All DB access in this server goes through `supabaseAdmin`, which bypasses
 * Row Level Security. That means a route that takes a `:brandId` / `:id` /
 * `:jobId` and queries by it directly will happily return (or mutate) another
 * organization's data unless it first checks that the resource belongs to the
 * caller's org. These helpers centralize that check.
 *
 * Each helper throws an Error tagged with `.status` (404 / 403) so route
 * handlers can do `const status = error.status || 500` in their catch block —
 * the same pattern already used in routes/prompts.js.
 *
 * Org comparison is intentionally a plain `!==` rather than rejecting a null
 * org. In self-hosted single-tenant setups there may be no organization row,
 * so both the profile and the resource carry `organization_id = null`; a strict
 * "reject when org is null" guard would lock those installs out. In cloud mode
 * every org has a non-null id, so cross-tenant access is still blocked.
 */
import supabaseAdmin from '../config/supabase.js';
import { getOrgIdForUser } from './plan-guard.js';

function accessError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Assert that `brandId` belongs to the caller's organization.
 * @returns {Promise<{ brand: object, orgId: string|null }>}
 */
export async function assertBrandAccess(brandId, userId) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id')
    .eq('id', brandId)
    .single();

  if (!brand) {
    throw accessError('Brand not found', 404);
  }

  const orgId = await getOrgIdForUser(userId);
  if (orgId !== brand.organization_id) {
    throw accessError('Unauthorized', 403);
  }

  return { brand, orgId };
}

/**
 * Assert that every content opportunity in `ids` belongs to the caller's org.
 * Ignores ids that don't exist (they simply aren't acted on); throws 403 if any
 * matched opportunity belongs to another org.
 * @returns {Promise<object[]>} the matched opportunity rows (`id`, `brand_id`)
 */
export async function assertOpportunitiesAccess(ids, userId) {
  const userOrg = await getOrgIdForUser(userId);

  const { data: opps } = await supabaseAdmin
    .from('content_opportunities')
    .select('id, brand_id')
    .in('id', ids);

  if (!opps || opps.length === 0) {
    throw accessError('No opportunities found', 404);
  }

  const brandIds = [...new Set(opps.map((o) => o.brand_id))];
  const { data: brands } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id')
    .in('id', brandIds);

  const orgByBrand = new Map((brands || []).map((b) => [b.id, b.organization_id]));
  const allOwned = opps.every((o) => orgByBrand.get(o.brand_id) === userOrg);
  if (!allOwned) {
    throw accessError('Unauthorized', 403);
  }

  return opps;
}

/**
 * Assert that a single content opportunity belongs to the caller's org.
 * @returns {Promise<object>} the opportunity row (`select *`)
 */
export async function assertOpportunityAccess(id, userId) {
  const { data: opp } = await supabaseAdmin
    .from('content_opportunities')
    .select('*')
    .eq('id', id)
    .single();

  if (!opp) {
    throw accessError('Opportunity not found', 404);
  }

  await assertBrandAccess(opp.brand_id, userId);
  return opp;
}

/**
 * Assert that every prompt in `promptIds` belongs to the caller's org,
 * resolved through prompts -> prompt_sets -> brands.
 * @returns {Promise<object[]>} the matched prompt rows
 */
export async function assertPromptAccess(promptIds, userId) {
  const ids = Array.isArray(promptIds) ? promptIds : [promptIds];
  const userOrg = await getOrgIdForUser(userId);

  const { data: rows } = await supabaseAdmin
    .from('prompts')
    .select('id, prompt_sets!inner(brands!inner(organization_id))')
    .in('id', ids);

  if (!rows || rows.length < new Set(ids).size) {
    throw accessError('Prompt not found', 404);
  }

  const allOwned = rows.every((r) => r.prompt_sets?.brands?.organization_id === userOrg);
  if (!allOwned) {
    throw accessError('Unauthorized', 403);
  }

  return rows;
}
