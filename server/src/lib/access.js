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
 * Every brand belongs to an organization (`brands.organization_id` is not
 * null), self-hosted installs included, so a caller without one (no profile,
 * or one that left its organization) reaches no brand: 403 `not_in_workspace`.
 *
 * Brand access (BRAND-ACCESS spec §5.2, 00388): within the organization, a
 * person reaches every brand with All brands, and with Selected brands only
 * those granted to them (member_brands), as the database's can_access_brand
 * has it: an Admin always has All brands, and the demo brand is everyone's.
 * The caller's organization, role and scope are read once per request
 * (lib/request-scope.js). Everyone starts with All brands, so until someone
 * is narrowed every answer is the organization check's.
 */
import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { oncePerRequest } from './request-scope.js';

function accessError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/**
 * A resource of another organization: said in plain words, as a toast or an
 * MCP client shows it. 403, never 401, which means a bad or expired session.
 */
export const NOT_IN_WORKSPACE = "This brand isn't in your workspace";
const notInWorkspace = () => accessError(NOT_IN_WORKSPACE, 403, 'not_in_workspace');

/** A brand of the organization the person has no access to (Selected brands). */
export const NO_BRAND_ACCESS = "You don't have access to this brand";
const noBrandAccess = () => accessError(NO_BRAND_ACCESS, 403, 'no_brand_access');

/**
 * The caller's brand access: their organization and role, whether they have
 * All brands, and with Selected brands the brands granted. Read once per
 * request.
 * @param {string} userId
 * @returns {Promise<{ orgId: string|null, role: string|null, all: boolean, brandIds: Set<string> }>}
 */
export function brandAccessOf(userId) {
  return oncePerRequest(`brand-access:${userId}`, async () => {
    const profile = await readProfile(userId);
    const orgId = profile?.organization_id || null;
    const role = profile?.role ?? null;
    // An Admin always has All brands (D3); All brands is everyone's default.
    if (role === 'admin' || profile?.brand_scope !== 'selected') {
      return { orgId, role, all: true, brandIds: new Set() };
    }
    // Grants are kept within the person's organization; without one, none count.
    if (!orgId) return { orgId, role, all: false, brandIds: new Set() };
    const { data: grants, error: grantError } = await supabaseAdmin
      .from('member_brands')
      .select('brand_id')
      .eq('user_id', userId)
      .eq('organization_id', orgId);
    if (grantError) throw new Error(grantError.message);
    return { orgId, role, all: false, brandIds: new Set((grants ?? []).map((g) => g.brand_id)) };
  });
}

/**
 * Postgres' code for a column that doesn't exist, and PostgREST's for one
 * missing from its schema cache: here, a server deployed before 00388.
 */
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);
/** Postgres' code for text its column can't take: an id that isn't a uuid. */
const INVALID_TEXT = '22P02';
let warnedNoBrandScope = false;

/**
 * The caller's profile: organization, role and brand scope. Before 00388 is
 * applied there is no `brand_scope`, and everyone has All brands, as 00388
 * starts them: the profile is read without it, and that is said once.
 */
async function readProfile(userId) {
  const read = (columns) =>
    supabaseAdmin.from('profiles').select(columns).eq('id', userId).maybeSingle();
  const { data, error } = await read('organization_id, role, brand_scope');
  if (!error) return data;
  if (!MISSING_COLUMN_CODES.has(error.code)) throw new Error(error.message);
  if (!warnedNoBrandScope) {
    warnedNoBrandScope = true;
    logger.warn(
      { code: error.code, migration: '00388' },
      '[access] profiles.brand_scope is missing: everyone counts as All brands until 00388 is applied',
    );
  }
  const fallback = await read('organization_id, role');
  if (fallback.error) throw new Error(fallback.error.message);
  return fallback.data ? { ...fallback.data, brand_scope: 'all' } : null;
}

/**
 * Whether the access reaches a brand row (`id`, `organization_id`,
 * `is_demo`): 'organization' when it's another organization's, 'brand' when
 * it's the organization's but not granted, null when it does.
 */
function refusalFor(access, brand) {
  if (!access.orgId || access.orgId !== brand.organization_id) return 'organization';
  if (access.all || brand.is_demo || access.brandIds.has(brand.id)) return null;
  return 'brand';
}

const refusalError = (refusal) => (refusal === 'organization' ? notInWorkspace() : noBrandAccess());

