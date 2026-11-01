import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Brand access on the web's server paths (BRAND-ACCESS §5.3, 00388): Chat
 * and its agents, then MCP (PR 10) and the admin paths (PR 11). One Account
 * holds several brands, and a person has All brands or Selected brands.
 * Within their organization an Admin and All-brands people reach every
 * brand, a Selected-brands person the brands shared with them
 * (member_brands), and everyone the demo brand (00380, sample data): the
 * database's can_access_brand, which canAccessBrand asks, and which
 * readBrandAccess reads from the same tables, as the API server's
 * lib/access.js does. Everyone starts with All brands, so until the Team
 * screen narrows someone every answer is the organization's.
 *
 * Read fresh on each call, with the service role: access taken away counts
 * from the next call. Before 00388 there is no brand_scope and everyone has
 * All brands, as 00388 starts them. Server only.
 */

/** The brands a person may use: all of their organization's, or these ids (the demo brand's with them). */
export type BrandAccess = 'all' | readonly string[];

/** A profile as brand access reads it. */
export interface AccessProfile {
  role: string | null;
  organization_id: string | null;
  /** 'all' or 'selected'; before 00388 there is none, which is All brands. */
  brand_scope?: string | null;
}

/** A column that isn't there: Postgres' code, and PostgREST's for its schema cache. */
const MISSING_COLUMN = new Set(['42703', 'PGRST204']);
/** A function that isn't there: PostgREST doesn't know it, or Postgres doesn't. */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);
let warnedNoBrandScope = false;

const uuid = z.guid();

/**
 * A person's role, organization and brand scope; null without a profile.
 * Before 00388 the profile is read without the scope, as All brands (said
 * once). A read that fails throws: no access is decided on missing facts.
 */
export async function readAccessProfile(userId: string): Promise<AccessProfile | null> {
  const read = (columns: string) =>
    supabaseAdmin.from('profiles').select(columns).eq('id', userId).maybeSingle();
  const withScope = await read('role, organization_id, brand_scope');
  if (!withScope.error) return withScope.data as AccessProfile | null;
  if (!MISSING_COLUMN.has(withScope.error.code)) {
    throw new Error(`Could not read brand access: ${withScope.error.message}`);
  }
  if (!warnedNoBrandScope) {
    warnedNoBrandScope = true;
    console.warn(
      '[brand-access] profiles.brand_scope is missing: everyone counts as All brands until 00388 is applied',
    );
  }
  const without = await read('role, organization_id');
  if (without.error) throw new Error(`Could not read brand access: ${without.error.message}`);
  const profile = without.data as AccessProfile | null;
  return profile ? { ...profile, brand_scope: 'all' } : null;
}

/** All brands: an Admin always (D3), and everyone not narrowed to Selected brands. */
export function hasAllBrands(profile: AccessProfile): boolean {
  return profile.role === 'admin' || profile.brand_scope !== 'selected';
}

/**
 * The access of the person whose profile this is, in an organization: null
 * when they aren't one of its members (no profile, none, or another one).
 * With Selected brands, the brands shared with them there and the demo
 * brand, read now.
 */
export async function brandAccessOf(
  profile: AccessProfile | null,
  userId: string,
  organizationId: string,
): Promise<BrandAccess | null> {
  if (!profile?.organization_id || profile.organization_id !== organizationId) return null;
  if (hasAllBrands(profile)) return 'all';
  const [grants, demo] = await Promise.all([
    supabaseAdmin
      .from('member_brands')
      .select('brand_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId),
    supabaseAdmin
      .from('brands')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_demo', true),
  ]);
  if (grants.error) throw new Error(`Could not read brand access: ${grants.error.message}`);
  if (demo.error) throw new Error(`Could not read brand access: ${demo.error.message}`);
  return [
    ...new Set([
      ...((grants.data ?? []) as { brand_id: string }[]).map((g) => g.brand_id),
      ...((demo.data ?? []) as { id: string }[]).map((b) => b.id),
    ]),
  ];
}

/**
 * The brands a person may use in an organization now: 'all', the ids of
 * the ones they may (Selected brands), or null when they aren't a member
 * of it, who may use none.
 */
export async function readBrandAccess(
  userId: string,
  organizationId: string,
): Promise<BrandAccess | null> {
  return brandAccessOf(await readAccessProfile(userId), userId, organizationId);
}

/**
 * Whether the access reaches a brand of the organization it was read for.
 * 'all' says nothing of another organization's brand: find the brand in
 * the organization first. Null (not a member) reaches none.
 */
export function hasBrandAccess(access: BrandAccess | null, brandId: string): boolean {
  return access === 'all' || (access !== null && access.includes(brandId));
}

/** The brands of the organization's `brands` that the access reaches, in their order. */
export function allowedBrands<T extends { id: string }>(
  access: BrandAccess | null,
  brands: readonly T[],
): T[] {
  return brands.filter((brand) => hasBrandAccess(access, brand.id));
}

/**
 * Whether a person may see a brand now: their organization's, and they are
 * an Admin, have All brands, have it shared or it is the demo brand (the
 * database's can_access_brand, asked with the service role). With
 * `organizationId`, the brand must be that organization's too (the
 * workspace a run or a key acts in). An id that isn't one, or a brand
 * that isn't there, is no one's. A read that fails throws.
 */
export async function canAccessBrand(
  userId: string,
  brandId: string,
  organizationId?: string,
): Promise<boolean> {
  if (!uuid.safeParse(brandId).success) return false;
  const [brand, access] = await Promise.all([
    organizationId
      ? supabaseAdmin
          .from('brands')
          .select('id')
          .eq('id', brandId)
          .eq('organization_id', organizationId)
          .maybeSingle()
      : null,
    supabaseAdmin.rpc('can_access_brand', { p_brand_id: brandId, p_user_id: userId }),
  ]);
  if (brand?.error) throw new Error(`Could not read the brand: ${brand.error.message}`);
  if (brand && !brand.data) return false;
  if (!access.error) return access.data === true;
  if (!MISSING_FUNCTION.has(access.error.code ?? '')) {
    throw new Error(`Could not read the brand's access: ${access.error.message}`);
  }
  // Before 00388 everyone has All brands: a brand of the person's organization.
  const [profile, row] = await Promise.all([
    readAccessProfile(userId),
    supabaseAdmin.from('brands').select('organization_id').eq('id', brandId).maybeSingle(),
  ]);
  if (row.error) throw new Error(`Could not read the brand: ${row.error.message}`);
  const org = (row.data as { organization_id: string } | null)?.organization_id;
  return !!org && profile?.organization_id === org;
}
