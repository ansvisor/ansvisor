/**
 * MCP over OAuth (#2141): Claude, ChatGPT and other MCP apps connect to
 * /api/mcp by signing the person in, instead of a pasted `ans_` key, which
 * keeps working. Ansvisor is its own small authorization server
 * (00510_mcp_oauth.sql): the issuer is the app's own address, and the tokens
 * it issues are good for the MCP endpoint alone.
 *
 * On wherever the app's address can be an issuer: https, or http on this
 * computer for development (MCP authorization spec 2025-11-25: "All
 * authorization server endpoints MUST be served over HTTPS"), with no path,
 * so the RFC 8414 / RFC 9728 well-known addresses sit at its root. A
 * self-hosted install on plain http elsewhere stays off.
 * MCP_OAUTH_ENABLED=false is the kill switch. While off, API keys work
 * exactly as before and no OAuth token is accepted.
 */

/** How long each piece lives, in seconds. */
export const AUTHORIZATION_REQUEST_TTL_SECONDS = 10 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** A refresh token rotates on every use; each lives this long, so an app used monthly stays connected. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/**
 * A rotated refresh token presented again this soon after its rotation is two
 * refreshes racing: refused (invalid_grant), the connection kept. Later, it
 * is a stolen token's replay: the whole connection is revoked.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 30;
/** A connection's last use is written at most this often. */
export const LAST_USED_WRITE_SECONDS = 5 * 60;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The issuer: the app's origin, from NEXT_PUBLIC_APP_URL; null when it can't be one. */
export function oauthIssuer(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:';
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (!secure && !local) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/') return null;
  return url.origin;
}

/** What switches app sign-in off: "false", and the other ways people write off. */
const SWITCHED_OFF = new Set(['false', '0', 'off', 'no']);

/**
 * Whether apps may connect to the MCP endpoint by signing in: on by default
 * with an issuer, off with MCP_OAUTH_ENABLED=false (any case).
 */
export function mcpOAuthEnabled(): boolean {
  const flag = process.env.MCP_OAUTH_ENABLED?.trim().toLowerCase() ?? '';
  return !SWITCHED_OFF.has(flag) && oauthIssuer() !== null;
}

/** The protected resource: the MCP endpoint's URL, as a person types it into Claude or ChatGPT. */
export function mcpResourceUrl(issuer: string): string {
  return `${issuer}/api/mcp`;
}

/** Where the MCP endpoint's RFC 9728 metadata is: the path-suffixed form clients try first. */
export function protectedResourceMetadataUrl(issuer: string): string {
  return `${issuer}/.well-known/oauth-protected-resource/api/mcp`;
}
