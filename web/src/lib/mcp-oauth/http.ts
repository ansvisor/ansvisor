import { NextResponse } from 'next/server';
import { mcpOAuthEnabled, oauthIssuer } from './config';
import { requestIp } from './events';
import { rateHit } from './rate-limit';

/**
 * What the OAuth endpoints share (MCP over OAuth, #2141): off (404) unless
 * MCP_OAUTH_ENABLED; CORS for browser-based clients such as MCP Inspector
 * (no cookies are read, so any origin may call); RFC 6749 §5.2 errors; and
 * no caching of anything that carries a token (§5.1).
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
} as const;

/** Registrations an address may make in an hour, and all of them in a day. */
export const REGISTER_LIMITS = { perIpPerHour: 30, perDay: 2000 } as const;

/** Token requests a client may make a minute, and an address (Claude's traffic shares a few). */
export const TOKEN_LIMITS = { perClientPerMinute: 120, perIpPerMinute: 600 } as const;

export const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' } as const;

/** The issuer while MCP over OAuth is on; null answers 404. */
export function enabledIssuer(): string | null {
  return mcpOAuthEnabled() ? oauthIssuer() : null;
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404, headers: CORS_HEADERS });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...CORS_HEADERS, ...NO_STORE, ...headers },
  });
}

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
  | 'temporarily_unavailable'
  | 'server_error';

/** An OAuth error: its code, and words a developer can act on. */
export function oauthError(
  error: OAuthErrorCode,
  description: string,
  status = 400,
  headers: Record<string, string> = {},
): NextResponse {
  return json({ error, error_description: description }, status, headers);
}

export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return oauthError('temporarily_unavailable', 'Too many requests. Try again shortly.', 429, {
    'Retry-After': String(retryAfterSeconds),
  });
}

/**
 * The caller's address as a rate limit's key: an IPv4 address as it is, an
 * IPv6 one by its /64, as the API server's anonymousIpKey keys it, so a
 * caller can't step around the limit through its subnet.
 */
export function ipKey(req: Request): string {
  const ip = requestIp(req);
  if (!ip) return 'ip:unknown';
  if (!ip.includes(':') || ip.includes('.')) return `ip:${ip}`;
  const [head, tail = ''] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const zeros = Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0');
  return `ip:${[...headGroups, ...zeros, ...tailGroups].slice(0, 4).join(':')}::/64`;
}

/** One hit on each limit: the first one over answers 429. */
export async function overLimit(
  limits: { key: string; windowSeconds: number; max: number }[],
): Promise<NextResponse | null> {
  for (const limit of limits) {
    if (!(await rateHit(limit.key, limit.windowSeconds, limit.max))) {
      return tooManyRequests(limit.windowSeconds);
    }
  }
  return null;
}

/** The body of a form post (RFC 6749 §4.1.3), or null when it isn't one. */
export async function readForm(req: Request): Promise<URLSearchParams | null> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/x-www-form-urlencoded')) return null;
  const text = await req.text();
  if (text.length > 16_000) return null;
  return new URLSearchParams(text);
}
