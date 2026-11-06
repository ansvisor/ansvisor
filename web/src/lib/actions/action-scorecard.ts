'use server';

/**
 * The History tab's scorecard read (learning B3): the brand's actions summed
 * by kind in the database (action_scorecard, 00368). Read with the member's
 * session, so RLS keeps it to their organization's brands.
 */

import { createClient } from '@/lib/supabase/server';
import {
  parseScorecardRow,
  sortScorecard,
  type ScorecardBy,
  type ScorecardRow,
} from '@/lib/action-center/scorecard';

/**
 * One row per kind of the brand's actions raised since `from` (every one
 * when absent); by play (AC plan P-4, 00484), one per play the actions
 * were opened with, the row's `kind` holding the play's id.
 */
export async function getActionScorecard(
  brandId: string,
  opts?: { from?: string; by?: ScorecardBy },
): Promise<ScorecardRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('action_scorecard', {
    p_brand_id: brandId,
    p_since: opts?.from ?? null,
    // Called as before by kind, so a database before 00484 still answers.
    ...(opts?.by === 'play' ? { p_by: 'play' } : {}),
  });
  if (error) throw new Error(error.message);
  return sortScorecard(
    (data ?? []).map(parseScorecardRow).filter((row): row is ScorecardRow => row !== null),
  );
}
