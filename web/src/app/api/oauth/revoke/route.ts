import { authenticateClient } from '@/lib/mcp-oauth/clients';
import {
  enabledIssuer,
  ipKey,
  json,
  notFound,
  oauthError,
  overLimit,
  preflight,
  readForm,
} from '@/lib/mcp-oauth/http';
import { revokeTokenByClient } from '@/lib/mcp-oauth/token-grants';

export const dynamic = 'force-dynamic';

/**
 * Token revocation (RFC 7009): an app disconnects itself. Revoking any of a
 * connection's tokens ends the connection, as Disconnect in Settings does.
 * An unknown token is no error (§2.2): the answer is 200 either way, so it
 * tells nothing about the token.
 */
export async function POST(req: Request) {
  if (!enabledIssuer()) return notFound();

  const form = await readForm(req);
  if (!form) {
    return oauthError('invalid_request', 'Send the request as application/x-www-form-urlencoded');
  }
  const limited = await overLimit([{ key: `revoke:${ipKey(req)}`, windowSeconds: 60, max: 120 }]);
  if (limited) return limited;

  const token = form.get('token');
  if (!token) return oauthError('invalid_request', 'token is required');

  try {
    const client = await authenticateClient(req, form);
    if (!client) {
      return oauthError('invalid_client', 'Unknown client, or its credentials are wrong', 401);
    }
    const outcome = await revokeTokenByClient(client, token, req);
    if (outcome === 'other_client') {
      return oauthError('unauthorized_client', 'The token was issued to another client');
    }
    return json({});
  } catch (err) {
    console.error('[mcp-oauth] Revocation failed:', err);
    return oauthError('server_error', 'Could not revoke the token, try again', 500);
  }
}

export function OPTIONS() {
  return preflight();
}
