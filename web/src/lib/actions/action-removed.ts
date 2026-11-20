'use server';

import { createClient } from '@/lib/supabase/server';
import {
  removedListOf,
  type RemovedEntityRow,
  type RemovedTarget,
} from '@/lib/action-center/removed-list';

/** Removed targets listed at most: past these, the note says how many more. */
const REMOVED_SHOWN = 200;

/**
 * What an action lost since it was created, each with why — deleted or
 * paused (AC-13). Read as the member, under their policies: an action they
 * can't read has no list. Null when it can't be read, so the note shows the
 * names it already has, without reasons.
 */
export async function getRemovedTargets(actionId: string): Promise<RemovedTarget[] | null> {
  const supabase = await createClient();
  const { data: action, error: actionError } = await supabase
    .from('actions')
    .select('id, payload')
    .eq('id', actionId)
    .maybeSingle();
  if (actionError || !action) return null;
  const entity = (action.payload as Record<string, unknown> | null)?.targetEntity;
  if (typeof entity !== 'string') return null;

  const { data, error } = await supabase
    .from('action_entities')
    .select('entity_key, label, removed_reason')
    .eq('action_id', action.id)
    .eq('entity_type', entity)
    .not('removed_at', 'is', null)
    .order('removed_at', { ascending: false })
    .order('entity_key')
    .limit(REMOVED_SHOWN);
  if (error) return null;
  return removedListOf((data ?? []) as RemovedEntityRow[]);
}
