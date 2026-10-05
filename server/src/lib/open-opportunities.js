import supabaseAdmin from '../config/supabase.js';

const PAGE = 1000;

/**
 * A brand's cluster opportunities, every status, as { id, title, status,
 * cluster_id, related_cluster_ids, opportunity_score, targetPages }. Paged: a
 * large brand can hold more than PostgREST's 1,000-row default, and a short
 * read would let a covered cluster be suggested again.
 */
export async function loadClusterOpportunities(brandId) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .select(
        'id, title, status, cluster_id, related_cluster_ids, opportunity_score, targetPages:source_data->targetPages',
      )
      .eq('brand_id', brandId)
      .not('cluster_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}
