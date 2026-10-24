'use server';

import { createClient } from '@/lib/supabase/server';

const PROMPT_PAGE_SIZE = 1000;
const PROMPT_MAX_ROWS = 20_000;

/**
 * The brand's countries, for its AI shopping market (#1278): its domains'
 * `country` and every location code its prompts track (`prompts.regions`,
 * states included), deduped and sorted. Codes come back as stored;
 * `marketForCountry` normalizes them. RLS scopes both reads to the caller's
 * organization.
 */
export async function getBrandMarketCountries(brandId: string): Promise<string[]> {
  const supabase = await createClient();
  const countries = new Set<string>();
  const add = (code: string | null | undefined) => {
    const trimmed = code?.trim();
    if (trimmed) countries.add(trimmed);
  };

  const readDomains = async () => {
    const { data, error } = await supabase
      .from('brand_domains')
      .select('country')
      .eq('brand_id', brandId);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) add(row.country);
  };

  // Paged: an unpaged select stops at PostgREST's 1,000-row cap (#922).
  const readPrompts = async () => {
    for (let start = 0; start < PROMPT_MAX_ROWS; start += PROMPT_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('prompts')
        .select('id, regions, prompt_sets!inner(brand_id)')
        .eq('prompt_sets.brand_id', brandId)
        .order('id')
        .range(start, start + PROMPT_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const row of rows) for (const code of row.regions ?? []) add(code);
      if (rows.length < PROMPT_PAGE_SIZE) break;
    }
  };

  await Promise.all([readDomains(), readPrompts()]);
  return [...countries].sort();
}
