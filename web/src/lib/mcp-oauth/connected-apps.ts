import { readAccessProfile } from '@/lib/brand-access';
import { oauthMcpAccess } from '@/lib/mcp/subscription-gate';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { REFRESH_TOKEN_TTL_SECONDS } from './config';
import { logOAuthEvent } from './events';
import { revokeGrant } from './grants';
import { knownAppName } from './known-apps';
import { isLoopbackHost } from './redirect-uris';
import type { McpScope } from './scopes';

/**
 * Settings › MCP & API Keys › Connected apps (MCP over OAuth, #2141; the
 * approved mockup's screens 7 to 9): the apps a person connected by signing
 * in, and Disconnect. Each person sees and ends only their own, as with API
 * keys; the tables are the server's (00510), read here for that person.
 * Disconnect ends the connection and every token at once: the app's next
 * call is refused and it asks the person to connect again.
 */

export interface ConnectedApp {
  id: string;
  name: string | null;
  host: string;
  recognised: boolean;
  loopback: boolean;
  scopes: McpScope[];
  created_at: string;
  last_used_at: string | null;
}

/** A connection unused this long has no live refresh token left: it isn't listed. */
const IDLE_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;

/** The person's live connections, newest first. */
export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const { data, error } = await supabaseAdmin
    .from('oauth_grants')
    .select('id, client_name, redirect_host, scopes, created_at, last_used_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not read the connections: ${error.message}`);
  const now = Date.now();
  return (
    (data ?? []) as {
      id: string;
      client_name: string | null;
      redirect_host: string;
      scopes: McpScope[];
      created_at: string;
      last_used_at: string | null;
    }[]
  )
    .filter((row) => now - Date.parse(row.last_used_at ?? row.created_at) < IDLE_MS)
    .map((row) => {
      const known = knownAppName(row.redirect_host);
      return {
        id: row.id,
        name: known ?? row.client_name,
        host: row.redirect_host,
        recognised: !!known,
        loopback: isLoopbackHost(row.redirect_host),
        scopes: row.scopes,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
      };
    });
}

/** Whether the person's plan lets connections work, and whether they can choose a plan. */
export async function connectedAppsAccess(userId: string) {
  const profile = await readAccessProfile(userId);
  const isAdmin = profile?.role === 'admin';
  if (!profile?.organization_id) return { access: 'no_workspace' as const, isAdmin };
  return { access: await oauthMcpAccess(profile.organization_id), isAdmin };
}

/** Disconnect one of the person's own connections; false when they have no such live one. */
export async function disconnectApp(userId: string, grantId: string, req: Request) {
  const { data, error } = await supabaseAdmin
    .from('oauth_grants')
    .select('id, organization_id, client_id')
    .eq('id', grantId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not read the connection: ${error.message}`);
  if (!data) return false;
  const grant = data as { id: string; organization_id: string; client_id: string };
  await revokeGrant(grant.id, 'person');
  await logOAuthEvent({
    event: 'revoked_by_person',
    organizationId: grant.organization_id,
    userId,
    grantId: grant.id,
    clientId: grant.client_id,
    req,
  });
  return true;
}
