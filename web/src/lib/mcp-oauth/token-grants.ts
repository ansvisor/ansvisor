import { supabaseAdmin } from '@/lib/supabase/admin';
import type { OAuthClient } from './clients';
import { markClientUsed } from './clients';
import { REFRESH_REUSE_GRACE_SECONDS, mcpResourceUrl } from './config';
import { logOAuthEvent } from './events';
import {
  createGrant,
  issueTokenPair,
  narrowScopes,
  revokeGrant,
  type OAuthGrant,
  type TokenPair,
} from './grants';
import type { OAuthErrorCode } from './http';
import { verifyS256 } from './pkce';
import { isOurResource, resolveResource } from './resource';
import { MCP_SCOPES, scopeString, type McpScope } from './scopes';
import {
  ACCESS_TOKEN_PREFIX,
  AUTHORIZATION_CODE_PREFIX,
  REFRESH_TOKEN_PREFIX,
  hashSecret,
} from './tokens';

/**
 * The token endpoint's two grants (OAuth 2.1 §4.1.3, §4.3) and revocation
 * (RFC 7009), for MCP over OAuth (#2141).
 *
 *   * A code is claimed by one request only (an update on used_at is null):
 *     it must be the client's, unexpired, with the same redirect_uri and
 *     the verifier its S256 challenge came from, for our resource. Its
 *     connection is made then. A code used again ends that connection.
 *   * A refresh token is swapped for a new pair once (rotated_at), its
 *     scopes or fewer. One presented again past REFRESH_REUSE_GRACE_SECONDS
 *     after its swap is a replay: the connection ends.
 *   * Revoking any of a connection's tokens ends the connection.
 */

export type TokenResult =
  | { ok: true; body: TokenResponse }
  | { ok: false; error: OAuthErrorCode; description: string };

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const fail = (error: OAuthErrorCode, description: string): TokenResult => ({
  ok: false,
  error,
  description,
});

const tokenResponse = (pair: TokenPair): TokenResult => ({
  ok: true,
  body: {
    access_token: pair.accessToken,
    token_type: 'Bearer',
    expires_in: pair.expiresIn,
    refresh_token: pair.refreshToken,
    scope: scopeString(pair.scopes),
  },
});

interface CodeRow {
  client_id: string;
  user_id: string;
  organization_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: McpScope[];
  resource: string;
  client_name: string | null;
  redirect_host: string;
  expires_at: string;
}

const CODE_COLUMNS =
  'client_id, user_id, organization_id, redirect_uri, code_challenge, scopes, resource, client_name, redirect_host, expires_at';

/** grant_type=authorization_code. */
export async function redeemCode(
  client: OAuthClient,
  params: {
    code: string | null;
    redirectUri: string | null;
    codeVerifier: string | null;
    resource: string | null;
  },
  issuer: string,
  req: Request,
): Promise<TokenResult> {
  const { code, redirectUri, codeVerifier, resource } = params;
  if (!code || !redirectUri || !codeVerifier) {
    return fail('invalid_request', 'code, redirect_uri and code_verifier are required');
  }
  if (!code.startsWith(AUTHORIZATION_CODE_PREFIX)) return fail('invalid_grant', 'Unknown code');
  const hash = hashSecret(code);

  const claim = await supabaseAdmin
    .from('oauth_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', hash)
    .is('used_at', null)
    .select(CODE_COLUMNS)
    .maybeSingle();
  if (claim.error) throw new Error(`Could not read the code: ${claim.error.message}`);
  if (!claim.data) {
    const used = await supabaseAdmin
      .from('oauth_codes')
      .select('grant_id, client_id, user_id, organization_id')
      .eq('code_hash', hash)
      .maybeSingle();
    const row = used.data as {
      grant_id: string | null;
      client_id: string;
      user_id: string;
      organization_id: string;
    } | null;
    if (row?.grant_id) {
      await revokeGrant(row.grant_id, 'code_reuse');
      await logOAuthEvent({
        event: 'code_reuse',
        organizationId: row.organization_id,
        userId: row.user_id,
        grantId: row.grant_id,
        clientId: row.client_id,
        req,
      });
    }
    return fail('invalid_grant', 'The code is unknown or was used already');
  }
  const row = claim.data as CodeRow;
  if (row.client_id !== client.client_id) {
    return fail('invalid_grant', 'The code was issued to another client');
  }
  if (Date.parse(row.expires_at) <= Date.now()) return fail('invalid_grant', 'The code expired');
  if (row.redirect_uri !== redirectUri) {
    return fail('invalid_grant', 'redirect_uri differs from the authorization request');
  }
  if (!verifyS256(codeVerifier, row.code_challenge)) {
    return fail('invalid_grant', 'code_verifier does not match the code_challenge');
  }
  const ours = mcpResourceUrl(issuer);
  if (
    !isOurResource(row.resource, ours) ||
    (resource && resolveResource(resource, ours) === null)
  ) {
    return fail('invalid_target', `The only resource here is ${ours}`);
  }

  const grant = await createGrant({
    userId: row.user_id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    clientName: row.client_name,
    redirectHost: row.redirect_host,
    scopes: row.scopes,
    resource: ours,
  });
  const link = await supabaseAdmin
    .from('oauth_codes')
    .update({ grant_id: grant.id })
    .eq('code_hash', hash);
  if (link.error) console.error('[mcp-oauth] Could not link the code to its connection');
  const pair = await issueTokenPair(grant.id, grant.scopes);
  markClientUsed(client.client_id);
  return tokenResponse(pair);
}

