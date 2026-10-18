/**
 * The AI Traffic page's data sources strip (AT-001): which state each source
 * is in, and how a Google property is named on it.
 */

/** A snippet with no visit for this long reads as not detected, and its code box opens. */
export const SNIPPET_ACTIVE_DAYS = 7;

const DAY_MS = 86_400_000;

/** Whether the snippet has sent a visit in the last week. */
export function snippetDetected(lastVisitAt: string | null, now = Date.now()): boolean {
  if (!lastVisitAt) return false;
  return now - new Date(lastVisitAt).getTime() < SNIPPET_ACTIVE_DAYS * DAY_MS;
}

/**
 * A Google source's state: green once data has arrived, amber while the
 * first sync runs, grey otherwise. "Unmapped" is connected with no property
 * picked for this brand yet; "not configured" is a server without the keys
 * to connect at all (self-hosted without Composio).
 */
export type GoogleSourceStatus =
  | 'connected'
  | 'syncing'
  | 'unmapped'
  | 'not_connected'
  | 'not_configured';

export function googleSourceStatus(source: {
  configured: boolean;
  connected: boolean;
  mapped: boolean;
  lastDataAt: string | null;
}): GoogleSourceStatus {
  if (!source.configured) return 'not_configured';
  if (!source.connected) return 'not_connected';
  if (!source.mapped) return 'unmapped';
  return source.lastDataAt ? 'connected' : 'syncing';
}

/**
 * A Search Console property as the strip names it: the plain domain, never
 * "sc-domain:", and a URL-prefix property by its host.
 */
export function gscPropertyHost(property: string): string {
  if (property.startsWith('sc-domain:')) return property.slice('sc-domain:'.length);
  try {
    return new URL(property).host;
  } catch {
    return property;
  }
}
