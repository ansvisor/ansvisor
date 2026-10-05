const PAGE_SIZE = 1000;

export interface HeadToHeadResultRow {
  id: string;
  prompt_id: string;
  visibility_score: number;
  model_used: string | null;
  platform: string | null;
  competitor_mentions: unknown;
  region: string | null;
  response: string | null;
  citations: unknown;
  sentiment: string | null;
  mention_count: number;
  citation_count: number;
  created_at: string;
}

interface HeadToHeadQuery {
  select(columns: string): HeadToHeadQuery;
  eq(column: string, value: string): HeadToHeadQuery;
  neq(column: string, value: string): HeadToHeadQuery;
  order(column: string, options: { ascending: boolean }): HeadToHeadQuery;
  range(from: number, to: number): Promise<{
    data: HeadToHeadResultRow[] | null;
    error: { message: string } | null;
  }>;
}

interface HeadToHeadClient {
  from(table: string): HeadToHeadQuery;
}

/**
 * Load every prompt result used by the competitor head-to-head calculation.
 *
 * Supabase/PostgREST applies a server-side max_rows limit (1,000 in this
 * project). Always page explicitly so a large brand's comparison is complete.
 */
export async function fetchHeadToHeadResults(
  supabase: HeadToHeadClient,
  brandId: string,
): Promise<HeadToHeadResultRow[]> {
  const rows: HeadToHeadResultRow[] = [];
  const columns =
    'id,prompt_id,visibility_score,model_used,platform,competitor_mentions,region,response,citations,sentiment,mention_count,citation_count,created_at';

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('prompt_results')
      .select(columns)
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) return rows;
  }
}