interface RefreshRow {
  id: string;
  scopes: McpScope[];
  expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
  oauth_grants: OAuthGrant | OAuthGrant[];
}

/** The scopes a refresh asks for: its token's when it names none; never more. */
function refreshScopes(asked: string | null, held: readonly McpScope[]): McpScope[] | null {
  const names = (asked ?? '').split(/\s+/).filter(Boolean);
  const known = MCP_SCOPES.filter((scope) => names.includes(scope));
  if (known.length === 0) return [...held];
  if (known.some((scope) => !held.includes(scope))) return null;
  return known.includes('mcp:read') ? known : ['mcp:read', ...known];
}

/** grant_type=refresh_token. */
export async function refreshTokens(
  client: OAuthClient,
  params: { refreshToken: string | null; scope: string | null; resource: string | null },
  issuer: string,
  req: Request,
): Promise<TokenResult> {
  const { refreshToken, scope, resource } = params;
  if (!refreshToken) return fail('invalid_request', 'refresh_token is required');
  if (!refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) {
    return fail('invalid_grant', 'Unknown refresh token');
  }
  const { data, error } = await supabaseAdmin
    .from('oauth_tokens')
    .select(
      'id, scopes, expires_at, rotated_at, revoked_at, oauth_grants!inner(id, user_id, organization_id, client_id, client_name, redirect_host, scopes, resource, created_at, last_used_at, revoked_at)',
    )
    .eq('token_hash', hashSecret(refreshToken))
    .eq('kind', 'refresh')
    .maybeSingle();
  if (error) throw new Error(`Could not read the refresh token: ${error.message}`);
  if (!data) return fail('invalid_grant', 'Unknown refresh token');
  const row = data as RefreshRow;
  const grant = Array.isArray(row.oauth_grants) ? row.oauth_grants[0] : row.oauth_grants;
  if (!grant || grant.client_id !== client.client_id) {
    return fail('invalid_grant', 'Unknown refresh token');
  }

  if (row.rotated_at) {
    const since = (Date.now() - Date.parse(row.rotated_at)) / 1000;
    if (since > REFRESH_REUSE_GRACE_SECONDS && !grant.revoked_at) {
      await revokeGrant(grant.id, 'refresh_reuse');
      await logOAuthEvent({
        event: 'refresh_reuse',
        organizationId: grant.organization_id,
        userId: grant.user_id,
        grantId: grant.id,
        clientId: grant.client_id,
        req,
      });
    }
    return fail('invalid_grant', 'The refresh token was used already');
  }
  if (row.revoked_at || grant.revoked_at) {
    return fail('invalid_grant', 'This connection was disconnected');
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    return fail('invalid_grant', 'The refresh token expired');
  }
  const ours = mcpResourceUrl(issuer);
  if (
    !isOurResource(grant.resource, ours) ||
    (resource && resolveResource(resource, ours) === null)
  ) {
    return fail('invalid_target', `The only resource here is ${ours}`);
  }
  const scopes = refreshScopes(scope, narrowScopes(row.scopes, grant.scopes));
  if (!scopes)
    return fail('invalid_scope', 'A refresh can keep or narrow the scopes, not widen them');

  // Swapped once: a second request with the same token finds it rotated.
  const swap = await supabaseAdmin
    .from('oauth_tokens')
    .update({ rotated_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('rotated_at', null)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();
  if (swap.error) throw new Error(`Could not rotate the refresh token: ${swap.error.message}`);
  if (!swap.data) return fail('invalid_grant', 'The refresh token was used already');

  return tokenResponse(await issueTokenPair(grant.id, scopes));
}

/**
 * RFC 7009: the client revokes one of its tokens, which ends its connection.
 * An unknown token is no error (§2.2); one of another client's is refused.
 */
export async function revokeTokenByClient(
  client: OAuthClient,
  token: string,
  req: Request,
): Promise<'revoked' | 'unknown' | 'other_client'> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX) && !token.startsWith(REFRESH_TOKEN_PREFIX)) {
    return 'unknown';
  }
  const { data, error } = await supabaseAdmin
    .from('oauth_tokens')
    .select('id, oauth_grants!inner(id, user_id, organization_id, client_id, revoked_at)')
    .eq('token_hash', hashSecret(token))
    .maybeSingle();
  if (error) throw new Error(`Could not read the token: ${error.message}`);
  if (!data) return 'unknown';
  const related = (data as unknown as { oauth_grants: OAuthGrant | OAuthGrant[] }).oauth_grants;
  const grant = Array.isArray(related) ? related[0] : related;
  if (!grant) return 'unknown';
  if (grant.client_id !== client.client_id) return 'other_client';
  if (!grant.revoked_at) {
    await revokeGrant(grant.id, 'client');
    await logOAuthEvent({
      event: 'revoked_by_client',
      organizationId: grant.organization_id,
      userId: grant.user_id,
      grantId: grant.id,
      clientId: grant.client_id,
      req,
    });
  }
  return 'revoked';
}
