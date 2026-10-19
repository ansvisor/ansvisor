import supabaseAdmin from '../config/supabase.js';

const PAGE = 1000;

/**
 * A brand's open (status 'new') opportunities, as { prompt_id, title }. Paged:
 * a large brand holds more than PostgREST's 1,000-row default, and a short
 * read would undercount the per-prompt cap.
 */
export async function loadOpenOpportunities(brandId) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .select('prompt_id, title')
      .eq('brand_id', brandId)
      .eq('status', 'new')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}
