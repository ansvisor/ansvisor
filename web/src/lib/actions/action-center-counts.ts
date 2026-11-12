'use server';

import { createClient } from '@/lib/supabase/server';

/**
 * How many actions are open for the signed-in person on a brand, as Today
 * ranks them (GET /api/action-center/today, the Inbox's candidates): new or
 * in progress, unassigned or theirs, not deleted. On hold waits on someone
 * else and isn't counted. The count beside Action Center › Actions. Read as the person (RLS), one number
 * back; 0 when it can't be read, so a failed count shows nothing.
 */
export async function getMyOpenActionCount(brandId: string): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count, error } = await supabase
    .from('actions')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .in('status', ['new', 'in_progress'])
    .is('deleted_at', null)
    .or(`assignee_id.is.null,assignee_id.eq.${user.id}`);
  return error ? 0 : (count ?? 0);
}
