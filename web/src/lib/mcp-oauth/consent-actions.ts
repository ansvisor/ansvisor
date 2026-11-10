'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appRedirect } from './authorize';
import { AUTHORIZATION_CODE_TTL_SECONDS, mcpOAuthEnabled, oauthIssuer } from './config';
import { appOf, claimRequest, readConnectingPerson, readPendingRequest } from './consent';
import { logOAuthEvent } from './events';
import { rateHit } from './rate-limit';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, type McpScope } from './scopes';
import { AUTHORIZATION_CODE_PREFIX, hashSecret, newSecret } from './tokens';

/**
 * The consent page's answers (MCP over OAuth, #2141). Server actions, so
 * Next.js checks the request came from this site (its Origin against the
 * host), and the page can't be framed (next.config.ts): another site can't
 * approve for someone. Each one reads again what the page showed: the
 * request still pending and this person's, and on Allow the plan still
 * letting them connect. No workspace is changed here, so they don't take
 * the read-only check (assertWritable): the plan rule is the sign-in one.
 *
 *   * Allow: a one-time code (5 minutes) for the request's client, redirect
 *     URI, PKCE challenge and resource, with the scopes the person left
 *     ticked (reading always), for the organization they are in now. The
 *     request is used up, and the app gets the code with `state` and `iss`.
 *   * Cancel (and "Back to …" on a blocked page): the app gets access_denied.
 */

/** Consent decisions a person may make in ten minutes. */
const DECISIONS_PER_PERSON = 20;

const consentPage = (query: string) => `/oauth/consent?${query}`;

async function signedInPerson() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? '' } : null;
}

async function spendRequest(id: string): Promise<void> {
  await supabaseAdmin.from('oauth_authorization_requests').delete().eq('id', id);
}

export async function approveConnection(formData: FormData): Promise<void> {
  const issuer = mcpOAuthEnabled() ? oauthIssuer() : null;
  if (!issuer) redirect(consentPage('error=invalid_request'));
  const requestId = String(formData.get('request') ?? '');
  const person = await signedInPerson();
  if (!person) redirect(`/sign-in?next=${encodeURIComponent(consentPage(`request=${requestId}`))}`);

  const request = await readPendingRequest(requestId);
  if (!request) redirect(consentPage('error=expired'));
  if (!(await claimRequest(request, person.id))) redirect(consentPage('error=other_person'));
  if (!(await rateHit(`consent:${person.id}`, 600, DECISIONS_PER_PERSON))) {
    redirect(consentPage('error=rate_limited'));
  }

  const connecting = await readConnectingPerson(person);
  // The plan changed since the page showed Allow: the page now says why.
  if (connecting.access !== 'ok' || !connecting.organizationId) {
    redirect(consentPage(`request=${requestId}`));
  }

  const allowChanges = formData.get('allow_changes') === 'on';
  const scopes: McpScope[] =
    allowChanges && request.scopes.includes(MCP_WRITE_SCOPE)
      ? [MCP_READ_SCOPE, MCP_WRITE_SCOPE]
      : [MCP_READ_SCOPE];
  const app = appOf(request.client_name, request.redirect_uri);
  const code = newSecret(AUTHORIZATION_CODE_PREFIX);
  const { error } = await supabaseAdmin.from('oauth_codes').insert({
    code_hash: hashSecret(code),
    client_id: request.client_id,
    user_id: person.id,
    organization_id: connecting.organizationId,
    redirect_uri: request.redirect_uri,
    code_challenge: request.code_challenge,
    scopes,
    resource: request.resource,
    client_name: app.name,
    redirect_host: app.host,
    expires_at: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) {
    console.error('[mcp-oauth] Could not save the code:', error.message);
    redirect(appRedirect(request.redirect_uri, issuer, { error: 'server_error' }, request.state));
  }
  await spendRequest(request.id);
  await logOAuthEvent({
    event: 'consent_granted',
    organizationId: connecting.organizationId,
    userId: person.id,
    clientId: request.client_id,
  });
  redirect(appRedirect(request.redirect_uri, issuer, { code }, request.state));
}

export async function denyConnection(formData: FormData): Promise<void> {
  const issuer = mcpOAuthEnabled() ? oauthIssuer() : null;
  if (!issuer) redirect(consentPage('error=invalid_request'));
  const requestId = String(formData.get('request') ?? '');
  const person = await signedInPerson();
  if (!person) redirect(`/sign-in?next=${encodeURIComponent(consentPage(`request=${requestId}`))}`);

  const request = await readPendingRequest(requestId);
  if (!request) redirect(consentPage('error=expired'));
  if (!(await claimRequest(request, person.id))) redirect(consentPage('error=other_person'));

  const connecting = await readConnectingPerson(person);
  await spendRequest(request.id);
  await logOAuthEvent({
    event:
      connecting.access === 'trial'
        ? 'blocked_trial'
        : connecting.access === 'ended'
          ? 'blocked_ended'
          : 'consent_denied',
    organizationId: connecting.organizationId,
    userId: person.id,
    clientId: request.client_id,
  });
  redirect(
    appRedirect(
      request.redirect_uri,
      issuer,
      { error: 'access_denied', description: 'The person did not allow the connection' },
      request.state,
    ),
  );
}

/** "Switch account": sign out, then sign in again on the way back to this request. */
export async function switchAccount(formData: FormData): Promise<void> {
  const requestId = String(formData.get('request') ?? '');
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/sign-in?next=${encodeURIComponent(consentPage(`request=${requestId}`))}`);
}
