'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscription-guard';
import {
  cleanContentRules,
  contentRulesOf,
  type ContentRules,
  type RulesError,
} from '@/lib/content/content-rules';

/**
 * A brand's content rules (brands.content_rules): banned phrases and source
 * allow/deny lists. Read by any member of the brand; changed by an Admin or
 * a Manager, as the brands row policy has it. Errors come back as values.
 */

const brandIdSchema = z.guid();

export async function getContentRules(brandId: string): Promise<ContentRules | null> {
  if (!brandIdSchema.safeParse(brandId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .select('content_rules')
    .eq('id', brandId)
    .maybeSingle();
  if (error || !data) return null;
  return contentRulesOf(data.content_rules);
}

/** Saves the rules, cleaned: domains as the app keeps them, lists capped. */
export async function updateContentRules(
  brandId: string,
  input: ContentRules,
): Promise<{ rules: ContentRules } | { error: RulesError | 'forbidden' | 'failed' }> {
  await assertWritable({ brandId });
  if (!brandIdSchema.safeParse(brandId).success) return { error: 'invalid' };
  const cleaned = cleanContentRules(input);
  if ('error' in cleaned) return cleaned;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .update({ content_rules: cleaned.rules })
    .eq('id', brandId)
    .select('id');
  if (error) return { error: 'failed' };
  // No row changed without an error: the row policy left the person out (an analyst or a viewer).
  if (!data || data.length === 0) return { error: 'forbidden' };
  revalidatePath('/dashboard/brands');
  return { rules: cleaned.rules };
}