/** Several brands' refusal: another organization's first, then one not granted. */
const firstRefusal = (refusals) =>
  refusals.find((r) => r === 'organization') ?? refusals.find((r) => r === 'brand') ?? null;

/**
 * The roles that may add prompts and topics, change settings and delete for
 * good — the admin-or-manager rule the database keeps on those tables.
 */
export const MANAGER_ROLES = Object.freeze(['admin', 'manager']);

/**
 * Assert that the caller's role is one of `roles`. The writes here bypass Row
 * Level Security, so a route the database keeps to some roles checks them
 * itself; run it after the resource's own access check, so another
 * organization's resource still reads as not found or not in the workspace.
 * @param {string} userId
 * @param {readonly string[]} roles
 * @param {string} message what the caller reads when refused (403 `forbidden`)
 * @returns {Promise<string>} the caller's role
 */
export async function assertRole(userId, roles, message) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!roles.includes(profile?.role)) throw accessError(message, 403, 'forbidden');
  return profile.role;
}

/**
 * Assert that the caller may reach `brandId`: their organization's, and with
 * Selected brands granted to them. 404 for a brand that is gone, 403
 * `not_in_workspace` for another organization's, 403 `no_brand_access` for
 * one of theirs they weren't given.
 * @param {string} brandId
 * @param {string} userId
 * @param {{ columns?: string }} [options] more of the brand's columns to return
 * @returns {Promise<{ brand: object, orgId: string, role: string|null }>}
 */
export async function assertBrandAccess(brandId, userId, { columns } = {}) {
  const { data: brand, error } = await supabaseAdmin
    .from('brands')
    .select(columns ? `id, organization_id, is_demo, ${columns}` : 'id, organization_id, is_demo')
    .eq('id', brandId)
    .maybeSingle();
  // A failed read is a failure (500), not a brand that is gone; an id that
  // can't be one (Postgres' invalid text) names no brand.
  if (error && error.code !== INVALID_TEXT) throw new Error(error.message);

  if (!brand) {
    throw accessError('Brand not found', 404);
  }

  const access = await brandAccessOf(userId);
  const refusal = refusalFor(access, brand);
  if (refusal) throw refusalError(refusal);

  return { brand, orgId: access.orgId, role: access.role };
}

/**
 * Assert that the caller has All brands: for what lists the whole
 * organization's at once (a connected account's properties) and so would
 * show a Selected-brands person the brands they weren't given.
 * @returns {Promise<{ orgId: string|null, role: string|null }>}
 */
export async function assertAllBrands(userId) {
  const access = await brandAccessOf(userId);
  if (!access.all) throw noBrandAccess();
  return { orgId: access.orgId, role: access.role };
}

/**
 * Assert that every content opportunity in `ids` belongs to the caller's org.
 * Ignores ids that don't exist (they simply aren't acted on); throws 403 if any
 * matched opportunity belongs to another org.
 * @returns {Promise<object[]>} the matched opportunity rows (`id`, `brand_id`)
 */
export async function assertOpportunitiesAccess(ids, userId) {
  const access = await brandAccessOf(userId);

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
    .select('id, organization_id, is_demo')
    .in('id', brandIds);

  const brandById = new Map((brands || []).map((b) => [b.id, b]));
  const refusals = opps.map((o) => {
    const brand = brandById.get(o.brand_id);
    return brand ? refusalFor(access, brand) : 'organization';
  });
  const refusal = firstRefusal(refusals);
  if (refusal) throw refusalError(refusal);

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
 * Assert that every prompt in `promptIds` belongs to a brand the caller may
 * reach, resolved through prompts -> prompt_sets -> brands.
 * @returns {Promise<object[]>} the matched prompt rows, each with
 *   prompt_sets.brand_id and prompt_sets.brands.organization_id
 */
export async function assertPromptAccess(promptIds, userId) {
  const ids = Array.isArray(promptIds) ? promptIds : [promptIds];
  const access = await brandAccessOf(userId);

  const { data: rows } = await supabaseAdmin
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id, brands!inner(organization_id, is_demo))')
    .in('id', ids);

  if (!rows || rows.length < new Set(ids).size) {
    throw accessError('Prompt not found', 404);
  }

  const refusals = rows.map((r) =>
    refusalFor(access, {
      id: r.prompt_sets?.brand_id,
      organization_id: r.prompt_sets?.brands?.organization_id,
      is_demo: r.prompt_sets?.brands?.is_demo,
    }),
  );
  const refusal = firstRefusal(refusals);
  if (refusal) throw refusalError(refusal);

  return rows;
}
