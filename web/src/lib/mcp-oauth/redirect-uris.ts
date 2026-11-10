/**
 * The addresses an app may send a person back to after they decide (MCP
 * authorization spec 2025-11-25: "All redirect URIs MUST be either localhost
 * or use HTTPS", matched exactly against what the app registered).
 *
 *   * https://…, or http:// on this computer (127.0.0.1, [::1], localhost):
 *     no fragment, no user or password, no wildcard, 2,000 characters at
 *     most. Custom schemes (myapp://…) are refused for now (owner,
 *     2026-11-10): those apps keep using API keys.
 *   * A loopback address matches on any port (RFC 8252 §7.3): a desktop app
 *     such as Claude Code listens on a port it picks each time. Claude Code
 *     registers localhost as well as 127.0.0.1, so localhost gets the same
 *     match, though RFC 8252 §8.3 discourages it.
 */

export const MAX_REDIRECT_URIS = 5;
const MAX_LENGTH = 2000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export type RedirectUriProblem =
  | 'not_a_url'
  | 'too_long'
  | 'scheme'
  | 'fragment'
  | 'credentials'
  | 'wildcard';

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** What's wrong with an address an app wants to register, or null when it may. */
export function checkRedirectUri(value: string): RedirectUriProblem | null {
  if (value.length > MAX_LENGTH) return 'too_long';
  const url = parse(value);
  if (!url) return 'not_a_url';
  if (value.includes('#')) return 'fragment';
  if (url.username || url.password) return 'credentials';
  if (value.includes('*')) return 'wildcard';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return null;
  return 'scheme';
}

/** Whether a requested address is one the app registered: exactly, or a loopback one on any port. */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const asked = parse(requested);
  if (!asked || asked.protocol !== 'http:' || !isLoopbackHost(asked.hostname)) return false;
  if (requested.includes('#') || asked.username || asked.password) return false;
  return registered.some((value) => {
    const url = parse(value);
    return (
      url !== null &&
      url.protocol === 'http:' &&
      url.hostname === asked.hostname &&
      url.pathname === asked.pathname &&
      url.search === asked.search
    );
  });
}

/** The host a person is sent back to, as the consent page names it. */
export function redirectHost(value: string): string {
  return parse(value)?.hostname ?? value;
}
