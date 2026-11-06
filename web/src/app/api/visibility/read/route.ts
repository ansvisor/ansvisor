import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { brandHasCitations, getCitationGaps, getCitationsOverview } from '@/lib/actions/citations';
import { getCompetitors } from '@/lib/actions/competitor';
import { getMentionsOverview, getMentionsPerception, listMentions } from '@/lib/actions/mentions';
import { getTopics } from '@/lib/actions/topic';
import {
  getBrandFilterOptions,
  getBrandPrompts,
  getInsightsData,
  getInsightsOpportunities,
  getTrackingWindow,
} from '@/lib/actions/tracking';
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
};

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
  try {
    const data = await READS[parsed.data.read](brandId, ...args);
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    // The tabs show their own failed state, with Retry; the details stay in the log.
    console.error(`[visibility/read] ${parsed.data.read} failed:`, err);
    return Response.json({ error: 'Failed to load' }, { status: 500 });
  }
}
