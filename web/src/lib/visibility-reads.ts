import type * as citations from '@/lib/actions/citations';
import type * as competitor from '@/lib/actions/competitor';
import type * as mentions from '@/lib/actions/mentions';
import type * as shopping from '@/lib/actions/shopping';
import type * as shoppingMarket from '@/lib/actions/shopping-market';
import type * as openAiIndex from '@/lib/actions/shopping-openai-index';
import type * as topic from '@/lib/actions/topic';
import type * as tracking from '@/lib/actions/tracking';
import type * as shoppingPage from '@/lib/shopping/page-reads';

/**
 * The Visibility tabs' reads (Overview, Mentions, Citations, Product
 * Visibility, and the run line above them), from the browser, through one route
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
  // Product Visibility (Visibility's fourth tab).
  'shoppingMarket',
  'shoppingFilterOptions',
  'shoppingSources',
  'shoppingAmazonAlert',
  'shoppingOverview',
  'shoppingShelf',
  'shoppingOrders',
  'shoppingDestinations',
  'shoppingProducts',
  'shoppingOwnProducts',
  'shoppingCategories',
  'shoppingActionResults',
  'shoppingSearchAppearance',
  'shoppingOpenAiIndex',
  'shoppingCompetitorSummary',
  'shoppingCompetitorProducts',
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

// Product Visibility.
export const getBrandMarketCountries =
  via<typeof shoppingMarket.getBrandMarketCountries>('shoppingMarket');
export const getShoppingFilterOptions =
  via<typeof shopping.getShoppingFilterOptions>('shoppingFilterOptions');
export const getProductSources = via<typeof shoppingPage.getProductSources>('shoppingSources');
export const getShoppingAmazonShareDropAlert =
  via<typeof shopping.getShoppingAmazonShareDropAlert>('shoppingAmazonAlert');
export const getShoppingOverview = via<typeof shopping.getShoppingOverview>('shoppingOverview');
export const getShoppingShelf = via<typeof shopping.getShoppingShelf>('shoppingShelf');
export const getShoppingAiOrders = via<typeof shopping.getShoppingAiOrders>('shoppingOrders');
export const getShoppingDestinations =
  via<typeof shoppingPage.getShoppingDestinations>('shoppingDestinations');
export const getShoppingProducts = via<typeof shopping.getShoppingProducts>('shoppingProducts');
export const getOwnProducts = via<typeof shopping.getOwnProducts>('shoppingOwnProducts');
export const getShoppingCategories =
  via<typeof shopping.getShoppingCategories>('shoppingCategories');
export const getShoppingActionResults =
  via<typeof shopping.getShoppingActionResults>('shoppingActionResults');
export const getShoppingSearchAppearance = via<typeof shopping.getShoppingSearchAppearance>(
  'shoppingSearchAppearance',
);
export const getOpenAiIndexRead = via<typeof openAiIndex.getOpenAiIndexRead>('shoppingOpenAiIndex');
export const getCompetitorSummary = via<typeof shopping.getCompetitorSummary>(
  'shoppingCompetitorSummary',
);
export const getCompetitorProducts = via<typeof shopping.getCompetitorProducts>(
  'shoppingCompetitorProducts',
);
