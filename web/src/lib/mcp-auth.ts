import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { brandAccessOf, readAccessProfile, type BrandAccess } from '@/lib/brand-access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  mcpWriteAccess,
  oauthMcpAccess,
  planRequiredResponse,
  subscriptionInactiveResponse,
  type OAuthMcpAccess,
} from '@/lib/mcp/subscription-gate';
import { unauthorizedWithChallenge } from '@/lib/mcp-oauth/challenge';
import { mcpOAuthEnabled, mcpResourceUrl, oauthIssuer } from '@/lib/mcp-oauth/config';
import { logOAuthEvent } from '@/lib/mcp-oauth/events';
import { checkAccessToken, revokeGrant, touchGrant } from '@/lib/mcp-oauth/grants';
import type { McpScope } from '@/lib/mcp-oauth/scopes';
import { isAccessToken, isOAuthSecret } from '@/lib/mcp-oauth/tokens';
import type { UserRole } from '@/types';

export const API_KEY_PREFIX = 'ans_';
export const API_KEY_DISPLAY_PREFIX_LEN = 12;

export function generateApiKey(): { token: string; hash: string; prefix: string } {
  const token = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  const prefix = token.slice(0, API_KEY_DISPLAY_PREFIX_LEN);
  return { token, hash, prefix };
}

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface McpAuthContext {
  userId: string;
  email: string | null;
  organizationId: string | null;
  /** The user's role in the organization: the tools that need one check it (lib/mcp/role-gate.ts). */
  role: UserRole | null;
  apiKeyId: string;
  /**
   * The brands the user may use, when the caller read them already (an API
   * key's request, Chat's precedence for each call); absent, a tool reads
   * them itself (lib/brand-access.ts brandAccessFor).
   */
  brandAccess?: BrandAccess | null;
  /**
   * How the request signed in: an `ans_` API key, or an app's sign-in
   * connection (MCP over OAuth, #2141), whose apiKeyId is `oauth:<grant id>`.
   * Absent for Ansvisor's own callers (Chat, agents).
   */
  via?: 'api_key' | 'oauth';
  /** A sign-in connection's id, scopes, and whether its plan lets it work. */
  oauthGrantId?: string;
  oauthScopes?: readonly McpScope[];
  oauthAccess?: OAuthMcpAccess;
}

/** The methods that change something: a read-only workspace's REST routes refuse them. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolve the bearer token on a request into a user/org context.
 *
 * Accepts Ansvisor API keys (prefix `ans_`) — not Supabase session JWTs.
 * MCP endpoints are intended to be hit by long-lived external clients, so we
 * intentionally don't fall back to the dashboard's session cookie. With
 * `allowOAuth` (the MCP endpoint alone, the resource its tokens are for) and
 * MCP_OAUTH_ENABLED on, it also takes an app's access token (`ans_oat_`),
 * and its 401s carry the WWW-Authenticate that starts an app's sign-in.
 *
 * A key belongs to a person, so it carries their brand access (BRAND-ACCESS
 * §5.3): All brands, or the ones shared with them, read once per request
 * for the tools to check. A read that fails answers 503: no tool runs on
 * access it couldn't read.
 *
 * On Ansvisor Cloud, a write (POST, PUT, PATCH, DELETE) for an organization
 * whose plan isn't active answers 402 subscription_inactive, and on a plan
 * without MCP writes (Starter, a free trial) 402 plan_required, so a new
 * write route is gated without asking. The MCP endpoint, where every call is a
 * POST, passes `gateWrites: false` and gates its tools instead.
 */
