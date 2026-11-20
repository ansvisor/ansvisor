'use server';

import { createClient } from '@/lib/supabase/server';
import {
  OPEN_ACTION_STATUSES,
  countOpenActions,
  type ActionStatus,
  type OpenActionCounts,
} from '@/lib/action-center/registry';

/**
 * A brand's open actions (AC-01): new, in progress or on hold, whoever
 * they're assigned to, not deleted — the count Today's Actions step shows and
 * the Actions list's All pill shows on Open. With it, how many are on hold
 * and how many are the signed-in person's. Read as the person (RLS) and
 * counted by `countOpenActions`, the helper the Actions list counts with;
 * the list's 1000-row cap too. Throws when it can't be read, so a failed
 * count shows nothing.
 */
export async function getOpenActionCounts(brandId: string): Promise<OpenActionCounts> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('actions')
    .select('status, assignee_id')
    .eq('brand_id', brandId)
    .in('status', [...OPEN_ACTION_STATUSES])
    .is('deleted_at', null)
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { status: ActionStatus; assignee_id: string | null }[];
  return countOpenActions(
    rows.map((row) => ({ status: row.status, assigneeId: row.assignee_id })),
    user.id,
  );
}
