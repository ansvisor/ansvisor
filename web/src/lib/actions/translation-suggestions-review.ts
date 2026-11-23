'use server';

import { revalidatePath } from 'next/cache';
import { isChatStaff } from '@/lib/chat/staff';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Staff's review of a suggested translation (LOC-009): accept or reject.
 * Ansvisor staff only (STAFF_EMAILS, lib/chat/staff.ts); anyone else is told
 * nothing is there. The row is read and changed with the service role, so the
 * id is looked up first and only a row that is still new moves.
 *
 * Accepting only marks the row. The string in messages/<locale>.json and the
 * glossary are changed by hand, by running web/scripts/translate-messages.mjs
 * again (branch feature/loc-translate).
 */
export async function reviewTranslationSuggestion(
  id: string,
  decision: 'accepted' | 'rejected',
): Promise<{ ok: boolean }> {
  if (decision !== 'accepted' && decision !== 'rejected') throw new Error('Unknown decision');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isChatStaff(user)) throw new Error('Not found');

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('translation_suggestions')
    .update({ status: decision, reviewed_at: now, updated_at: now })
    .eq('id', id)
    .eq('status', 'new')
    .select('id');
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/admin/translation-suggestions');
  return { ok: (data?.length ?? 0) > 0 };
}
