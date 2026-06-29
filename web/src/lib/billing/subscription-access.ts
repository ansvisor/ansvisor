import type { TeamRole } from '@/components/providers/role-provider';

// Type-only reference to the server client — no runtime import, so this helper
// stays free of server-module coupling.
type ServerSupabase = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

export type SubscriptionAccess =
  | { state: 'ok' }
  | { state: 'needs_payment' }
  | { state: 'blocked'; ownerName: string | null };

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Decide what an authenticated, onboarded org member may do when their org's
 * subscription is not active.
 *
 *   - active / trialing      → 'ok'              (full access)
 *   - inactive + admin       → 'needs_payment'   (admins, incl. the owner, can renew)
 *   - inactive + non-admin   → 'blocked'         (manager / analyst / agency_partner
 *                                                 can't pay or re-onboard — they get a
 *                                                 "contact your account owner" notice)
 *
 * This is the fix for the trial-ended invited-member case: previously *every*
 * member was redirected into the onboarding wizard when the subscription
 * lapsed, so a non-owner saw the payment screen and could walk back to step 1
 * and re-create the brand / competitors on an already-set-up org.
 *
 * "Owner" is the org's first admin; we surface their name in the blocked
 * message so a member knows who to contact. The lookup uses the caller's RLS
 * client, so if it can't read the owner's row the message simply falls back to
 * a generic wording (never throws).
 */
export async function evaluateSubscriptionAccess(
  supabase: ServerSupabase,
  organizationId: string,
  role: TeamRole,
  subscriptionStatus: string | null,
): Promise<SubscriptionAccess> {
  if (subscriptionStatus && ACTIVE_STATUSES.has(subscriptionStatus)) {
    return { state: 'ok' };
  }
  if (role === 'admin') {
    return { state: 'needs_payment' };
  }

  const { data: owner } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('organization_id', organizationId)
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return { state: 'blocked', ownerName: (owner?.full_name as string | null) ?? null };
}
