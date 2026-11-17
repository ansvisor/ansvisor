import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/**
 * The most active prompts one read looks at: PostgREST's row cap. A brand
 * past it (no plan allows that many) leaves the rest out, which reads as
 * "has answers": Track now never offers a prompt it couldn't check.
 */
const MAX_PROMPTS = 1000;

/**
 * The brand's active prompts with no answers yet (Track now on Tracked
 * Prompts): the same question the API's GET /api/tracking/unanalyzed answers,
 * asked of the database the cheap way. Each active prompt is joined to at
 * most one of its answers (`prompt_results`, by its prompt_id index, scoped
 * to the brand), so the read costs one index probe a prompt, never the
 * prompts' result rows. The unanalyzed route reads those rows for every
 * active prompt, and its 1,000-row cap cut a big brand's list short.
 *
 * Read through `supabase`, the member's RLS-scoped client: another
 * organisation's brand has no prompts here.
 */
export async function readUnansweredPromptIds(
  supabase: SupabaseClient<Database>,
  brandId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id), prompt_results(id)')
    .eq('prompt_sets.brand_id', brandId)
    .eq('is_active', true)
    .eq('prompt_results.brand_id', brandId)
    .limit(1, { referencedTable: 'prompt_results' })
    .order('id')
    .limit(MAX_PROMPTS);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { id: string; prompt_results: unknown[] | null }[])
    .filter((row) => !row.prompt_results || row.prompt_results.length === 0)
    .map((row) => row.id);
}
