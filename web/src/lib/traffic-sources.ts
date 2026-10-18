/**
 * The AI Traffic page's data sources (AT-001, AT-016): which state each
 * source is in, how a Google property is named, and which sections need
 * which source.
 */

import type { IntegrationProvider } from '@/lib/actions/integrations';

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

/** Where a Google source's connection and property are managed. */
export const INTEGRATIONS_SETTINGS_PATH = '/dashboard/settings?tab=integrations';

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

/**
 * The host a connected source's property line names: the Search Console
 * property's own host, or the brand's domain for Google Analytics, whose
 * property id names no site. The property itself when nothing better is known.
 */
export function sourceHost(
  provider: IntegrationProvider,
  property: string | null,
  domain: string | undefined,
): string {
  if (provider === 'google-search-console' && property) return gscPropertyHost(property);
  return domain ?? property ?? '';
}

/**
 * The AI Traffic sections that need a Google source, and which one: the
 * spec's dependency matrix (§3.8b). A section shows its source's state when
 * it isn't connected, and the not-connected state lists every section the
 * source unlocks. Sections that read only the snippet aren't listed; each
 * later section adds its own entry.
 */
export const TRAFFIC_SECTION_SOURCES = {
  aiShare: 'google-analytics',
  engagedVisits: 'google-analytics',
  keyEvents: 'google-analytics',
  googleClicks: 'google-search-console',
  pageValue: 'google-analytics',
} as const satisfies Record<string, IntegrationProvider>;

export type TrafficSection = keyof typeof TRAFFIC_SECTION_SOURCES;

/** The sections a source unlocks, in the page's order. */
export function sectionsNeeding(provider: IntegrationProvider): TrafficSection[] {
  return (Object.keys(TRAFFIC_SECTION_SOURCES) as TrafficSection[]).filter(
    (section) => TRAFFIC_SECTION_SOURCES[section] === provider,
  );
}
