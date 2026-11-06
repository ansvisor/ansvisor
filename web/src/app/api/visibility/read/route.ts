import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { brandHasCitations, getCitationGaps, getCitationsOverview } from '@/lib/actions/citations';
import { getCompetitors } from '@/lib/actions/competitor';
import { getMentionsOverview, getMentionsPerception, listMentions } from '@/lib/actions/mentions';
import {
  getCompetitorProducts,
  getCompetitorSummary,
  getOwnProducts,
  getShoppingActionResults,
  getShoppingAiOrders,
  getShoppingAmazonShareDropAlert,
  getShoppingCategories,
  getShoppingFilterOptions,
  getShoppingOverview,
  getShoppingProducts,
  getShoppingSearchAppearance,
  getShoppingShelf,
} from '@/lib/actions/shopping';
import { getBrandMarketCountries } from '@/lib/actions/shopping-market';
import { getOpenAiIndexRead } from '@/lib/actions/shopping-openai-index';
import { getTopics } from '@/lib/actions/topic';
import {
  getBrandFilterOptions,
  getBrandPrompts,
  getInsightsData,
  getInsightsOpportunities,
  getTrackingWindow,
} from '@/lib/actions/tracking';
import { getProductSources, getShoppingDestinations } from '@/lib/shopping/page-reads';
import { VISIBILITY_READS, type VisibilityRead } from '@/lib/visibility-reads';

/**
 * POST /api/visibility/read — one of the Visibility tabs' reads, by name,
 * with the server action's own arguments (lib/visibility-reads.ts). A route
 * because the browser runs fetches side by side, where Next runs a page's
 * server actions one at a time.
 *
 * Reads through the signed-in member's session, as the actions do, so RLS
 * and the functions' brand checks decide whose brand this is.
 */

export const runtime = 'nodejs';

// Every read takes the brand first.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const READS: Record<VisibilityRead, (brandId: string, ...rest: any[]) => Promise<unknown>> = {
  insights: getInsightsData,
  insightsOpportunities: getInsightsOpportunities,
  filterOptions: getBrandFilterOptions,
  trackingWindow: getTrackingWindow,
  prompts: getBrandPrompts,
  topics: getTopics,
  competitors: getCompetitors,
  mentionsOverview: getMentionsOverview,
  mentionsList: listMentions,
  mentionsPerception: getMentionsPerception,
  citationsOverview: getCitationsOverview,
  citationGaps: getCitationGaps,
  hasCitations: brandHasCitations,
  shoppingMarket: getBrandMarketCountries,
  shoppingFilterOptions: getShoppingFilterOptions,
  shoppingSources: getProductSources,
  shoppingAmazonAlert: getShoppingAmazonShareDropAlert,
  shoppingOverview: getShoppingOverview,
  shoppingShelf: getShoppingShelf,
  shoppingOrders: getShoppingAiOrders,
  shoppingDestinations: getShoppingDestinations,
  shoppingProducts: getShoppingProducts,
  shoppingOwnProducts: getOwnProducts,
  shoppingCategories: getShoppingCategories,
  shoppingActionResults: getShoppingActionResults,
  shoppingSearchAppearance: getShoppingSearchAppearance,
  shoppingOpenAiIndex: getOpenAiIndexRead,
  shoppingCompetitorSummary: getCompetitorSummary,
  shoppingCompetitorProducts: getCompetitorProducts,
};

/** A read slower than this is logged as a warning, not as info: well short of the database's 8 s cut-off. */
const SLOW_READ_MS = 2000;

const body = z.object({
  read: z.enum(VISIBILITY_READS),
  args: z
    .tuple([z.guid()])
    .rest(z.unknown())
    .refine((args) => args.length <= 4),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const [brandId, ...rest] = parsed.data.args;
  // JSON has no undefined: an argument left out arrives as null.
  const args = rest.map((arg) => (arg === null ? undefined : arg));
  // One log line a read, with how long it took, so a slow one shows.
  const name = parsed.data.read;
  const started = performance.now();
  const took = () => Math.round(performance.now() - started);
  try {
    const data = await READS[name](brandId, ...args);
    const ms = took();
    if (ms > SLOW_READ_MS) console.warn(`[visibility/read] ${name} ${ms}ms (slow)`);
    else console.info(`[visibility/read] ${name} ${ms}ms`);
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    // The tabs show their own failed state, with Retry; the details stay in the log.
    console.error(`[visibility/read] ${name} failed after ${took()}ms:`, err);
    return Response.json({ error: 'Failed to load' }, { status: 500 });
  }
}
