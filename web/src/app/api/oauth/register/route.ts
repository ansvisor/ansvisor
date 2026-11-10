import { readRegistration, saveClient, sweepUnusedClients } from '@/lib/mcp-oauth/clients';
import { logOAuthEvent } from '@/lib/mcp-oauth/events';
import {
  enabledIssuer,
  ipKey,
  json,
  notFound,
  oauthError,
  overLimit,
  preflight,
  REGISTER_LIMITS,
} from '@/lib/mcp-oauth/http';

export const dynamic = 'force-dynamic';

/**
 * Dynamic client registration (RFC 7591): an MCP app registers itself before
 * it asks a person to connect, with no account of its own. Open, as MCP
 * clients expect, so it is limited by address and by day, and a client
 * nobody connected within a day is removed. Answers 201 with the client's id
 * (and, for a confidential client, its secret, this once).
 */
export async function POST(req: Request) {
  if (!enabledIssuer()) return notFound();

  const limited = await overLimit([
    { key: `register:${ipKey(req)}`, windowSeconds: 3600, max: REGISTER_LIMITS.perIpPerHour },
    { key: 'register:all', windowSeconds: 86_400, max: REGISTER_LIMITS.perDay },
  ]);
  if (limited) return limited;

  const text = await req.text();
  if (text.length > 10_000) {
    return oauthError('invalid_client_metadata', 'The registration is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return oauthError('invalid_client_metadata', 'The body must be JSON (RFC 7591 §3.1)');
  }

  const registration = readRegistration(body);
  if ('error' in registration) {
    return registration.error === 'invalid_redirect_uri'
      ? oauthError(
          'invalid_redirect_uri',
          `${registration.uri}: redirect URIs must be https, or http on 127.0.0.1, [::1] or localhost, with no fragment (${registration.problem})`,
        )
      : oauthError('invalid_client_metadata', registration.description);
  }

  try {
    const { client, clientSecret, createdAt } = await saveClient(registration);
    sweepUnusedClients();
    await logOAuthEvent({ event: 'client_registered', clientId: client.client_id, req });
    return json(
      {
        client_id: client.client_id,
        client_id_issued_at: Math.floor(Date.parse(createdAt) / 1000),
        ...(client.client_name ? { client_name: client.client_name } : {}),
        redirect_uris: client.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      },
      201,
    );
  } catch (err) {
    console.error('[mcp-oauth] Could not register a client:', err);
    return oauthError('server_error', 'Could not register the client, try again', 500);
  }
}

export function OPTIONS() {
  return preflight();
}
