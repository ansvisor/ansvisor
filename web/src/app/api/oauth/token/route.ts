import { authenticateClient, presentedCredentials } from '@/lib/mcp-oauth/clients';
import {
  enabledIssuer,
  ipKey,
  json,
  notFound,
  oauthError,
  overLimit,
  preflight,
  readForm,
  TOKEN_LIMITS,
} from '@/lib/mcp-oauth/http';
import { redeemCode, refreshTokens } from '@/lib/mcp-oauth/token-grants';

export const dynamic = 'force-dynamic';

/**
 * The token endpoint (OAuth 2.1 §3.2): a code for a connection's first
 * tokens, a refresh token for new ones. A form post, as RFC 6749 §4.1.3 and
 * Claude require. Every answer is no-store.
 */
export async function POST(req: Request) {
  const issuer = enabledIssuer();
  if (!issuer) return notFound();

  const form = await readForm(req);
  if (!form) {
    return oauthError(
      'invalid_request',
      'Send the request as application/x-www-form-urlencoded (RFC 6749 §4.1.3)',
    );
  }

  const presented = presentedCredentials(req, form);
  const limited = await overLimit([
    { key: `token:${ipKey(req)}`, windowSeconds: 60, max: TOKEN_LIMITS.perIpPerMinute },
    ...(presented
      ? [
          {
            key: `token:client:${presented.clientId}`,
            windowSeconds: 60,
            max: TOKEN_LIMITS.perClientPerMinute,
          },
        ]
      : []),
  ]);
  if (limited) return limited;

  try {
    const client = await authenticateClient(req, form);
    if (!client) {
      return oauthError(
        'invalid_client',
        'Unknown client, or its credentials are wrong',
        401,
        presented?.basic ? { 'WWW-Authenticate': 'Basic realm="ansvisor"' } : {},
      );
    }

    const grantType = form.get('grant_type');
    const result =
      grantType === 'authorization_code'
        ? await redeemCode(
            client,
            {
              code: form.get('code'),
              redirectUri: form.get('redirect_uri'),
              codeVerifier: form.get('code_verifier'),
              resource: form.get('resource'),
            },
            issuer,
            req,
          )
        : grantType === 'refresh_token'
          ? await refreshTokens(
              client,
              {
                refreshToken: form.get('refresh_token'),
                scope: form.get('scope'),
                resource: form.get('resource'),
              },
              issuer,
              req,
            )
          : null;

    if (!result) {
      return oauthError(
        'unsupported_grant_type',
        'grant_type must be authorization_code or refresh_token',
      );
    }
    return result.ok ? json(result.body) : oauthError(result.error, result.description);
  } catch (err) {
    console.error('[mcp-oauth] Token request failed:', err);
    return oauthError('server_error', 'Could not issue tokens, try again', 500);
  }
}

export function OPTIONS() {
  return preflight();
}
