import supabaseAdmin from '../config/supabase.js';
import { assertAllBrands, assertEveryBrand, brandAccessOf } from './access.js';
import { signInBrandIds } from './brand-integrations.js';

/**
 * Who may reach a brand's sign-in (BRAND-ACCESS §5.2), for the routes that
 * read or change one: Google's (routes/integrations.js) and HubSpot's
 * (routes/hubspot.js, #2140).
 */

/**
 * Assert that the caller may read through a sign-in. A sign-in reads the data
 * of every brand that uses it (a Google login lists their properties), so the
 * caller needs each of those brands; before 00470, when the sign-in is the
 * Account's row, All brands.
 * @param {string} userId
 * @param {{ accountId: string|null }} connection
 */
export async function assertSignInReach(userId, connection) {
  const brandIds = await signInBrandIds(connection);
  if (brandIds === null) return assertAllBrands(userId);
  return assertEveryBrand(brandIds, userId);
}

/** The ids of the organization's brands the person can access. */
export async function reachableBrandIds(userId, organizationId) {
  const access = await brandAccessOf(userId);
  if (!access.all) return [...access.brandIds];
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('organization_id', organizationId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => b.id);
}
