import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import {
  IMPROVE_TRACKED_STATUSES,
  pickImprovingAction,
  type ImprovingAction,
} from '@/lib/improve-outcome';

/**
 * Which prompts have an Improve action still being tracked (PROMPT-008), read
 * one way for both places that show it: the Positions panel's "Improving"
 * chip (one prompt) and the link under the Tracked Prompts table's Work chip
 * (a page of prompts, in one read).
 *
 * Still tracked is pickImprovingAction's rule: the newest of the prompt's
 * Improve actions that is open, or completed with its final read not yet
 * taken. The query leaves out what that rule never picks (other statuses,
 * final reads), as the server's daily sweep does, so final reads piling up
 * over months never fill the limit; pickImprovingAction still decides.
 */

/**
 * The most prompt ids one read takes: a Tracked Prompts page (PAGE_SIZE in
 * components/table-pager), and an `in` filter well under PostgREST's URL limit.
 */
export const MAX_IMPROVING_PROMPTS = 100;

/** Rows one read returns at most: ten a prompt on a full page, the panel's old cap. */
const MAX_ROWS = 1000;

const PROMPT_IMPROVE = 'prompt_improve';

/**
 * The brand's prompts among `promptIds` with an Improve action still being
 * tracked, by prompt id. One query, whatever the number of ids, scoped to
 * the brand; read through `supabase`, the caller's RLS-scoped client, so
 * only a brand of the caller's organisation (and brand access) has rows.
 * A row of another brand or prompt is never used, whatever comes back.
 */
export async function readImprovingActions(
  supabase: SupabaseClient<Database>,
  brandId: string,
  promptIds: readonly string[],
): Promise<Map<string, ImprovingAction>> {
  const wanted = new Set(promptIds);
  if (wanted.size === 0) return new Map();
  if (wanted.size > MAX_IMPROVING_PROMPTS) throw new Error('Too many prompts');
  return readTracked(supabase, brandId, wanted);
}

/**
 * Every prompt of the brand with an Improve action still being tracked, by
 * prompt id: the Tracked Prompts table's first read (getPromptsPageData), so
 * the links under the Work chips come with the rows rather than one read a
 * page after them. The same query without the prompt filter, scoped to the
 * brand the same way.
 */
export async function readBrandImprovingActions(
  supabase: SupabaseClient<Database>,
  brandId: string,
): Promise<Map<string, ImprovingAction>> {
  return readTracked(supabase, brandId, null);
}

async function readTracked(
  supabase: SupabaseClient<Database>,
  brandId: string,
  wanted: ReadonlySet<string> | null,
): Promise<Map<string, ImprovingAction>> {
  let query = supabase
    .from('actions')
    .select(
      'id, brand_id, action_no, brand_no, status, position_outcome, prompt_id:payload->>promptId',
    )
    .eq('brand_id', brandId)
    .eq('kind', PROMPT_IMPROVE);
  if (wanted) query = query.in('payload->>promptId', [...wanted]);
  const { data, error } = await query
    .in('status', [...IMPROVE_TRACKED_STATUSES])
    .or(
      'position_outcome.is.null,position_outcome->>final.is.null,position_outcome->>final.neq.true',
    )
    .is('deleted_at', null)
    // Newest first: pickImprovingAction takes the first one still tracked.
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(error.message);

  const rowsByPrompt = new Map<string, Parameters<typeof pickImprovingAction>[0]>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const promptId = row.prompt_id;
    if (row.brand_id !== brandId || typeof promptId !== 'string') continue;
    if (wanted && !wanted.has(promptId)) continue;
    const rows = rowsByPrompt.get(promptId) ?? [];
    rows.push({
      id: row.id as string,
      action_no: Number(row.action_no),
      brand_no: (row.brand_no as number | null) ?? null,
      status: row.status as string,
      position_outcome: row.position_outcome,
    });
    rowsByPrompt.set(promptId, rows);
  }

  const improving = new Map<string, ImprovingAction>();
  for (const [promptId, rows] of rowsByPrompt) {
    const action = pickImprovingAction(rows);
    if (action) improving.set(promptId, action);
  }
  return improving;
}
