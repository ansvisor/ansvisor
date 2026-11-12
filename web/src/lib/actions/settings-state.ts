'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOrgPlan } from '@/lib/guards/plan-guard';
import { isUuid, readNavSeen } from '@/lib/user-brand-state';
import {
  FIRST_VISIT_WINDOW_MS,
  SETTINGS_SEEN_KEYS,
  type SettingsSeenPlace,
  type SettingsState,
} from '@/lib/settings-dots';

/** Settled: a part that couldn't be read is null and lights no dot. */
async function part<T>(read: PromiseLike<T>, what: string): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    console.error(`[settings-state] could not read ${what}:`, error);
    return null;
  }
}

/** A Supabase reply's data, or a throw for `part` to catch. */
function data<T>(reply: { data: T; error: { message: string } | null }): T {
  if (reply.error) throw new Error(reply.error.message);
  return reply.data;
}

/**
 * What Settings' dots compare (lib/settings-dots.ts), for an admin or a
 * manager only: null for anyone else. Read with the menu's state, on a
 * brand switch and at most every 5 minutes while the person moves around,
 * never at night. Count and single-row reads on existing indexes, scoped to
 * the person's organization:
 *
 *   people who joined        profiles by organization (idx_profiles_organization_id), newer than
 *                            the last visit to Members: a count and the newest three names
 *   invites that expired     invitations pending past expires_at (idx_invitations_organization_id)
 *   the seat limit           members and pending invites against the plan, as Team counts them
 *   a broken connection      integration_accounts disconnected or auth_failed (00470,
 *                            integration_accounts_organization_provider_idx): Google, CMS, Slack
 *   a teammate's connection  the newest integration_accounts row a teammate connected since
 *   a new MCP client         the person's newest live oauth_grants row in the organization
 *                            since (oauth_grants_user_idx; the table has no organization index)
 *
 * The visits are user_brand_state.nav_seen keys (settings/members, …) on the
 * brand open now: nav_seen is kept per brand. A place never opened counts
 * the last week. Answers as a value and never throws (#1777).
 */
export async function getSettingsState(brandId: string | null): Promise<SettingsState | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .maybeSingle();
    const org = profile?.organization_id as string | undefined;
    if (!org || (profile?.role !== 'admin' && profile?.role !== 'manager')) return null;

    const seenRow =
      brandId && isUuid(brandId)
        ? await part(
            supabase
              .from('user_brand_state')
              .select('nav_seen')
              .eq('user_id', user.id)
              .eq('brand_id', brandId)
              .maybeSingle()
              .then(data),
            'the visits',
          )
        : null;
    const seen = readNavSeen(seenRow?.nav_seen);
    const now = new Date();
    const since = (place: SettingsSeenPlace) =>
      seen[SETTINGS_SEEN_KEYS[place]] ??
      new Date(now.getTime() - FIRST_VISIT_WINDOW_MS).toISOString();

    const [joined, expired, members, pending, plan, broken, connection, client] = await Promise.all(
      [
        part(
          supabaseAdmin
            .from('profiles')
            .select('full_name, created_at', { count: 'exact' })
            .eq('organization_id', org)
            .neq('id', user.id)
            .gt('created_at', since('members'))
            .order('created_at', { ascending: false })
            .limit(3),
          'who joined',
        ),
        part(
          supabaseAdmin
            .from('invitations')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', org)
            .eq('status', 'pending')
            .lt('expires_at', now.toISOString()),
          'the expired invites',
        ),
        part(
          supabaseAdmin
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', org),
          'the members',
        ),
        part(
          supabaseAdmin
            .from('invitations')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', org)
            .eq('status', 'pending'),
          'the pending invites',
        ),
        part(getOrgPlan(org), 'the plan'),
        part(
          supabaseAdmin
            .from('integration_accounts')
            .select('provider, label')
            .eq('organization_id', org)
            .in('status', ['disconnected', 'auth_failed'])
            .limit(1)
            .maybeSingle()
            .then(data),
          'the broken connections',
        ),
        part(
          supabaseAdmin
            .from('integration_accounts')
            .select('provider, label, connected_by, created_at')
            .eq('organization_id', org)
            .eq('status', 'connected')
            .neq('connected_by', user.id)
            .gt('created_at', since('integrations'))
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(data),
          'the new connections',
        ),
        part(
          supabaseAdmin
            .from('oauth_grants')
            .select('client_name, redirect_host, created_at')
            .eq('user_id', user.id)
            .eq('organization_id', org)
            .is('revoked_at', null)
            .gt('created_at', since('api'))
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(data),
          'the MCP clients',
        ),
      ],
    );

    const by = connection?.connected_by
      ? await part(
          supabaseAdmin
            .from('profiles')
            .select('full_name')
            .eq('id', connection.connected_by as string)
            .maybeSingle()
            .then(data),
          'who connected',
        )
      : null;

    const joinedRows = (!joined?.error && joined?.data) || [];
    const joinedCount = joined && !joined.error ? (joined.count ?? joinedRows.length) : 0;
    const max = plan?.limits.maxTeamMembers ?? -1;
    const seatsUsed =
      members && !members.error && pending && !pending.error
        ? (members.count ?? 0) + (pending.count ?? 0)
        : null;

    return {
      joined:
        joinedCount > 0 && joinedRows[0]
          ? {
              count: joinedCount,
              names: joinedRows
                .map((row) => (row.full_name as string | null)?.trim() ?? '')
                .filter(Boolean),
              at: joinedRows[0].created_at as string,
            }
          : null,
      expiredInvites: expired && !expired.error ? (expired.count ?? 0) : 0,
      seatsFull: max !== -1 && seatsUsed !== null && seatsUsed >= max,
      brokenIntegration: broken
        ? { provider: broken.provider as string, label: (broken.label as string | null) ?? null }
        : null,
      newIntegration: connection
        ? {
            provider: connection.provider as string,
            label: (connection.label as string | null) ?? null,
            by: (by?.full_name as string | null)?.trim() || null,
            at: connection.created_at as string,
          }
        : null,
      newClient: client
        ? {
            name: (client.client_name as string | null) || (client.redirect_host as string),
            at: client.created_at as string,
          }
        : null,
    };
  } catch (error) {
    console.error('[settings-state] could not read:', error);
    return null;
  }
}
