/**
 * The resource a token is for (RFC 8707): the MCP endpoint's URL. The MCP
 * authorization spec 2025-11-25 says a server "MUST only accept tokens
 * specifically intended for themselves", and that implementations "SHOULD
 * accept uppercase scheme and host components". So two resources are the
 * same when they are once scheme and host are lower-cased (URL does that),
 * a default port dropped and a trailing slash ignored.
 */

/** A resource URL in the one form two equal ones share; null when it isn't one. */
export function normalizeResource(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hash || url.username || url.password) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}${url.search}`;
}

/**
 * The resource an authorization or token request is for: ours when it names
 * none (an older client) or names ours; null when it names another, which
 * the caller refuses with invalid_target.
 */
export function resolveResource(requested: string | null | undefined, ours: string): string | null {
  const canonical = normalizeResource(ours);
  if (requested === null || requested === undefined || requested === '') return canonical;
  return normalizeResource(requested) === canonical ? canonical : null;
}

/** Whether a stored resource is ours. */
export function isOurResource(stored: string, ours: string): boolean {
  const canonical = normalizeResource(ours);
  return canonical !== null && normalizeResource(stored) === canonical;
}
