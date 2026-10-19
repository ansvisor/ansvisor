import type * as traffic from '@/lib/actions/traffic';
import type * as aiBots from '@/lib/actions/ai-bots';

/**
 * The AI Traffic page's reads, from the browser, through one route
 * (/api/traffic/read) rather than as server actions.
 *
 * Next runs a page's server actions one at a time: a range change asked a
 * dozen sections for data, and each read waited for the one before it, so
 * the page took the sum of every read. Fetches to a route run side by side,
 * so it takes the slowest one. Each function keeps its server action's name
 * and arguments; the route calls that action with the member's session.
 */

export const TRAFFIC_READS = [
  'sources',
  'summary',
  'trend',
  'logs',
  'pages',
  'conversions',
  'googleTotals',
  'googleTrend',
  'googlePages',
  'untrackedQueries',
  'bots',
  'botConnections',
] as const;
export type TrafficRead = (typeof TRAFFIC_READS)[number];

async function read<T>(name: TrafficRead, args: unknown[]): Promise<T> {
  const res = await fetch('/api/traffic/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: name, args }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(body.error || `Failed to load ${name}`);
  return body.data as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Read = (...args: any[]) => Promise<unknown>;
const via =
  <F extends Read>(name: TrafficRead) =>
  (...args: Parameters<F>) =>
    read<Awaited<ReturnType<F>>>(name, args);

export const getTrafficSources = via<typeof traffic.getTrafficSources>('sources');
export const getTrafficSummary = via<typeof traffic.getTrafficSummary>('summary');
export const getTrafficTrend = via<typeof traffic.getTrafficTrend>('trend');
export const getTrafficLogs = via<typeof traffic.getTrafficLogs>('logs');
export const getTrafficPages = via<typeof traffic.getTrafficPages>('pages');
export const getTrafficConversions = via<typeof traffic.getTrafficConversions>('conversions');
export const getTrafficGoogleTotals = via<typeof traffic.getTrafficGoogleTotals>('googleTotals');
export const getTrafficGoogleTrend = via<typeof traffic.getTrafficGoogleTrend>('googleTrend');
export const getTrafficGooglePages = via<typeof traffic.getTrafficGooglePages>('googlePages');
export const getUntrackedGoogleQueries =
  via<typeof traffic.getUntrackedGoogleQueries>('untrackedQueries');
export const getTrafficBots = via<typeof traffic.getTrafficBots>('bots');
export const getBotConnections = via<typeof aiBots.getBotConnections>('botConnections');
