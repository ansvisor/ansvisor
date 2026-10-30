import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * What a write's card names as its target when its input is a list or an id
 * (define-tool.ts `target`): the prompts, topic or competitor, read from
 * the data in the person's words. A read is scoped to the call's brand, which
 * the precedence found in the person's scope before any card opens. Server
 * only; a failed read names nothing, and the engine falls back to the input.
 */

/** Some texts in quotes, the first few, and how many more: “a”, “b” +3. */
export function listWords(items: readonly string[], shown = 2): string | null {
  const words = items.map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (words.length === 0) return null;
  const head = words
    .slice(0, shown)
    .map((word) => `“${word.length > 60 ? `${word.slice(0, 59)}…` : word}”`);
  return words.length > shown ? `${head.join(', ')} +${words.length - shown}` : head.join(', ');
}

/** A topic's name, as the brand has it; null when it isn't the brand's. */
export async function topicName(topicId: string, brandId?: string): Promise<string | null> {
  let read = supabaseAdmin.from('topics').select('name').eq('id', topicId);
  if (brandId) read = read.eq('brand_id', brandId);
  const { data, error } = await read.maybeSingle();
  if (error) throw new Error(`Could not read the topic: ${error.message}`);
  return (data?.name as string | undefined) ?? null;
}

/** The ids of a brand's prompt sets: a prompt names its set, the set its brand. */
export async function brandPromptSets(brandId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  if (error) throw new Error(`Could not read the prompt sets: ${error.message}`);
  return (data ?? []).map((row) => row.id as string);
}

/** The texts of the brand's prompts among the ids. */
export async function promptTexts(brandId: string, ids: readonly string[]): Promise<string[]> {
  const sets = await brandPromptSets(brandId);
  if (sets.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('prompts')
    .select('text')
    .in('prompt_set_id', sets)
    .in('id', [...ids]);
  if (error) throw new Error(`Could not read the prompts: ${error.message}`);
  return (data ?? []).map((row) => row.text as string);
}

/** A competitor as it is shown: its name, and its domain when it has one. */
export function competitorWords(competitor: { name: string; domain?: string | null }): string {
  return competitor.domain ? `${competitor.name} (${competitor.domain})` : competitor.name;
}

/** One of the brand's competitors, in words; null when it isn't the brand's. */
export async function competitorName(
  competitorId: string,
  brandId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('competitors')
    .select('name, domain')
    .eq('id', competitorId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the competitor: ${error.message}`);
  return data ? competitorWords(data as { name: string; domain: string }) : null;
}
