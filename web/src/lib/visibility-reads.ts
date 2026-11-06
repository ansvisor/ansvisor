import type * as citations from '@/lib/actions/citations';
import type * as competitor from '@/lib/actions/competitor';
import type * as mentions from '@/lib/actions/mentions';
import type * as topic from '@/lib/actions/topic';
import type * as tracking from '@/lib/actions/tracking';

/**
 * The Visibility tabs' reads (Overview, Mentions, Citations, and the run
 * line above them), from the browser, through one route
 * (/api/visibility/read) rather than as server actions.
 *
 * Next runs a page's server actions one at a time: opening a tab sent five
 * or six reads, and each waited for the one before it (and for the menu's
 * own), so a tab took the sum of its reads. Fetches to a route run side by
 * side, so it takes the slowest one. Each function keeps its server action's
 * name and arguments; the route calls that action with the member's session.
 * The same pattern as the AI Traffic page's (traffic-reads.ts).
 */

export const VISIBILITY_READS = [
  'insights',
  'insightsOpportunities',
  'filterOptions',
  'trackingWindow',
  'prompts',
  'topics',
  'competitors',
  'mentionsOverview',
  'mentionsList',
  'mentionsPerception',
  'citationsOverview',
  'citationGaps',
  'hasCitations',
] as const;
export type VisibilityRead = (typeof VISIBILITY_READS)[number];

async function read<T>(name: VisibilityRead, args: unknown[]): Promise<T> {
  const res = await fetch('/api/visibility/read', {
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
  <F extends Read>(name: VisibilityRead) =>
  (...args: Parameters<F>) =>
    read<Awaited<ReturnType<F>>>(name, args);

export const getInsightsData = via<typeof tracking.getInsightsData>('insights');
export const getInsightsOpportunities =
  via<typeof tracking.getInsightsOpportunities>('insightsOpportunities');
export const getBrandFilterOptions = via<typeof tracking.getBrandFilterOptions>('filterOptions');
export const getTrackingWindow = via<typeof tracking.getTrackingWindow>('trackingWindow');
export const getBrandPrompts = via<typeof tracking.getBrandPrompts>('prompts');
export const getTopics = via<typeof topic.getTopics>('topics');
export const getCompetitors = via<typeof competitor.getCompetitors>('competitors');
export const getMentionsOverview = via<typeof mentions.getMentionsOverview>('mentionsOverview');
export const listMentions = via<typeof mentions.listMentions>('mentionsList');
export const getMentionsPerception =
  via<typeof mentions.getMentionsPerception>('mentionsPerception');
export const getCitationsOverview = via<typeof citations.getCitationsOverview>('citationsOverview');
export const getCitationGaps = via<typeof citations.getCitationGaps>('citationGaps');
export const brandHasCitations = via<typeof citations.brandHasCitations>('hasCitations');