export async function authenticateMcpRequest(
  req: Request,
  { gateWrites = true, allowOAuth = false }: { gateWrites?: boolean; allowOAuth?: boolean } = {},
): Promise<McpAuthContext | NextResponse> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const issuer = allowOAuth && mcpOAuthEnabled() ? oauthIssuer() : null;
  const unauthorized = (message: string, error?: 'invalid_token') =>
    issuer
      ? unauthorizedWithChallenge(issuer, message, error)
      : NextResponse.json({ error: message }, { status: 401 });

  // An app's token is never looked up as an API key, here or elsewhere.
  if (token && isOAuthSecret(token)) {
    if (issuer && isAccessToken(token)) return authenticateOAuth(req, token, issuer);
    return unauthorized(
      issuer ? 'Invalid access token' : 'This address takes an API key',
      'invalid_token',
    );
  }

  if (!token || !token.startsWith(API_KEY_PREFIX)) {
    return unauthorized('Missing or malformed API key');
  }

  const hash = hashApiKey(token);

  const { data: key, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle();

  if (error || !key || key.revoked_at) {
    return unauthorized('Invalid API key', 'invalid_token');
  }

  // Resolve the owning user, their organization and the brands they may use, so handlers don't have to.
  let profile: Awaited<ReturnType<typeof readAccessProfile>>;
  let brandAccess: BrandAccess | null = null;
  try {
    profile = await readAccessProfile(key.user_id);
    if (profile?.organization_id) {
      brandAccess = await brandAccessOf(profile, key.user_id, profile.organization_id);
    }
  } catch (err) {
    console.error("[mcp-auth] Could not read the key owner's access:", err);
    return NextResponse.json({ error: 'Could not read access, try again' }, { status: 503 });
  }

  const organizationId = profile?.organization_id ?? null;
  if (gateWrites && WRITE_METHODS.has(req.method.toUpperCase())) {
    const access = await mcpWriteAccess(organizationId);
    if (access === 'inactive') return subscriptionInactiveResponse();
    if (access === 'plan') return planRequiredResponse();
  }

  // Best-effort touch — failing here shouldn't block the request.
  supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(() => {});

  const {
    data: { user },
  } = await supabaseAdmin.auth.admin.getUserById(key.user_id);

  return {
    userId: key.user_id,
    email: user?.email ?? null,
    organizationId,
    role: (profile?.role as UserRole | null | undefined) ?? null,
    apiKeyId: key.id,
    brandAccess,
    via: 'api_key',
  };
}

const TOKEN_REFUSED = {
  unknown: 'Invalid access token',
  revoked: 'This connection was disconnected. Connect the app to Ansvisor again.',
  expired: 'The access token expired',
  wrong_resource: 'This access token is for another server',
} as const;

/**
 * An app's sign-in connection (MCP over OAuth): the token's connection, then
 * its person, read fresh as for an API key: role, brand access and plan. A
 * person no longer in the organization they connected in loses the
 * connection. A read that fails answers 503, as for a key.
 */
async function authenticateOAuth(
  req: Request,
  token: string,
  issuer: string,
): Promise<McpAuthContext | NextResponse> {
  let check: Awaited<ReturnType<typeof checkAccessToken>>;
  try {
    check = await checkAccessToken(token, mcpResourceUrl(issuer));
  } catch (err) {
    console.error('[mcp-auth] Could not check the access token:', err);
    return NextResponse.json({ error: 'Could not read access, try again' }, { status: 503 });
  }
  if (!check.ok) {
    return unauthorizedWithChallenge(issuer, TOKEN_REFUSED[check.reason], 'invalid_token');
  }
  const { grant, scopes } = check;

  let profile: Awaited<ReturnType<typeof readAccessProfile>>;
  let brandAccess: BrandAccess | null = null;
  let oauthAccess: OAuthMcpAccess;
  try {
    profile = await readAccessProfile(grant.user_id);
    if (profile?.organization_id !== grant.organization_id) {
      await revokeGrant(grant.id, 'member_left');
      void logOAuthEvent({
        event: 'revoked_member_left',
        organizationId: grant.organization_id,
        userId: grant.user_id,
        grantId: grant.id,
        clientId: grant.client_id,
        req,
      });
      return unauthorizedWithChallenge(issuer, TOKEN_REFUSED.revoked, 'invalid_token');
    }
    brandAccess = await brandAccessOf(profile, grant.user_id, grant.organization_id);
    oauthAccess = await oauthMcpAccess(grant.organization_id);
  } catch (err) {
    console.error("[mcp-auth] Could not read the connection's access:", err);
    return NextResponse.json({ error: 'Could not read access, try again' }, { status: 503 });
  }

  touchGrant(grant);

  const {
    data: { user },
  } = await supabaseAdmin.auth.admin.getUserById(grant.user_id);

  return {
    userId: grant.user_id,
    email: user?.email ?? null,
    organizationId: grant.organization_id,
    role: (profile?.role as UserRole | null | undefined) ?? null,
    apiKeyId: `oauth:${grant.id}`,
    brandAccess,
    via: 'oauth',
    oauthGrantId: grant.id,
    oauthScopes: scopes,
    oauthAccess,
  };
}
