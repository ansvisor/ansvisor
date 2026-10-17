'use server';

import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { mentionExcerpt } from '@/lib/mention-match';
import type { MentionsQuery } from '@/lib/mentions-filters';
import {
  MENTIONS_PAGE_SIZE,
  parseMentionsList,
  type MentionsList,
  type MentionsTableState,
} from '@/lib/mentions-list';
import { parseMentionsOverview, type MentionsOverview } from '@/lib/mentions-overview';
import type { Citation } from '@/types';

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

/**
 * A page of the Mentions table (MS-07): the answers naming the brand in the
 * window, filtered, sorted and grouped as the table asks, from mentions_list
 * (00158). Each answer's text is cut here to the passage around the brand's
 * first mention, so the page receives excerpts only.
 *
 * Null as getMentionsOverview: no function yet (PGRST202), or no access.
 */
export async function listMentions(
  brandId: string,
  query: MentionsQuery,
  table: MentionsTableState,
  page: number,
): Promise<MentionsList | null> {
  const supabase = await createClient();
  const [list, brand] = await Promise.all([
    supabase.rpc('mentions_list', {
      p_brand_id: brandId,
      p_date_from: query.from,
      p_date_to: query.to,
      p_platform: query.platform,
      p_region: query.region,
      p_topic_id: query.topicId,
      p_search: query.search,
      p_sentiment: table.sentiment || undefined,
      p_competitor_id: table.competitor || undefined,
      p_sort: table.sort,
      p_group: table.group || undefined,
      p_limit: MENTIONS_PAGE_SIZE,
      p_offset: Math.max(0, page) * MENTIONS_PAGE_SIZE,
    }),
    supabase.from('brands').select('name, brand_domains(domain)').eq('id', brandId).maybeSingle(),
  ]);
  if (list.error?.code === 'PGRST202') return null;
  if (list.error) throw new Error(list.error.message);

  // The names tracking matches the brand by: its name and its domains.
  const row = brand.data as { name?: string; brand_domains?: { domain?: string }[] } | null;
  const brandTerms = [
    row?.name ?? '',
    ...(row?.brand_domains ?? []).map((d) => d.domain ?? ''),
  ].filter(Boolean);
  const parsed = parseMentionsList(list.data, (response) => mentionExcerpt(response, brandTerms));
  return parsed ? { ...parsed, brandTerms } : null;
}

/**
 * One answer's stored text and citations, for the response drawer. Read as
 * the caller, so row-level security limits it to their organization's
 * answers; null when it isn't theirs or no longer exists.
 */
export async function getMentionResponse(
  brandId: string,
  resultId: string,
): Promise<{ response: string; citations: Citation[] } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prompt_results')
    .select('response, citations')
    .eq('id', resultId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    response: typeof data.response === 'string' ? data.response : '',
    citations: Array.isArray(data.citations) ? (data.citations as unknown as Citation[]) : [],
  };
}

/**
 * "Send to Action Center" on the Mentions tab (MS-08): the chosen answers
 * as one action to change how AI describes the brand. The server reads the
 * answers again; the excerpts are the table's, so the action quotes what the
 * person saw. The same answers sent again return the open action.
 */
export async function sendMentionsToActionCenter(
  brandId: string,
  mentions: { id: string; excerpt: string }[],
): Promise<{ actionId: string; actionNo: number; created: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${API_BASE_URL}/api/mentions/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      brandId,
      resultIds: mentions.map((m) => m.id),
      excerpts: Object.fromEntries(mentions.map((m) => [m.id, m.excerpt])),
    }),
  });

  // Returned, not thrown: a thrown error's message is masked in production.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.details || body.error || `Server error: ${res.status}` };
  }
  return res.json();
}
