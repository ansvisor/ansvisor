import { supabaseAdmin } from '@/lib/supabase/admin';
import type { OAuthClient } from './clients';
import { AUTHORIZATION_REQUEST_TTL_SECONDS } from './config';
import { isS256Challenge } from './pkce';
import { redirectUriMatches } from './redirect-uris';
import { resolveResource } from './resource';
import { parseScopeParam, type McpScope } from './scopes';

/**
 * The authorization endpoint's checks (OAuth 2.1 §4.1.1, MCP authorization
 * spec 2025-11-25). Until the client and its redirect URI check out, an
 * error goes to Ansvisor's own page and never to the address the request
 * names (RFC 6749 §4.1.2.1): it could be anyone's. After that, errors go
 * back to the app with `state` and `iss`.
 */

/** The errors the consent page explains, never sent to an app. */
export type ConsentErrorCode =
  | 'unknown_client'
  | 'invalid_redirect_uri'
  | 'invalid_request'
  | 'expired'
  | 'other_person'
  | 'rate_limited';

export const CONSENT_ERROR_CODES: readonly ConsentErrorCode[] = [
  'unknown_client',
  'invalid_redirect_uri',
  'invalid_request',
  'expired',
  'other_person',
  'rate_limited',
];

/** An error the app is told, at its own redirect URI. */
export type AppErrorCode =
  | 'invalid_request'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied'
  | 'server_error'
  | 'temporarily_unavailable';

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: McpScope[];
  state: string | null;
  resource: string;
}

export type AuthorizeCheck =
  | { ok: true; request: AuthorizeRequest }
  /** Shown on Ansvisor's page: the redirect URI can't be trusted yet. */
  | { ok: false; page: ConsentErrorCode }
  /** Sent back to the app. */
  | {
      ok: false;
      app: AppErrorCode;
      description: string;
      redirectUri: string;
      state: string | null;
    };

/**
 * The redirect URI a request names, or the client's only one when it names
 * none (OAuth 2.1 §2.3.2: required when a client has several).
 */
function chosenRedirectUri(client: OAuthClient, asked: string | null): string | null {
  if (!asked) return client.redirect_uris.length === 1 ? client.redirect_uris[0] : null;
  return redirectUriMatches(client.redirect_uris, asked) ? asked : null;
}

/** Check an authorization request's parameters against its client. */
export function checkAuthorizeRequest(
  params: URLSearchParams,
  client: OAuthClient | null,
  ourResource: string,
): AuthorizeCheck {
  if (!client) return { ok: false, page: 'unknown_client' };
  const redirectUri = chosenRedirectUri(client, params.get('redirect_uri'));
  if (!redirectUri) return { ok: false, page: 'invalid_redirect_uri' };

  const state = params.get('state');
  const toApp = (app: AppErrorCode, description: string): AuthorizeCheck => ({
    ok: false,
    app,
    description,
    redirectUri,
    state: state && state.length <= 1000 ? state : null,
  });
  if (state && state.length > 1000) return toApp('invalid_request', 'state is too long');
  if (params.get('response_type') !== 'code') {
    return toApp('unsupported_response_type', 'response_type must be code');
  }
  const challenge = params.get('code_challenge');
  if (params.get('code_challenge_method') !== 'S256' || !isS256Challenge(challenge)) {
    return toApp(
      'invalid_request',
      'PKCE is required: code_challenge with code_challenge_method S256',
    );
  }
  const resource = resolveResource(params.get('resource'), ourResource);
  if (!resource) return toApp('invalid_target', `The only resource here is ${ourResource}`);

  return {
    ok: true,
    request: {
      clientId: client.client_id,
      redirectUri,
      codeChallenge: challenge,
      scopes: parseScopeParam(params.get('scope')),
      state,
      resource,
    },
  };
}

/**
 * Where the person goes back to the app: its redirect URI with the code or
 * the error, its `state`, and the issuer (RFC 9207), which ChatGPT checks
 * and the MCP spec 2026-07-28 asks for.
 */
export function appRedirect(
  redirectUri: string,
  issuer: string,
  result: { code: string } | { error: AppErrorCode; description?: string },
  state: string | null,
): string {
  const url = new URL(redirectUri);
  if ('code' in result) {
    url.searchParams.set('code', result.code);
  } else {
    url.searchParams.set('error', result.error);
    if (result.description) url.searchParams.set('error_description', result.description);
  }
  if (state) url.searchParams.set('state', state);
  url.searchParams.set('iss', issuer);
  return url.toString();
}

/** Keep a checked request while the person signs in and decides; its id is all the consent page's address holds. */
export async function saveAuthorizationRequest(request: AuthorizeRequest): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('oauth_authorization_requests')
    .insert({
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      code_challenge: request.codeChallenge,
      scopes: request.scopes,
      state: request.state,
      resource: request.resource,
      expires_at: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_SECONDS * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not keep the request: ${error?.message}`);
  return (data as { id: string }).id;
}

/** Remove requests past their ten minutes. Best effort. */
export function sweepExpiredRequests(): void {
  supabaseAdmin
    .from('oauth_authorization_requests')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .then(
      () => {},
      () => {},
    );
}
