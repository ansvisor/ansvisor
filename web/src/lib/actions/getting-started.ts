'use server';

/**
 * Getting started (New Ansvisor, AC-ALT2 §4): the 17 setup steps in the
 * Actions page. Reads the brand's facts in one call (getting_started_facts,
 * 00196) and turns them into steps in lib/getting-started/steps.ts; stores
 * only what the data can't show — a page opened, an optional step skipped.
 */

import { createClient } from '@/lib/supabase/server';
import {
  GETTING_STARTED_STEPS,
  buildGettingStarted,
  isPageOpenedStep,
  parseGettingStartedFacts,
  type GettingStartedStatus,
} from '@/lib/getting-started/steps';

/** The brand's steps, or null for a brand the caller can't see. */
export async function getGettingStarted(brandId: string): Promise<GettingStartedStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('getting_started_facts', { p_brand_id: brandId });
  if (error) throw new Error(error.message);
  const facts = parseGettingStartedFacts(data);
  return facts ? buildGettingStarted(facts) : null;
}

/**
 * One of the explore pages was opened. Recorded once the brand's first
 * answers are in, so a page opened while it had nothing to show doesn't
 * count. True when the step is recorded, now or before.
 */
export async function markGettingStartedPageOpened(
  brandId: string,
  step: string,
): Promise<boolean> {
  if (!isPageOpenedStep(step)) throw new Error('not a page step');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('getting_started_page_opened', {
    p_brand_id: brandId,
    p_step: step,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/** Skip an optional step (Search Console, Analytics). It counts as complete. */
export async function skipGettingStartedStep(brandId: string, step: string): Promise<void> {
  if (!GETTING_STARTED_STEPS.some((s) => s.key === step && s.optional)) {
    throw new Error('not an optional step');
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('getting_started_steps')
    .upsert(
      { brand_id: brandId, step, state: 'skipped', updated_at: new Date().toISOString() },
      { onConflict: 'brand_id,step' },
    );
  if (error) throw new Error(error.message);
}
