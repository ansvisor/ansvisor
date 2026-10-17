'use server';

import { createClient } from '@/lib/supabase/server';
import type { MentionsQuery } from '@/lib/mentions-filters';
import { parseMentionsOverview, type MentionsOverview } from '@/lib/mentions-overview';

/**
 * The Mentions & Sentiment Overview's figures (MS-06) for a window and the
 * window before it, from the mention rollups (00157). One database call, and
 * no LLM: every figure aggregates what tracking stored.
 *
 * Null when there is nothing to read: the database doesn't have the function
 * yet (PostgREST's PGRST202, a web build deployed before the migration), or
 * the caller isn't in the brand's organization.
 */
export async function getMentionsOverview(
  brandId: string,
  query: MentionsQuery,
): Promise<MentionsOverview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('mentions_overview', {
    p_brand_id: brandId,
    p_date_from: query.from,
    p_date_to: query.to,
    p_platform: query.platform,
    p_region: query.region,
    p_topic_id: query.topicId,
    p_search: query.search,
  });
  if (error?.code === 'PGRST202') return null;
  if (error) throw new Error(error.message);
  return parseMentionsOverview(data);
}
