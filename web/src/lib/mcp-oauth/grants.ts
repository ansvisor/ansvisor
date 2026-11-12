import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  LAST_USED_WRITE_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from './config';
import { isOurResource } from './resource';
import { MCP_SCOPES, type McpScope } from './scopes';
import { ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX, hashSecret, newSecret } from './tokens';

/**
 * Connections (oauth_grants) and their tokens (oauth_tokens), 00510. Read and
 * written with the service role only. A connection is one person in one
 * organization with one app; its tokens carry no more than its scopes.
 * Every MCP request reads its token here, with no cache, so revoking a
 * connection ends it at the next request.
 */

export interface OAuthGrant {
  id: string;
  user_id: string;
  organization_id: string;
  client_id: string;
  client_name: string | null;
  redirect_host: string;
  scopes: McpScope[];
  resource: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export type RevokedReason =
  | 'person'
  | 'client'
  | 'member_left'
  | 'code_reuse'
  | 'refresh_reuse'
  | 'expired';

const GRANT_COLUMNS =
  'id, user_id, organization_id, client_id, client_name, redirect_host, scopes, resource, created_at, last_used_at, revoked_at';

const iso = (ms: number) => new Date(ms).toISOString();

/** Only the scopes both lists hold, in their usual order. */
export function narrowScopes(a: readonly string[], b: readonly string[]): McpScope[] {
  return MCP_SCOPES.filter((scope) => a.includes(scope) && b.includes(scope));
}

export type AccessTokenCheck =
  | { ok: true; grant: OAuthGrant; scopes: McpScope[] }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'wrong_resource' };

/**
 * What an access token is good for at `resource`: its connection and scopes,
 * or why not. A read that fails throws: no request runs on a token it
 * couldn't check.
 */
export async function checkAccessToken(token: string, resource: string): Promise<AccessTokenCheck> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return { ok: false, reason: 'unknown' };
  const { data, error } = await supabaseAdmin
    .from('oauth_tokens')
    .select(`id, scopes, expires_at, revoked_at, oauth_grants!inner(${GRANT_COLUMNS})`)
    .eq('token_hash', hashSecret(token))
    .eq('kind', 'access')
    .maybeSingle();
  if (error) throw new Error(`Could not read the access token: ${error.message}`);
  if (!data) return { ok: false, reason: 'unknown' };
  const row = data as {
    scopes: string[];
    expires_at: string;
    revoked_at: string | null;
    oauth_grants: OAuthGrant | OAuthGrant[];
  };
  const grant = Array.isArray(row.oauth_grants) ? row.oauth_grants[0] : row.oauth_grants;
  if (!grant || row.revoked_at || grant.revoked_at) return { ok: false, reason: 'revoked' };
  if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, reason: 'expired' };
  if (!isOurResource(grant.resource, resource)) return { ok: false, reason: 'wrong_resource' };
  return { ok: true, grant, scopes: narrowScopes(row.scopes, grant.scopes) };
}

/** End a connection and every token it has. */
export async function revokeGrant(grantId: string, reason: RevokedReason): Promise<void> {
  const now = iso(Date.now());
  const grant = await supabaseAdmin
    .from('oauth_grants')
    .update({ revoked_at: now, revoked_reason: reason })
    .eq('id', grantId)
    .is('revoked_at', null);
  if (grant.error) throw new Error(`Could not revoke the connection: ${grant.error.message}`);
  const tokens = await supabaseAdmin
    .from('oauth_tokens')
    .update({ revoked_at: now })
    .eq('grant_id', grantId)
    .is('revoked_at', null);
  if (tokens.error) throw new Error(`Could not revoke the tokens: ${tokens.error.message}`);
}

/** Note a connection's use, at most every LAST_USED_WRITE_SECONDS. Best effort. */
export function touchGrant(grant: Pick<OAuthGrant, 'id' | 'last_used_at'>): void {
  const now = Date.now();
  if (grant.last_used_at && now - Date.parse(grant.last_used_at) < LAST_USED_WRITE_SECONDS * 1000) {
    return;
  }
  supabaseAdmin
    .from('oauth_grants')
    .update({ last_used_at: iso(now) })
    .eq('id', grant.id)
    .then(
      () => {},
      () => {},
    );
}

export interface NewGrant {
  userId: string;
  organizationId: string;
  clientId: string;
  clientName: string | null;
  redirectHost: string;
  scopes: readonly McpScope[];
  resource: string;
}

/** A new connection, as a redeemed code makes it. */
export async function createGrant(input: NewGrant): Promise<OAuthGrant> {
  const { data, error } = await supabaseAdmin
    .from('oauth_grants')
    .insert({
      user_id: input.userId,
      organization_id: input.organizationId,
      client_id: input.clientId,
      client_name: input.clientName,
      redirect_host: input.redirectHost,
      scopes: [...input.scopes],
      resource: input.resource,
    })
    .select(GRANT_COLUMNS)
    .single();
  if (error || !data) throw new Error(`Could not save the connection: ${error?.message}`);
  return data as OAuthGrant;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds the access token lives. */
  expiresIn: number;
  scopes: McpScope[];
}

/** A new access and refresh token for a connection. Only their hashes are kept. */
export async function issueTokenPair(
  grantId: string,
  scopes: readonly McpScope[],
): Promise<TokenPair> {
  const accessToken = newSecret(ACCESS_TOKEN_PREFIX);
  const refreshToken = newSecret(REFRESH_TOKEN_PREFIX);
  const now = Date.now();
  const { error } = await supabaseAdmin.from('oauth_tokens').insert([
    {
      grant_id: grantId,
      kind: 'access',
      token_hash: hashSecret(accessToken),
      scopes: [...scopes],
      expires_at: iso(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
    },
    {
      grant_id: grantId,
      kind: 'refresh',
      token_hash: hashSecret(refreshToken),
      scopes: [...scopes],
      expires_at: iso(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  ]);
  if (error) throw new Error(`Could not save the tokens: ${error.message}`);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, scopes: [...scopes] };
}
